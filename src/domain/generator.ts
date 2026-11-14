import { effectiveShiftId, weekdayOf } from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, SUNDAY, WEEKS, type Cell, type Employee, type Schedule, type StoreConfig } from './types';

export interface GenerateInput {
  config: StoreConfig;
  employees: Employee[];
}

const MIN_REST_DAYS_PER_WEEK = 2;
const MAX_PASSES = 50;
/** Peso de um buraco frente a um par de folgas consecutivas (buraco sempre domina). */
const GAP_WEIGHT = 1000;

const groupKey = (shiftId: string, roleId: string) => `${shiftId}|${roleId}`;

/**
 * Estado do gerador (KTD6): folgas por pessoa, contagem de quem trabalha por grupo (turno × função) e dia,
 * e o mínimo exigido. Buracos são recalculados só no delta de cada movimento.
 */
class Solver {
  readonly open: boolean[];
  readonly sundayOpen: boolean;
  /** Folgas a atribuir por semana (KTD14): 2 menos os dias de loja fechada. */
  readonly offsPerWeek: number;
  private readonly required = new Map<string, number[]>();
  private readonly counts = new Map<string, number[]>();
  /** off[i][d] para as pessoas que o gerador pode mexer. */
  readonly off: boolean[][];
  readonly keys: string[];

  constructor(
    readonly config: StoreConfig,
    readonly people: Employee[],
  ) {
    this.open = Array.from({ length: CYCLE_DAYS }, (_, d) => !!config.days[weekdayOf(d)]?.open);
    this.sundayOpen = !!config.days[SUNDAY]?.open;
    let closedPerWeek = 0;
    for (let w = 0; w < DAYS_PER_WEEK; w++) if (!config.days[w]?.open) closedPerWeek++;
    this.offsPerWeek = Math.max(0, MIN_REST_DAYS_PER_WEEK - closedPerWeek);

    const shiftIds = new Set(config.shifts.map((s) => s.id));
    const roleIds = new Set(config.roles.map((r) => r.id));
    for (const m of config.minimums) {
      if (!shiftIds.has(m.shiftId) || !roleIds.has(m.roleId)) continue;
      const k = groupKey(m.shiftId, m.roleId);
      if (this.required.has(k)) continue;
      this.required.set(
        k,
        Array.from({ length: CYCLE_DAYS }, (_, d) => (this.open[d] ? Math.max(0, m.perWeekday[weekdayOf(d)] ?? 0) : 0)),
      );
    }

    this.keys = people.map((e) => groupKey(e.shiftId, e.roleId));
    this.off = people.map(() => Array.from({ length: CYCLE_DAYS }, () => false));
    // Todos começam trabalhando todos os dias abertos.
    people.forEach((_, i) => {
      for (let d = 0; d < CYCLE_DAYS; d++) if (this.open[d]) this.bump(this.keys[i], d, 1);
    });
  }

  private countsFor(key: string): number[] {
    let c = this.counts.get(key);
    if (!c) {
      c = Array.from({ length: CYCLE_DAYS }, () => 0);
      this.counts.set(key, c);
    }
    return c;
  }

  bump(key: string, day: number, delta: number): void {
    this.countsFor(key)[day] += delta;
  }

