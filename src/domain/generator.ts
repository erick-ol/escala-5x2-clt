import {
  allowsOff,
  effectiveShiftId,
  isSingleShiftDay,
  isVirtualShiftId,
  requiredCount,
  dayOfWeekday,
  virtualShiftId,
  weekdayOf,
} from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, SUNDAY, WEEKS, type Cell, type Employee, type Schedule, type StoreConfig } from './types';

export interface GenerateInput {
  config: StoreConfig;
  employees: Employee[];
}

const MIN_REST_DAYS_PER_WEEK = 2;
const MAX_PASSES = 50;
/** No máximo 2 dias seguidos de descanso com folga atribuída (loja fechada sozinha não conta). */
const MAX_REST_RUN = 2;
/** No máximo 6 dias seguidos de trabalho (circular). */
const MAX_WORK_RUN = 6;
/** Sequência de trabalho a partir da qual o gerador começa a penalizar (regra suave). */
const COMFORT_WORK_RUN = 5;

/**
 * Pesos do objetivo (menor é melhor), em ordem de prioridade:
 * restrições (descansos/trabalho seguidos) ≫ buracos ≫ preferências (pares de folga, sequências longas).
 */
const VIOLATION_WEIGHT = 1_000_000;
const GAP_WEIGHT = 1000;
const MINUTES_IN_DAY = 24 * 60;
/** 11h entre jornadas: só desempate na escolha de turno de quem não tem turno fixo (vira aviso, não regra). */
const REST_11H = 11 * 60;
/**
 * Todos os domingos do ciclo de folga: evitado acima de buracos (o domingo é dividido entre a equipe), mas
 * abaixo das regras legais (ex.: quem fecha no sábado à noite pode não ter 11h até o domingo de manhã).
 */
const ALL_SUNDAYS_OFF_WEIGHT = 100_000;
/** 'together': cada par de dias de descanso seguidos vale isto. */
const PAIR_REWARD = 10;
/** 'flexible': cada par de dias de descanso seguidos custa isto (espalha as folgas). */
const PAIR_PENALTY = 2;
/** Cada dia de trabalho seguido acima de COMFORT_WORK_RUN custa isto. */
const STREAK_PENALTY = 1;

/**
 * Estado do gerador (KTD6). Cada pessoa (as que o gerador mexe e as linhas fixas do fitEmployee) tem,
 * por dia, o índice do turno em que trabalha (-1 = não trabalha). Os buracos de um dia/turno são
 * recalculados a partir de quem trabalha nele, com a mesma regra de segunda área da cobertura
 * (coverage.ts): para cada função com falta, na ordem das funções, quem tem essa segunda área e cuja
 * principal está com sobra passa a contar nela, na ordem da equipe.
 *
 * Interpretação das restrições (ciclo circular de 21 dias, atravessando as semanas):
 * - descanso = folga ('off') ou loja fechada ('closed'); uma sequência de descanso que contém ao menos
 *   uma folga atribuída não pode passar de 2 dias. Sequências só de loja fechada não contam contra a pessoa
 *   (a pessoa não escolheu), mas uma folga colada a elas soma (ex.: sábado de folga + domingo fechado = 2,
 *   ok; + segunda de folga = 3, não);
 * - nunca mais de 6 dias seguidos de trabalho;
 * - descanso de 11h entre jornadas: trabalhar dois dias seguidos cujo horário deixa menos de 11h entre a
 *   saída e a entrada conta como violação (ex.: sábado à tarde até 20:30 e domingo de turno único às 07:00).
 * São tratadas como restrições muito pesadas: se forem impossíveis para alguém, o gerador entrega a melhor
 * escala que encontrar em vez de falhar.
 */
