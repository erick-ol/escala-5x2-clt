import { validSecondary, type FlexCover } from './coverage';
import { MINUTES_PER_DAY, dayShifts, effectiveHours, effectiveShiftId, grossMinutes, requiredCount, weekdayOf } from './time';
import {
  CYCLE_DAYS,
  type DayIndex,
  type Employee,
  type ExtraShift,
  type Minutes,
  type Schedule,
  type StoreConfig,
  type WorkHours,
} from './types';

/**
 * Planejamento do almoço (intervalo intrajornada) e presença por função ao longo do dia.
 *
 * Linha do tempo de um dia: minutos absolutos desde 00:00 daquele dia. Uma jornada pertence ao dia
 * em que começa; se cruza a meia-noite, `end` passa de 1440. A madrugada de uma jornada do dia
 * anterior NÃO entra na presença do dia seguinte (simplificação documentada).
 */

export interface PresenceBlock {
  employeeId: string;
  day: DayIndex;
  /** Função contada no dia: a principal ou a segunda área (flex) ou a função da vaga coberta (jornada extra). */
  roleId: string;
  shiftId: string;
  /** Minutos absolutos desde 00:00 do dia; `end` pode passar de 1440. */
  start: Minutes;
  end: Minutes;
  /** Mesma base; null quando a jornada não tem intervalo. */
  breakStart: Minutes | null;
  breakEnd: Minutes | null;
  /** true quando o site escolheu o horário do almoço (sem `breakStart` informado). */
  breakPlanned: boolean;
  /**
   * Trechos em que esta pessoa cobre a segunda área durante o almoço de alguém (minuto a minuto).
   * Só aparece quando há cobertura.
   */
  lunchCovers?: LunchCover[];
}

export interface LunchCover {
  from: Minutes;
  to: Minutes;
  /** Função coberta (a segunda área de quem cobre). */
  roleId: string;
  /** Quem está almoçando (o primeiro da função em almoço naquele minuto, na ordem da equipe). */
  forEmployeeId?: string;
}

export interface LunchGap {
  day: DayIndex;
  roleId: string;
  /** Minutos absolutos, intervalo semiaberto [from, to). */
  from: Minutes;
  to: Minutes;
  /** Maior falta de pessoas no intervalo. */
  missing: number;
}

export interface LunchInput {
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule;
  flex?: FlexCover[];
  extraShifts?: ExtraShift[];
}

/**
 * Início do almoço por pessoa e dia do ciclo (minutos absolutos) ou null. Determinístico.
 * Chaves: id do funcionário (jornada da escala) e, para jornadas extras (KTD16), `extraLunchKey(x)`.
 */
export type LunchPlan = Record<string, (Minutes | null)[]>;

/** Almoço mais cedo: 2h depois da entrada (escolha do documento). */
export const LUNCH_MIN_OFFSET = 120;
/** O almoço precisa começar até a 6ª hora de trabalho. */
export const LUNCH_MAX_OFFSET = 360;
const GRID = 15;
/** Três dias de minutos: cobre jornadas que cruzam a meia-noite e almoços informados depois dela. */
const SPAN = 3 * MINUTES_PER_DAY;

/** Chave no LunchPlan de uma jornada extra ("coberto por [funcionário]"). */
export function extraLunchKey(x: Pick<ExtraShift, 'employeeId' | 'shiftId'>): string {
  return `${x.employeeId}@extra@${x.shiftId}`;
}

/** Início do almoço informado, em minutos absolutos do dia da jornada (depois da entrada). */
export function explicitLunchStart(hours: WorkHours): Minutes | null {
  if (hours.breakStart === undefined || hours.breakMinutes <= 0) return null;
  return hours.breakStart < hours.start ? hours.breakStart + MINUTES_PER_DAY : hours.breakStart;
}

interface Job {
  key: string;
  employeeId: string;
  roleId: string;
  shiftId: string;
  hours: WorkHours;
  start: Minutes;
  end: Minutes;
  /** Segunda área, quando a pessoa pode cobrir almoços (conta na principal nesse dia). */
  coverRoleId?: string;
}

interface Context {
  input: LunchInput;
  flexRole: Map<string, string>;
  extrasByDay: ExtraShift[][];
  roleIds: ReadonlySet<string>;
}