  /** Linhas fixas (fitEmployee): entram só na contagem. */
  addFixedRow(employee: Employee, row: Cell[]): void {
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const cell = row[d];
      if (cell?.status === 'work') this.bump(groupKey(effectiveShiftId(employee, cell), employee.roleId), d, 1);
    }
  }

  private req(key: string, day: number): number {
    return this.required.get(key)?.[day] ?? 0;
  }

  /** Buracos a mais se uma pessoa do grupo deixar de trabalhar no dia. */
  lossIfOff(key: string, day: number): number {
    return this.countsFor(key)[day] <= this.req(key, day) ? 1 : 0;
  }

  /** Buracos a menos se uma pessoa do grupo passar a trabalhar no dia. */
  gainIfWork(key: string, day: number): number {
    return this.countsFor(key)[day] < this.req(key, day) ? 1 : 0;
  }

  surplus(key: string, day: number): number {
    return this.countsFor(key)[day] - this.req(key, day);
  }

  isRest(i: number, day: number): boolean {
    const d = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
    return !this.open[d] || this.off[i][d];
  }

  setOff(i: number, day: number, value: boolean): void {
    if (this.off[i][day] === value) return;
    this.off[i][day] = value;
    this.bump(this.keys[i], day, value ? -1 : 1);
  }

  /** Pares de dias sem trabalho seguidos, no ciclo circular (KTD5, KTD7). */
  pairScore(i: number): number {
    let n = 0;
    for (let d = 0; d < CYCLE_DAYS; d++) if (this.isRest(i, d) && this.isRest(i, d + 1)) n++;
    return n;
  }

  sundaysOff(i: number): boolean[] {
    return Array.from({ length: WEEKS }, (_, w) => this.off[i][w * DAYS_PER_WEEK + SUNDAY]);
  }

  /** R10/R10a: 1 domingo de folga no ciclo; mulheres nunca 2 domingos trabalhados seguidos (circular). */
  sundayOk(i: number): boolean {
    if (!this.sundayOpen) return true;
    const off = this.sundaysOff(i);
    if (this.people[i].isWoman) return off.every((o, w) => o || off[(w + WEEKS - 1) % WEEKS]);
    return off.some(Boolean);
  }

  offsIn(i: number, week: number): number {
    let n = 0;
    for (let d = week * DAYS_PER_WEEK; d < (week + 1) * DAYS_PER_WEEK; d++) if (this.off[i][d]) n++;
    return n;
  }

  // ---- Etapa 1: domingos de folga, equilibrados por grupo ----

  assignSundays(order: number[]): void {
    if (!this.sundayOpen) return;
    const sundayOffsByGroup = new Map<string, number[]>();
    const sorted = [...order].sort((a, b) => Number(this.people[b].isWoman) - Number(this.people[a].isWoman) || a - b);
    for (const i of sorted) {
      const key = this.keys[i];
      let perWeek = sundayOffsByGroup.get(key);
      if (!perWeek) {
        perWeek = Array.from({ length: WEEKS }, () => 0);
        sundayOffsByGroup.set(key, perWeek);
      }
      const need = this.people[i].isWoman ? 2 : 1;
      const weeks = Array.from({ length: WEEKS }, (_, w) => w);
      for (let n = 0; n < need; n++) {
        const pw = perWeek;
        const best = weeks
          .filter((w) => !this.off[i][w * DAYS_PER_WEEK + SUNDAY])
          .sort((a, b) => {
            const da = a * DAYS_PER_WEEK + SUNDAY;
            const db = b * DAYS_PER_WEEK + SUNDAY;
            return (
              this.lossIfOff(key, da) - this.lossIfOff(key, db) ||
              pw[a] - pw[b] ||
              this.surplus(key, db) - this.surplus(key, da) ||
              a - b
            );
          })[0];
        if (best === undefined) break;
        this.setOff(i, best * DAYS_PER_WEEK + SUNDAY, true);
        pw[best]++;
      }
    }
  }

  // ---- Etapa 2: completar as folgas da semana ----

  fillWeeks(order: number[]): void {
    for (let w = 0; w < WEEKS; w++) {
      for (const i of order) {
        const key = this.keys[i];
        while (this.offsIn(i, w) < this.offsPerWeek) {
          let bestDay = -1;
          let bestScore: number[] = [];
          for (let d = w * DAYS_PER_WEEK; d < (w + 1) * DAYS_PER_WEEK; d++) {
            if (!this.open[d] || this.off[i][d]) continue;
            const adjacent = Number(this.isRest(i, d - 1)) + Number(this.isRest(i, d + 1));
            const score = [this.lossIfOff(key, d), -adjacent, -this.surplus(key, d), d];
            if (bestDay < 0 || lexLess(score, bestScore)) {
              bestDay = d;
              bestScore = score;
            }
          }
          if (bestDay < 0) break;
          this.setOff(i, bestDay, true);
        }
      }
    }
  }

  // ---- Etapa 3: melhoria local, movendo uma folga dentro da semana ----

  improve(order: number[]): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let improved = false;
      for (const i of order) {
        const key = this.keys[i];
        for (let from = 0; from < CYCLE_DAYS; from++) {
          if (!this.off[i][from]) continue;
          const week = Math.floor(from / DAYS_PER_WEEK);
          const basePairs = this.pairScore(i);
          let best: { to: number; value: number } | null = null;
          for (let to = week * DAYS_PER_WEEK; to < (week + 1) * DAYS_PER_WEEK; to++) {
            if (to === from || !this.open[to] || this.off[i][to]) continue;
            // Delta de buracos: volta a trabalhar em `from`, folga em `to`.
            const gain = this.gainIfWork(key, from);
            this.setOff(i, from, false);
            const loss = this.lossIfOff(key, to);
            this.setOff(i, to, true);
            const ok = this.sundayOk(i);
            const pairs = this.pairScore(i);
            this.setOff(i, to, false);
            this.setOff(i, from, true);
            if (!ok) continue;
            const value = (gain - loss) * GAP_WEIGHT + (pairs - basePairs);
            if (value > 0 && (!best || value > best.value)) best = { to, value };
          }
          if (best) {
            this.setOff(i, from, false);
            this.setOff(i, best.to, true);
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  }

  row(i: number): Cell[] {
    return Array.from({ length: CYCLE_DAYS }, (_, d) => ({
      status: !this.open[d] ? 'closed' : this.off[i][d] ? 'off' : 'work',
    }));
  }
}

function lexLess(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
}

/** Determinístico: mesma entrada → mesma escala. Devolve a escala inteira (21 células por pessoa). */
export function generateSchedule(input: GenerateInput): Schedule {
  const solver = new Solver(input.config, input.employees);
  const order = input.employees.map((_, i) => i);
  solver.assignSundays(order);
  solver.fillWeeks(order);
  solver.improve(order);
  const schedule: Schedule = {};
  input.employees.forEach((e, i) => {
    schedule[e.id] = solver.row(i);
  });
  return schedule;
}

/** Encaixa uma pessoa (nova) numa escala existente sem mudar as outras linhas. */
export function fitEmployee(input: GenerateInput & { schedule: Schedule }, employeeId: string): Cell[] {
  const employee = input.employees.find((e) => e.id === employeeId);
  const solver = new Solver(input.config, employee ? [employee] : []);
  if (!employee) return Array.from({ length: CYCLE_DAYS }, (_, d) => ({ status: solver.open[d] ? 'work' : 'closed' }));
  for (const other of input.employees) {
    if (other.id === employeeId) continue;
    const row = input.schedule[other.id];
    if (row) solver.addFixedRow(other, row);
  }
  solver.assignSundays([0]);
  solver.fillWeeks([0]);
  solver.improve([0]);
  return solver.row(0);
}