class Solver {
  readonly open: boolean[];
  /** Dias em que o gerador pode pôr folga (aberto e sem "sem folga"). */
  readonly offAllowed: boolean[];
  readonly sundayOpen: boolean;
  /** Folgas a atribuir por semana (KTD14): 2 menos os dias de loja fechada. */
  readonly offsPerWeek: number;
  readonly together: boolean;
  /** Índice da função principal de cada pessoa (funções fora da configuração ganham índices extras). */
  private readonly role: number[];
  /** Índice da segunda área válida (-1 se não houver). */
  private readonly secondary: number[];
  /** Índice do turno do cadastro (-1 se o turno não existe). */
  private readonly home: number[];
  /** Pessoas sem turno fixo: o gerador escolhe o turno de cada dia (`choice`). */
  private readonly floating: boolean[];
  /** choice[k][d]: turno escolhido para quem não tem turno fixo (começa no turno do cadastro). */
  private readonly choice: number[][];
  /** Dias de turno único: todos trabalham no turno virtual (índice `single`). */
  private readonly singleDay: boolean[];
  /** Índice do turno virtual dos dias de turno único (depois dos turnos cadastrados). */
  private readonly single: number;
  private readonly hasSingle: boolean;
  /** req[s][r][d]: mínimo exigido; funções extras têm 0. */
  private readonly req: number[][][];
  /** cnt[s][r][d]: pessoas da função principal r trabalhando no turno s no dia d. */
  private readonly cnt: number[][][];
  /** at[k][d]: turno em que a pessoa k trabalha no dia d (-1 = não trabalha). */
  private readonly at: number[][];
  /** Pessoas que podem aparecer em cada turno, na ordem da equipe. */
  private readonly members: number[][];
  private readonly nRoles: number;
  private readonly scratch: number[];
  /** Bit d: trabalhar no dia anterior e no dia d deixa menos de 11h de descanso (horário padrão da pessoa). */
  private readonly restConflict: number[];
  /** off[k][d] para as pessoas que o gerador mexe. */
  readonly off: boolean[][];

  constructor(
    readonly config: StoreConfig,
    /** Equipe inteira, na ordem da cobertura. */
    readonly all: Employee[],
    /** Linha fixa de cada pessoa (null = o gerador escolhe as folgas). */
    fixed: (Cell[] | null)[],
  ) {
    this.open = Array.from({ length: CYCLE_DAYS }, (_, d) => !!config.days[weekdayOf(d)]?.open);
    this.offAllowed = Array.from({ length: CYCLE_DAYS }, (_, d) => allowsOff(config, weekdayOf(d)));
    this.sundayOpen = !!config.days[SUNDAY]?.open;
    this.together = config.offPattern !== 'flexible';
    let closedPerWeek = 0;
    for (let wd = 0; wd < DAYS_PER_WEEK; wd++) if (!config.days[wd]?.open) closedPerWeek++;
    this.offsPerWeek = Math.max(0, MIN_REST_DAYS_PER_WEEK - closedPerWeek);

    const shiftIndex = new Map(config.shifts.map((s, i) => [s.id, i]));
    this.single = config.shifts.length;
    this.singleDay = Array.from({ length: CYCLE_DAYS }, (_, d) => isSingleShiftDay(config, weekdayOf(d)));
    this.hasSingle = this.singleDay.some(Boolean);
    const nShifts = config.shifts.length + 1;
    const roleIndex = new Map(config.roles.map((r, i) => [r.id, i]));
    const nCfgRoles = config.roles.length;
    this.role = all.map((e) => {
      let r = roleIndex.get(e.roleId);
      if (r === undefined) {
        r = roleIndex.size;
        roleIndex.set(e.roleId, r);
      }
      return r;
    });
    this.secondary = all.map((e, k) => {
      const r = e.secondaryRoleId === undefined ? undefined : roleIndex.get(e.secondaryRoleId);
      return r !== undefined && r < nCfgRoles && r !== this.role[k] ? r : -1;
    });
    this.nRoles = roleIndex.size;
    this.scratch = Array.from({ length: this.nRoles }, () => 0);
    this.home = all.map((e) => shiftIndex.get(e.shiftId) ?? -1);
    this.floating = all.map((e, k) => !!e.floating && fixed[k] === null && config.shifts.length > 1);
    this.choice = all.map((_, k) => Array.from({ length: CYCLE_DAYS }, () => this.home[k]));

    const zeros = () => Array.from({ length: CYCLE_DAYS }, () => 0);
    this.req = Array.from({ length: nShifts }, () => Array.from({ length: this.nRoles }, zeros));
    this.cnt = Array.from({ length: nShifts }, () => Array.from({ length: this.nRoles }, zeros));
    // Mesma regra da cobertura (requiredCount): turnos cadastrados nos dias normais, turno virtual nos de turno único.
    const ids = [...config.shifts.map((s) => s.id), null];
    for (let s = 0; s < nShifts; s++) {
      for (let r = 0; r < nCfgRoles; r++) {
        const roleId = config.roles[r].id;
        for (let d = 0; d < CYCLE_DAYS; d++) {
          const id = ids[s] ?? virtualShiftId(weekdayOf(d));
          this.req[s][r][d] = requiredCount(config, d, id, roleId);
        }
      }
    }

    // O descanso de 11h entre jornadas não restringe o gerador: vira aviso na escala (rules.ts).
    this.restConflict = all.map(() => 0);

    this.off = all.map(() => Array.from({ length: CYCLE_DAYS }, () => false));
    this.at = all.map((e, k) => {
      const row = fixed[k];
      return Array.from({ length: CYCLE_DAYS }, (_, d) => {
        if (row === null) return this.open[d] ? this.shiftOn(k, d) : -1; // todos começam trabalhando nos dias abertos
        const cell = row[d];
        if (cell?.status !== 'work') return -1;
        const id = effectiveShiftId(config, e, cell, d);
        return isVirtualShiftId(id) ? this.single : (shiftIndex.get(id) ?? -1);
      });
    });
    this.members = Array.from({ length: nShifts }, (_, s) =>
      all.map((_, k) => k).filter((k) => this.at[k].includes(s) || this.home[k] === s || (this.floating[k] && s < this.single) || (s === this.single && this.hasSingle)),
    );
    all.forEach((_, k) => {
      for (let d = 0; d < CYCLE_DAYS; d++) {
        const s = this.at[k][d];
        if (s >= 0) this.cnt[s][this.role[k]][d]++;
      }
    });
  }