function makeContext(input: LunchInput): Context {
  const roleIds = new Set(input.config.roles.map((r) => r.id));
  const flexRole = new Map<string, string>();
  for (const f of input.flex ?? []) flexRole.set(`${f.day}|${f.shiftId}|${f.employeeId}`, f.roleId);
  const extrasByDay: ExtraShift[][] = Array.from({ length: CYCLE_DAYS }, () => []);
  for (const x of input.extraShifts ?? []) {
    if (Number.isInteger(x.day) && x.day >= 0 && x.day < CYCLE_DAYS) extrasByDay[x.day].push(x);
  }
  return { input, flexRole, extrasByDay, roleIds };
}

/** Jornadas do dia, na ordem da equipe; jornadas extras no fim, na ordem recebida. */
function jobsForDay(ctx: Context, day: DayIndex): Job[] {
  const { config, employees, schedule } = ctx.input;
  const jobs: Job[] = [];
  for (const e of employees) {
    const cell = schedule[e.id]?.[day];
    if (cell?.status !== 'work') continue;
    const hours = effectiveHours(config, e, cell, day);
    if (!hours) continue;
    const shiftId = effectiveShiftId(config, e, cell, day);
    const roleId = ctx.flexRole.get(`${day}|${shiftId}|${e.id}`) ?? e.roleId;
    // Quem já foi para a segunda área no turno não cobre almoço de mais ninguém.
    const coverRoleId = roleId === e.roleId ? validSecondary(e, ctx.roleIds) : undefined;
    jobs.push({
      key: e.id,
      employeeId: e.id,
      roleId,
      shiftId,
      hours,
      start: hours.start,
      end: hours.start + grossMinutes(hours),
      ...(coverRoleId ? { coverRoleId } : {}),
    });
  }
  const byId = new Map(employees.map((e) => [e.id, e]));
  for (const x of ctx.extrasByDay[day]) {
    const roleId = x.roleId ?? byId.get(x.employeeId)?.roleId;
    if (!roleId) continue;
    jobs.push({
      key: extraLunchKey(x),
      employeeId: x.employeeId,
      roleId,
      shiftId: x.shiftId,
      hours: x.hours,
      start: x.hours.start,
      end: x.hours.start + grossMinutes(x.hours),
    });
  }
  return jobs;
}

/**
 * Mínimo exigido por função em cada minuto do dia: o maior mínimo entre os turnos cuja janela contém o minuto.
 * Num dia de turno único, a janela é o horário da loja e o mínimo é o maior entre os turnos cadastrados.
 */
function requiredByRole(config: StoreConfig, day: DayIndex): Map<string, Int16Array> {
  const result = new Map<string, Int16Array>();
  const wd = weekdayOf(day);
  if (!config.days[wd]?.open) return result;
  for (const shift of dayShifts(config, wd)) {
    for (const role of config.roles) {
      const need = requiredCount(config, day, shift.id, role.id);
      if (need <= 0) continue;
      let arr = result.get(role.id);
      if (!arr) result.set(role.id, (arr = new Int16Array(SPAN)));
      const end = Math.min(SPAN, shift.start + grossMinutes(shift));
      for (let t = shift.start; t < end; t++) if (arr[t] < need) arr[t] = need;
    }
  }
  return result;
}

function addRange(arr: Int16Array, from: number, to: number, delta: number): void {
  const lo = Math.max(0, from);
  const hi = Math.min(SPAN, to);
  for (let t = lo; t < hi; t++) arr[t] += delta;
}

const EMPTY = new Int16Array(SPAN);

/** Quem pode cobrir almoço da segunda área, com o próprio almoço (lunchFrom = lunchTo = -1 se não há). */
interface Cover {
  index: number;
  r1: number;
  r2: number;
  start: number;
  end: number;
  lunchFrom: number;
  lunchTo: number;
}

interface Item {
  roleId: string;
  start: number;
  end: number;
  coverRoleId?: string;
}