  /** Buracos no turno s do dia d, com a segunda área aplicada (mesma regra de coverage.ts). */
  gapAt(s: number, d: number): number {
    if (s < 0) return 0;
    const req = this.req[s];
    const c = this.scratch;
    for (let r = 0; r < this.nRoles; r++) c[r] = this.cnt[s][r][d];
    const members = this.members[s];
    let missing = 0;
    for (let r = 0; r < this.config.roles.length; r++) {
      const need = req[r][d];
      if (c[r] >= need) continue;
      for (const k of members) {
        if (c[r] >= need) break;
        if (this.secondary[k] !== r || this.at[k][d] !== s) continue;
        const p = this.role[k];
        if (c[p] <= req[p][d]) continue;
        c[p]--;
        c[r]++;
      }
      missing += need - c[r];
    }
    return missing;
  }

  /** Turno da pessoa k no dia d: o virtual nos dias de turno único; o escolhido, para quem não tem turno fixo; senão o do cadastro. */
  shiftOn(k: number, d: number): number {
    if (this.singleDay[d]) return this.single;
    return this.floating[k] ? this.choice[k][d] : this.home[k];
  }

  /**
   * Quem não tem turno fixo: em cada dia de trabalho, vai para o turno cadastrado onde deixa menos buracos no
   * dia; empatado, onde a própria função fica com menos falta sem contar quem cobre pela segunda área (ex.: a
   * balconista vai para a tarde na folga do balconista da tarde, em vez de tirar alguém do caixa); depois
   * fica onde está e, por fim, no turno do cadastro. Repete até ninguém mudar.
   */
  placeFloaters(order: number[]): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let moved = false;
      for (const k of order) {
        if (!this.floating[k]) continue;
        for (let d = 0; d < CYCLE_DAYS; d++) if (this.placeOn(k, d)) moved = true;
      }
      if (!moved) break;
    }
  }

  /** Buracos de todos os turnos cadastrados do dia d. */
  private dayGaps(d: number): number {
    let n = 0;
    for (let s = 0; s < this.config.shifts.length; s++) n += this.gapAt(s, d);
    return n;
  }

  /** Põe quem não tem turno fixo no melhor turno do dia d (ver placeFloaters). Devolve se mudou. */
  private placeOn(k: number, d: number): boolean {
    const now = this.at[k][d];
    if (!this.floating[k] || now < 0 || this.singleDay[d]) return false;
    const shifts = this.config.shifts.length;
    const r = this.role[k];
    const put = (s: number) => {
      this.cnt[this.at[k][d]][r][d]--;
      this.at[k][d] = s;
      this.cnt[s][r][d]++;
    };
    /** Fechar à noite e abrir cedo no dia seguinte (menos de 11h): evitado quando não custa cobertura. */
    const shortRests = (s: number) => {
      const prev = this.at[k][(d + CYCLE_DAYS - 1) % CYCLE_DAYS];
      const next = this.at[k][(d + 1) % CYCLE_DAYS];
      let n = 0;
      if (prev >= 0 && this.restBetween(prev, d - 1, s, d) < REST_11H) n++;
      if (next >= 0 && this.restBetween(s, d, next, d + 1) < REST_11H) n++;
      return n;
    };
    /** Falta da função da pessoa no dia, só com quem é dela (sem segunda área). */
    const ownShort = () => {
      let n = 0;
      for (let s = 0; s < shifts; s++) n += Math.max(0, this.req[s][r][d] - this.cnt[s][r][d]);
      return n;
    };
    let best = now;
    let bestScore = [this.dayGaps(d), ownShort(), shortRests(now), 0, Number(now !== this.home[k])];
    for (let s = 0; s < shifts; s++) {
      if (s === now) continue;
      put(s);
      const score = [this.dayGaps(d), ownShort(), shortRests(s), 1, Number(s !== this.home[k])];
      if (lexLess(score, bestScore)) {
        best = s;
        bestScore = score;
      }
      put(now);
    }
    this.choice[k][d] = best;
    if (best === now) return false;
    put(best);
    return true;
  }


  /** Início e fim (minutos, fim depois do início) do turno s no dia d; o turno único usa o horário da loja. */
  private shiftSpan(s: number, day: number): [number, number] {
    const d = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
    const sh = s === this.single ? this.config.days[weekdayOf(d)] : null;
    const start = sh ? sh.opensAt : this.config.shifts[s].start;
    const end = sh ? sh.closesAt : this.config.shifts[s].end;
    return [start, end > start ? end : end + MINUTES_IN_DAY];
  }

  /** Minutos de descanso entre o turno a (dia da) e o turno b do dia seguinte. */
  restBetween(a: number, da: number, b: number, db: number): number {
    return MINUTES_IN_DAY + this.shiftSpan(b, db)[0] - this.shiftSpan(a, da)[1];
  }

  /** Buracos que dependem das folgas da pessoa k nos dias [from, to): turno do cadastro e turno único. */
  gapsFor(k: number, from: number, to: number): number {
    let n = 0;
    for (let d = from; d < to; d++) {
      // Sem turno fixo: a pessoa vai para o melhor turno do dia, então contam todos os turnos dele.
      if (this.floating[k] && !this.singleDay[d]) {
        this.placeOn(k, d);
        n += this.dayGaps(d);
      } else {
        n += this.gapAt(this.shiftOn(k, d), d);
      }
    }
    return n;
  }

  /** Buracos a mais (ou a menos, se negativo) se a pessoa k inverter folga/trabalho no dia d. */
  toggleDelta(k: number, d: number): number {
    const s = this.shiftOn(k, d);
    if (s < 0) return 0;
    const before = this.gapAt(s, d);
    this.setOff(k, d, !this.off[k][d]);
    const after = this.gapAt(s, d);
    this.setOff(k, d, !this.off[k][d]);
    return after - before;
  }

  /** Sobra da função principal da pessoa no turno do cadastro (desempate). */
  surplus(k: number, d: number): number {
    const s = this.shiftOn(k, d);
    if (s < 0) return 0;
    const r = this.role[k];
    return this.cnt[s][r][d] - this.req[s][r][d];
  }

  isRest(k: number, day: number): boolean {
    const d = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
    return !this.open[d] || this.off[k][d];
  }

  setOff(k: number, day: number, value: boolean): void {
    if (this.off[k][day] === value || !this.open[day]) return;
    this.off[k][day] = value;
    const s = this.shiftOn(k, day);
    this.at[k][day] = value ? -1 : s;
    if (s >= 0) this.cnt[s][this.role[k]][day] += value ? -1 : 1;
  }

  /** Sequência de descanso que contém o dia d tem folga e passa de 2 dias? */
  restRunTooLong(k: number, d: number): boolean {
    let len = 1;
    let hasOff = this.off[k][d];
    for (let j = 1; j < CYCLE_DAYS && this.isRest(k, d - j); j++) {
      len++;
      if (this.off[k][(d - j + CYCLE_DAYS) % CYCLE_DAYS]) hasOff = true;
    }
    for (let j = 1; j < CYCLE_DAYS && this.isRest(k, d + j); j++) {
      len++;
      if (this.off[k][(d + j) % CYCLE_DAYS]) hasOff = true;
    }
    return hasOff && len > MAX_REST_RUN;
  }

  /** Quantas vezes a pessoa k trabalha dois dias seguidos com menos de 11h de descanso entre eles. */
  shortRests(k: number): number {
    const conflict = this.restConflict[k];
    if (conflict === 0) return 0;
    const work = maskOf((d) => this.open[d] && !this.off[k][d]);
    return popcount(work & ahead(work, CYCLE_DAYS - 1) & conflict);
  }

  /** Folga no dia d deixaria a pessoa k com todos os domingos do ciclo de folga? */
  allSundaysOffWith(k: number, d: number): boolean {
    if (weekdayOf(d) !== SUNDAY) return false;
    for (let w = 0; w < WEEKS; w++) {
      const sunday = dayOfWeekday(w, SUNDAY);
      if (sunday !== d && !this.off[k][sunday]) return false;
    }
    return true;
  }

  offsIn(k: number, week: number): number {
    let n = 0;
    for (let d = week * DAYS_PER_WEEK; d < (week + 1) * DAYS_PER_WEEK; d++) if (this.off[k][d]) n++;
    return n;
  }

  // ---- Etapa 1: domingos de folga, equilibrados por grupo ----

  assignSundays(order: number[]): void {
    if (!this.sundayOpen) return;
    const sundayOffsByGroup = new Map<string, number[]>();
    const sorted = [...order].sort((a, b) => Number(this.all[b].isWoman) - Number(this.all[a].isWoman) || a - b);
    for (const k of sorted) {
      const key = `${this.shiftOn(k, dayOfWeekday(0, SUNDAY))}|${this.role[k]}`;
      let perWeek = sundayOffsByGroup.get(key);
      if (!perWeek) {
        perWeek = Array.from({ length: WEEKS }, () => 0);
        sundayOffsByGroup.set(key, perWeek);
      }
      const need = this.all[k].isWoman ? 2 : 1;
      const weeks = Array.from({ length: WEEKS }, (_, w) => w);
      for (let n = 0; n < need; n++) {
        const pw = perWeek;
        const scored = weeks
          .filter((w) => !this.off[k][dayOfWeekday(w, SUNDAY)])
          .map((w) => {
            const d = dayOfWeekday(w, SUNDAY);
            return { w, score: [this.toggleDelta(k, d), pw[w], -this.surplus(k, d), w] };
          });
        scored.sort((a, b) => (lexLess(a.score, b.score) ? -1 : lexLess(b.score, a.score) ? 1 : 0));
        const best = scored[0]?.w;
        if (best === undefined) break;
        this.setOff(k, dayOfWeekday(best, SUNDAY), true);
        pw[best]++;
      }
    }
  }

  // ---- Etapa 2: completar as folgas da semana ----

  fillWeeks(order: number[]): void {
    for (let w = 0; w < WEEKS; w++) {
      for (const k of order) {
        while (this.offsIn(k, w) < this.offsPerWeek) {
          let bestDay = -1;
          let bestScore: number[] = [];
          for (let d = w * DAYS_PER_WEEK; d < (w + 1) * DAYS_PER_WEEK; d++) {
            if (!this.offAllowed[d] || this.off[k][d]) continue;
            const adjacent = Number(this.isRest(k, d - 1)) + Number(this.isRest(k, d + 1));
            const gap = this.toggleDelta(k, d);
            this.setOff(k, d, true);
            const tooLong = Number(this.restRunTooLong(k, d));
            const shortRest = this.shortRests(k);
            this.setOff(k, d, false);
            const allSundays = Number(this.allSundaysOffWith(k, d));
            const score = [tooLong + shortRest, allSundays, gap, this.together ? -adjacent : adjacent, -this.surplus(k, d), d];
            if (bestDay < 0 || lexLess(score, bestScore)) {
              bestDay = d;
              bestScore = score;
            }
          }
          if (bestDay < 0) break;
          this.setOff(k, bestDay, true);
        }
      }
    }
  }

  // ---- Etapa 3: melhoria local, reescolhendo as folgas das 3 semanas de uma pessoa por vez ----

  /**
   * Para cada pessoa (as outras fixas), testa todas as combinações de folgas das 3 semanas (mantendo
   * quantas folgas cada semana tem) e fica com a de menor custo. Os buracos de uma semana só dependem
   * das folgas daquela semana, então são calculados uma vez por combinação semanal; restrições e
   * preferências da linha inteira são avaliadas com máscaras de bits. Repete até não melhorar mais.
   */
  improve(order: number[]): void {
    const closedMask = maskOf((d) => !this.open[d]);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let improved = false;
      for (const k of order) {
        const options: { offs: number[]; mask: number; gaps: number }[][] = [];
        const current: number[][] = [];
        for (let w = 0; w < WEEKS; w++) {
          const days: number[] = [];
          const now: number[] = [];
          for (let d = w * DAYS_PER_WEEK; d < (w + 1) * DAYS_PER_WEEK; d++) {
            if (!this.open[d]) continue;
            if (this.off[k][d]) now.push(d);
            if (this.offAllowed[d]) days.push(d);
          }
          current.push(now);
          options.push(
            combinations(days, now.length).map((offs) => {
              this.applyWeek(k, w, offs);
              const gaps = this.gapsFor(k, w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK);
              return { offs, mask: offs.reduce((m, d) => m | (1 << d), 0), gaps };
            }),
          );
          this.applyWeek(k, w, now);
        }

        const isWoman = this.all[k].isWoman;
        const currentMask = current.flat().reduce((m, d) => m | (1 << d), 0);
        const currentGaps = options.reduce((sum, opts, w) => sum + (opts.find((o) => sameSet(o.offs, current[w]))?.gaps ?? 0), 0);
        // Se a linha atual já fere o rodízio de domingo (não deveria), não o exige das alternativas.
        const checkSunday = this.sundayOpen && sundayRuleOk(currentMask, isWoman);
        const conflict = this.restConflict[k];
        const costOf = (offMask: number, gaps: number): number => {
          if (checkSunday && !sundayRuleOk(offMask, isWoman)) return Infinity;
          const { violations, soft } = maskCost(offMask, closedMask, this.together, conflict);
          const allSundays = this.sundayOpen && (offMask & ALL_SUNDAYS) === ALL_SUNDAYS ? ALL_SUNDAYS_OFF_WEIGHT : 0;
          return violations * VIOLATION_WEIGHT + allSundays + gaps * GAP_WEIGHT + soft;
        };
        let bestCost = costOf(currentMask, currentGaps);
        let best: number[][] | null = null;
        for (const a of options[0]) {
          for (const b of options[1]) {
            const ab = a.mask | b.mask;
            const gab = a.gaps + b.gaps;
            for (const c of options[2]) {
              const value = costOf(ab | c.mask, gab + c.gaps);
              if (value < bestCost) {
                bestCost = value;
                best = [a.offs, b.offs, c.offs];
              }
            }
          }
        }
        if (best) {
          best.forEach((offs, w) => this.applyWeek(k, w, offs));
          improved = true;
        }
      }
      if (!improved) break;
    }
  }

  private applyWeek(k: number, w: number, offs: number[]): void {
    for (let d = w * DAYS_PER_WEEK; d < (w + 1) * DAYS_PER_WEEK; d++) this.setOff(k, d, offs.includes(d));
  }

  /**
   * Custo total da escala (o mesmo objetivo da melhoria local): buracos de todos os dias mais as restrições e
   * preferências das linhas das pessoas em `order`. Serve para escolher entre tentativas.
   */
  cost(order: number[]): number {
    const closedMask = maskOf((d) => !this.open[d]);
    let gaps = 0;
    for (let s = 0; s < this.req.length; s++) for (let d = 0; d < CYCLE_DAYS; d++) gaps += this.gapAt(s, d);
    let total = gaps * GAP_WEIGHT;
    for (const k of order) {
      const offMask = maskOf((d) => this.off[k][d]);
      if (this.sundayOpen && !sundayRuleOk(offMask, this.all[k].isWoman)) total += VIOLATION_WEIGHT;
      const { violations, soft } = maskCost(offMask, closedMask, this.together, this.restConflict[k]);
      if (this.sundayOpen && (offMask & ALL_SUNDAYS) === ALL_SUNDAYS) total += ALL_SUNDAYS_OFF_WEIGHT;
      total += violations * VIOLATION_WEIGHT + soft;
    }
    return total;
  }

  /** Copia as folgas das pessoas em `order` de outra tentativa (mesma equipe e mesma configuração de dias). */
  loadOffs(off: boolean[][], order: number[]): void {
    for (const k of order) for (let d = 0; d < CYCLE_DAYS; d++) this.setOff(k, d, off[k][d]);
  }

  row(k: number): Cell[] {
    return Array.from({ length: CYCLE_DAYS }, (_, d): Cell => {
      if (!this.open[d]) return { status: 'closed' };
      if (this.off[k][d]) return { status: 'off' };
      const s = this.at[k][d];
      // Sem turno fixo: o turno do dia fica na célula quando não é o do cadastro.
      if (this.floating[k] && !this.singleDay[d] && s >= 0 && s !== this.home[k]) {
        return { status: 'work', shiftId: this.config.shifts[s].id };
      }
      return { status: 'work' };
    });
  }
}

const FULL_MASK = (1 << CYCLE_DAYS) - 1;
const SUNDAY_BITS = Array.from({ length: WEEKS }, (_, w) => 1 << dayOfWeekday(w, SUNDAY));
const ALL_SUNDAYS = SUNDAY_BITS.reduce((m, b) => m | b, 0);

function maskOf(pred: (d: number) => boolean): number {
  let m = 0;
  for (let d = 0; d < CYCLE_DAYS; d++) if (pred(d)) m |= 1 << d;
  return m;
}

/** Bit d do resultado = bit (d + n) do ciclo circular. */
function ahead(x: number, n: number): number {
  return ((x >>> n) | (x << (CYCLE_DAYS - n))) & FULL_MASK;
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x; v; v &= v - 1) n++;
  return n;
}

/** Bit d = os `len` dias a partir de d estão todos em `x` (circular). */
function windows(x: number, len: number): number {
  let w = x;
  for (let j = 1; j < len; j++) w &= ahead(x, j);
  return w;
}

/**
 * Custo da linha a partir das máscaras de folga e de loja fechada (circular):
 * - violações: janelas de 3 dias de descanso que contêm folga (uma sequência de L dias com folga dá L-2)
 *   mais janelas de 7 dias de trabalho (L-6);
 * - preferência: pares de descanso seguidos (prêmio em 'together', custo em 'flexible') e
 *   dias de trabalho seguidos acima de 5.
 */