/**
 * Estado de um dia, por função (índices): mínimo, presentes e em almoço por minuto, e quem pode cobrir.
 * A cobertura é minuto a minuto: num minuto t, quem está trabalhando (não almoçando), contando na
 * principal com sobra, e tem a segunda área abaixo do mínimo passa a contar nela. Gulosa, na ordem da
 * equipe; uma pessoa conta para uma função por vez; a principal nunca fica abaixo do mínimo.
 */
class DayState {
  readonly idx = new Map<string, number>();
  readonly roleIds: string[] = [];
  readonly req: Int16Array[] = [];
  readonly present: Int16Array[] = [];
  readonly lunch: Int16Array[] = [];
  readonly covers: Cover[] = [];
  /** Contagem trabalhando por função no último minuto avaliado (depois das coberturas). */
  readonly w: Int32Array;
  /** Quem cobriu o quê no último minuto avaliado: índice do item → função coberta. */
  readonly moved: [number, number][] = [];
  /** Falta total por minuto com os almoços já marcados (sem ninguém extra), mantida em `setLunch`. */
  readonly base = new Int32Array(SPAN);
  private readonly from: number;
  private readonly to: number;

  constructor(config: StoreConfig, day: DayIndex, items: Item[]) {
    const req = requiredByRole(config, day);
    for (const r of config.roles) this.role(r.id);
    for (const id of req.keys()) this.role(id);
    items.forEach((it) => {
      this.role(it.roleId);
      if (it.coverRoleId) this.role(it.coverRoleId);
    });
    this.roleIds.forEach((id, i) => {
      this.req[i] = req.get(id) ?? EMPTY;
      this.present[i] = new Int16Array(SPAN);
      this.lunch[i] = new Int16Array(SPAN);
    });
    items.forEach((it, index) => {
      addRange(this.present[this.idx.get(it.roleId)!], it.start, it.end, 1);
      if (it.coverRoleId) {
        this.covers.push({
          index,
          r1: this.idx.get(it.roleId)!,
          r2: this.idx.get(it.coverRoleId)!,
          start: it.start,
          end: it.end,
          lunchFrom: -1,
          lunchTo: -1,
        });
      }
    });
    this.w = new Int32Array(this.roleIds.length);
    this.from = Math.max(0, Math.min(...items.map((it) => it.start)));
    this.to = Math.min(SPAN, Math.max(...items.map((it) => it.end)));
    this.refresh(this.from, this.to);
  }

  private refresh(from: number, to: number): void {
    const lo = Math.max(from, this.from);
    const hi = Math.min(to, this.to);
    for (let t = lo; t < hi; t++) this.base[t] = this.evaluate(t);
  }

  private role(id: string): number {
    let i = this.idx.get(id);
    if (i === undefined) {
      i = this.roleIds.length;
      this.roleIds.push(id);
      this.idx.set(id, i);
    }
    return i;
  }

  setLunch(index: number, roleId: string, from: number, to: number): void {
    addRange(this.lunch[this.idx.get(roleId)!], from, to, 1);
    const c = this.covers.find((x) => x.index === index);
    if (c) {
      c.lunchFrom = from;
      c.lunchTo = to;
    }
    this.refresh(from, to);
  }

  /**
   * Avalia o minuto t (preenche `w` e `moved`) e devolve a falta total (soma das funções).
   * `extraRole`/`extraIndex`: alguém (ainda sem almoço marcado) almoçando também neste minuto.
   */
  evaluate(t: number, extraRole = -1, extraIndex = -1): number {
    const { w, req } = this;
    const n = this.roleIds.length;
    for (let r = 0; r < n; r++) w[r] = this.present[r][t] - this.lunch[r][t];
    if (extraRole >= 0) w[extraRole]--;
    this.moved.length = 0;
    // Ninguém abaixo do mínimo: ninguém precisa cobrir e não há falta.
    let short = false;
    for (let r = 0; r < n && !short; r++) short = w[r] < req[r][t];
    if (!short) return 0;
    for (const c of this.covers) {
      if (t < c.start || t >= c.end || c.index === extraIndex) continue;
      if (t >= c.lunchFrom && t < c.lunchTo) continue;
      if (w[c.r1] > req[c.r1][t] && w[c.r2] < req[c.r2][t]) {
        w[c.r1]--;
        w[c.r2]++;
        this.moved.push([c.index, c.r2]);
      }
    }
    let missing = 0;
    for (let r = 0; r < n; r++) if (w[r] < req[r][t]) missing += req[r][t] - w[r];
    return missing;
  }
}

/**
 * Escolhe o início do almoço de uma jornada sem horário informado: grade de 15min entre
 * entrada + 2h e entrada + 6h, terminando antes da saída. Critérios, em ordem: falta que o almoço
 * acrescenta (pessoa × minuto, já contando quem cobre pela segunda área, inclusive a própria pessoa
 * deixando de cobrir); minutos de sobreposição com outros almoços da função; distância do meio da
 * jornada; o mais cedo.
 */
function chooseLunch(job: Job, index: number, state: DayState): Minutes {
  const b = job.hours.breakMinutes;
  const role = state.idx.get(job.roleId)!;
  const lunchArr = state.lunch[role];
  const first = Math.ceil((job.start + LUNCH_MIN_OFFSET) / GRID) * GRID;
  const last = Math.min(job.start + LUNCH_MAX_OFFSET, job.end - b - 1);
  const ideal = job.start + (job.end - job.start) / 2 - b / 2;
  // Falta que este almoço acrescenta em cada minuto da janela possível (não depende do início escolhido).
  const lo = Math.max(0, first);
  const hi = Math.min(SPAN, last + b);
  const added = new Int32Array(Math.max(0, hi - lo));
  for (let t = lo; t < hi; t++) {
    added[t - lo] = state.evaluate(t, role, index) - state.base[t];
  }
  let best: Minutes | null = null;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];
  for (let s = first; s <= last; s += GRID) {
    let extra = 0;
    let overlap = 0;
    const end = Math.min(SPAN, s + b);
    for (let t = s; t < end; t++) {
      extra += added[t - lo];
      overlap += lunchArr[t];
    }
    const score: [number, number, number] = [extra, overlap, Math.abs(s - ideal)];
    if (
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
    ) {
      best = s;
      bestScore = score;
    }
  }
  // Jornada curta demais para a janela: almoço no meio, fora da grade.
  return best ?? job.start + Math.max(0, Math.floor((job.end - job.start - b) / 2));
}

export function planLunches(input: LunchInput): LunchPlan {
  const ctx = makeContext(input);
  const plan: LunchPlan = {};
  const row = (key: string) => (plan[key] ??= Array.from({ length: CYCLE_DAYS }, () => null));
  for (const e of input.employees) row(e.id);

  for (let day = 0; day < CYCLE_DAYS; day++) {
    const jobs = jobsForDay(ctx, day);
    if (jobs.length === 0) continue;
    const state = new DayState(input.config, day, jobs);

    // Almoços informados primeiro: os planejados se ajustam a eles.
    const planned: number[] = [];
    jobs.forEach((j, i) => {
      if (j.hours.breakMinutes <= 0) return;
      const explicit = explicitLunchStart(j.hours);
      if (explicit === null) {
        planned.push(i);
        return;
      }
      row(j.key)[day] = explicit;
      state.setLunch(i, j.roleId, explicit, explicit + j.hours.breakMinutes);
    });
    // Ordem estável: entrada, saída, ordem da equipe (sort é estável).
    planned.sort((a, b) => jobs[a].start - jobs[b].start || jobs[a].end - jobs[b].end);
    for (const i of planned) {
      const j = jobs[i];
      const s = chooseLunch(j, i, state);
      row(j.key)[day] = s;
      state.setLunch(i, j.roleId, s, s + j.hours.breakMinutes);
    }
  }
  return plan;
}

function blocksFor(ctx: Context, plan: LunchPlan, day: DayIndex): { blocks: PresenceBlock[]; jobs: Job[] } {
  const jobs = jobsForDay(ctx, day);
  const blocks = jobs.map((j): PresenceBlock => {
    const b = j.hours.breakMinutes;
    const explicit = explicitLunchStart(j.hours);
    const breakStart = b > 0 ? (explicit ?? plan[j.key]?.[day] ?? null) : null;
    return {
      employeeId: j.employeeId,
      day,
      roleId: j.roleId,
      shiftId: j.shiftId,
      start: j.start,
      end: j.end,
      breakStart,
      breakEnd: breakStart === null ? null : breakStart + b,
      breakPlanned: breakStart !== null && explicit === null,
    };
  });
  return { blocks, jobs };
}