function maskCost(
  offMask: number,
  closedMask: number,
  together: boolean,
  restConflict = 0,
): { violations: number; soft: number } {
  const rest = offMask | closedMask;
  const work = ~rest & FULL_MASK;
  const restWithOff = windows(rest, MAX_REST_RUN + 1) & (offMask | ahead(offMask, 1) | ahead(offMask, 2));
  // Dias trabalhados logo depois de outro dia trabalhado com menos de 11h de descanso entre eles.
  const shortRest = work & ahead(work, CYCLE_DAYS - 1) & restConflict;
  const violations = popcount(restWithOff) + popcount(windows(work, MAX_WORK_RUN + 1)) + popcount(shortRest);
  const pairs = popcount(rest & ahead(rest, 1));
  const streak = popcount(windows(work, COMFORT_WORK_RUN + 1));
  const pairCost = together ? -PAIR_REWARD * pairs : PAIR_PENALTY * pairs;
  return { violations, soft: pairCost + STREAK_PENALTY * streak };
}


/** R10/R10a pela máscara de folgas: 1 domingo de folga no ciclo; mulheres nunca 2 domingos trabalhados seguidos. */
function sundayRuleOk(offMask: number, isWoman: boolean): boolean {
  const off = SUNDAY_BITS.map((b) => (offMask & b) !== 0);
  if (isWoman) return off.every((o, w) => o || off[(w + WEEKS - 1) % WEEKS]);
  return off.some(Boolean);
}