/** Estado do dia com os almoços dos blocos já marcados. */
function stateFor(config: StoreConfig, day: DayIndex, jobs: Job[], blocks: PresenceBlock[]): DayState {
  const state = new DayState(config, day, jobs);
  blocks.forEach((bl, i) => {
    if (bl.breakStart !== null && bl.breakEnd !== null) state.setLunch(i, bl.roleId, bl.breakStart, bl.breakEnd);
  });
  return state;
}

/** Quem trabalha no dia, com a função contada, o almoço (informado ou do plano) e quem cobre almoços. */
export function presenceForDay(input: LunchInput, plan: LunchPlan, day: DayIndex): PresenceBlock[] {
  const { blocks, jobs } = blocksFor(makeContext(input), plan, day);
  if (!jobs.some((j) => j.coverRoleId)) return blocks;
  const state = stateFor(input.config, day, jobs, blocks);
  for (let t = 0; t < SPAN; t++) {
    state.evaluate(t);
    for (const [index, r2] of state.moved) {
      const roleId = state.roleIds[r2];
      // Só registra a cobertura durante o almoço de alguém da função coberta.
      const lunching = blocks.find((bl) => bl.roleId === roleId && bl.breakStart !== null && t >= bl.breakStart && t < bl.breakEnd!);
      if (!lunching) continue;
      const covers = (blocks[index].lunchCovers ??= []);
      const lastCover = covers[covers.length - 1];
      if (lastCover && lastCover.to === t && lastCover.roleId === roleId && lastCover.forEmployeeId === lunching.employeeId) {
        lastCover.to = t + 1;
      } else {
        covers.push({ from: t, to: t + 1, roleId, forEmployeeId: lunching.employeeId });
      }
    }
  }
  return blocks;
}

/**
 * Trechos em que uma função fica abaixo do mínimo SÓ por causa de almoços: contando quem está
 * almoçando, o mínimo seria atendido; já contando quem cobre pela segunda área (minuto a minuto),
 * não é. Fora das janelas dos turnos com mínimo, nada é conferido. Trechos vizinhos ou sobrepostos
 * do mesmo dia e função são juntados.
 */
export function findLunchGaps(input: LunchInput, plan: LunchPlan): LunchGap[] {
  const ctx = makeContext(input);
  const gaps: LunchGap[] = [];
  for (let day = 0; day < CYCLE_DAYS; day++) {
    const { blocks, jobs } = blocksFor(ctx, plan, day);
    if (blocks.length === 0) continue;
    const state = stateFor(input.config, day, jobs, blocks);
    const n = state.roleIds.length;
    const open: (LunchGap | null)[] = Array.from({ length: n }, () => null);
    const dayGaps: LunchGap[][] = Array.from({ length: n }, () => []);
    for (let t = 0; t <= SPAN; t++) {
      if (t < SPAN) state.evaluate(t);
      for (let r = 0; r < n; r++) {
        const need = t < SPAN ? state.req[r][t] : 0;
        const working = state.w[r];
        const caused = need > 0 && working < need && state.present[r][t] >= need;
        const g = open[r];
        if (caused) {
          if (g && g.to >= t) {
            g.to = t + 1;
            g.missing = Math.max(g.missing, need - working);
          } else {
            open[r] = { day, roleId: state.roleIds[r], from: t, to: t + 1, missing: need - working };
          }
        } else if (g) {
          dayGaps[r].push(g);
          open[r] = null;
        }
      }
    }
    for (const list of dayGaps) gaps.push(...mergeGaps(list));
  }
  return gaps;
}

/** Junta trechos vizinhos ou sobrepostos (mesmo dia e função), ordenados pelo início. */
function mergeGaps(list: LunchGap[]): LunchGap[] {
  const sorted = [...list].sort((a, b) => a.from - b.from);
  const out: LunchGap[] = [];
  for (const g of sorted) {
    const last = out[out.length - 1];
    if (last && g.from <= last.to) {
      last.to = Math.max(last.to, g.to);
      last.missing = Math.max(last.missing, g.missing);
    } else {
      out.push({ ...g });
    }
  }
  return out;
}