function lexLess(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Subconjuntos de `size` elementos, em ordem lexicográfica (determinístico). */
function combinations(items: number[], size: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const rec = (start: number) => {
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (size - pick.length); i++) {
      pick.push(items[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return out;
}

/** Melhoria local e, para quem não tem turno fixo, escolha do turno de cada dia (duas rodadas). */
function polish(solver: Solver, order: number[]): void {
  solver.improve(order);
  for (let round = 0; round < 2; round++) {
    solver.placeFloaters(order);
    solver.improve(order);
  }
  solver.placeFloaters(order);
}

function solve(solver: Solver, order: number[]): void {
  solver.assignSundays(order);
  solver.fillWeeks(order);
  polish(solver, order);
}

/** Determinístico: mesma entrada → mesma escala. Devolve a escala inteira (21 células por pessoa). */
export function generateSchedule(input: GenerateInput): Schedule {
  const forward = input.employees.map((_, i) => i);
  const fresh = (config: StoreConfig) =>
    new Solver(
      config,
      input.employees,
      input.employees.map(() => null),
    );
  // A melhoria local pode parar num ótimo local que depende do ponto de partida (com as semanas de domingo
  // a sábado, um par sábado + domingo atravessa a virada da semana). Duas partidas fixas (determinísticas),
  // fica a de menor custo: do zero e a partir da escala do outro padrão de folgas ('together' ↔ 'flexible'),
  // melhorada com o padrão pedido.
  const other: StoreConfig = { ...input.config, offPattern: input.config.offPattern === 'flexible' ? 'together' : 'flexible' };
  const plain = fresh(input.config);
  solve(plain, forward);
  const seed = fresh(other);
  solve(seed, forward);
  const seeded = fresh(input.config);
  seeded.loadOffs(seed.off, forward);
  polish(seeded, forward);
  const best = seeded.cost(forward) < plain.cost(forward) ? seeded : plain;
  const schedule: Schedule = {};
  input.employees.forEach((e, i) => {
    schedule[e.id] = best.row(i);
  });
  return schedule;
}

/** Encaixa uma pessoa (nova) numa escala existente sem mudar as outras linhas. */
export function fitEmployee(input: GenerateInput & { schedule: Schedule }, employeeId: string): Cell[] {
  const index = input.employees.findIndex((e) => e.id === employeeId);
  if (index < 0) {
    const open = Array.from({ length: CYCLE_DAYS }, (_, d) => !!input.config.days[weekdayOf(d)]?.open);
    return open.map((o): Cell => ({ status: o ? 'work' : 'closed' }));
  }
  // Quem não tem linha na escala não conta (linha vazia).
  const fixed = input.employees.map((e, i) => (i === index ? null : (input.schedule[e.id] ?? [])));
  const solver = new Solver(input.config, input.employees, fixed);
  solve(solver, [index]);
  return solver.row(index);
}
