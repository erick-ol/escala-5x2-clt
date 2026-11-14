import type { FlexCover } from './coverage';
import { MINUTES_PER_DAY, effectiveHours, effectiveShiftId, grossMinutes, weekdayOf } from './time';
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
}

interface Context {
  input: LunchInput;
  flexRole: Map<string, string>;
  extrasByDay: ExtraShift[][];
}

function makeContext(input: LunchInput): Context {
  const flexRole = new Map<string, string>();
  for (const f of input.flex ?? []) flexRole.set(`${f.day}|${f.shiftId}|${f.employeeId}`, f.roleId);
  const extrasByDay: ExtraShift[][] = Array.from({ length: CYCLE_DAYS }, () => []);
  for (const x of input.extraShifts ?? []) {
    if (Number.isInteger(x.day) && x.day >= 0 && x.day < CYCLE_DAYS) extrasByDay[x.day].push(x);
  }
  return { input, flexRole, extrasByDay };
}

/** Jornadas do dia, na ordem da equipe; jornadas extras no fim, na ordem recebida. */
function jobsForDay(ctx: Context, day: DayIndex): Job[] {
  const { config, employees, schedule } = ctx.input;
  const jobs: Job[] = [];
  for (const e of employees) {
    const cell = schedule[e.id]?.[day];
    if (cell?.status !== 'work') continue;
    const hours = effectiveHours(config, e, cell);
    if (!hours) continue;
    const shiftId = effectiveShiftId(e, cell);
    jobs.push({
      key: e.id,
      employeeId: e.id,
      roleId: ctx.flexRole.get(`${day}|${shiftId}|${e.id}`) ?? e.roleId,
      shiftId,
      hours,
      start: hours.start,
      end: hours.start + grossMinutes(hours),
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

/** Mínimo exigido por função em cada minuto do dia: o maior mínimo entre os turnos cuja janela contém o minuto. */
function requiredByRole(config: StoreConfig, day: DayIndex): Map<string, Int16Array> {
  const result = new Map<string, Int16Array>();
  const wd = weekdayOf(day);
  if (!config.days[wd]?.open) return result;
  for (const m of config.minimums) {
    const need = m.perWeekday[wd] ?? 0;
    if (need <= 0) continue;
    const shift = config.shifts.find((s) => s.id === m.shiftId);
    if (!shift) continue;
    let arr = result.get(m.roleId);
    if (!arr) result.set(m.roleId, (arr = new Int16Array(SPAN)));
    const end = Math.min(SPAN, shift.start + grossMinutes(shift));
    for (let t = shift.start; t < end; t++) if (arr[t] < need) arr[t] = need;
  }
  return result;
}

function arrayFor(map: Map<string, Int16Array>, roleId: string): Int16Array {
  let arr = map.get(roleId);
  if (!arr) map.set(roleId, (arr = new Int16Array(SPAN)));
  return arr;
}

function addRange(arr: Int16Array, from: number, to: number, delta: number): void {
  const lo = Math.max(0, from);
  const hi = Math.min(SPAN, to);
  for (let t = lo; t < hi; t++) arr[t] += delta;
}

const EMPTY = new Int16Array(SPAN);

/**
 * Escolhe o início do almoço de uma jornada sem horário informado: grade de 15min entre
 * entrada + 2h e entrada + 6h, terminando antes da saída. Critérios, em ordem: minutos em que a
 * função fica abaixo do mínimo; minutos de sobreposição com outros almoços da função; distância
 * do meio da jornada; o mais cedo.
 */
function chooseLunch(job: Job, req: Int16Array, present: Int16Array, lunch: Int16Array): Minutes {
  const b = job.hours.breakMinutes;
  const first = Math.ceil((job.start + LUNCH_MIN_OFFSET) / GRID) * GRID;
  const last = Math.min(job.start + LUNCH_MAX_OFFSET, job.end - b - 1);
  const ideal = job.start + (job.end - job.start) / 2 - b / 2;
  let best: Minutes | null = null;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];
  for (let s = first; s <= last; s += GRID) {
    let short = 0;
    let overlap = 0;
    const hi = Math.min(SPAN, s + b);
    for (let t = s; t < hi; t++) {
      if (req[t] > 0 && present[t] - lunch[t] - 1 < req[t]) short++;
      overlap += lunch[t];
    }
    const score: [number, number, number] = [short, overlap, Math.abs(s - ideal)];
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
    const req = requiredByRole(input.config, day);
    const present = new Map<string, Int16Array>();
    const lunch = new Map<string, Int16Array>();
    for (const j of jobs) addRange(arrayFor(present, j.roleId), j.start, j.end, 1);

    // Almoços informados primeiro: os planejados se ajustam a eles.
    const planned: Job[] = [];
    for (const j of jobs) {
      if (j.hours.breakMinutes <= 0) continue;
      const explicit = explicitLunchStart(j.hours);
      if (explicit === null) {
        planned.push(j);
        continue;
      }
      row(j.key)[day] = explicit;
      addRange(arrayFor(lunch, j.roleId), explicit, explicit + j.hours.breakMinutes, 1);
    }
    // Ordem estável: entrada, saída, ordem da equipe (sort é estável).
    planned.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const j of planned) {
      const lunchArr = arrayFor(lunch, j.roleId);
      const s = chooseLunch(j, req.get(j.roleId) ?? EMPTY, arrayFor(present, j.roleId), lunchArr);
      row(j.key)[day] = s;
      addRange(lunchArr, s, s + j.hours.breakMinutes, 1);
    }
  }
  return plan;
}

function blocksFor(ctx: Context, plan: LunchPlan, day: DayIndex): PresenceBlock[] {
  return jobsForDay(ctx, day).map((j) => {
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
}

/** Quem trabalha no dia, com a função contada e o almoço (informado ou do plano). */
export function presenceForDay(input: LunchInput, plan: LunchPlan, day: DayIndex): PresenceBlock[] {
  return blocksFor(makeContext(input), plan, day);
}

/**
 * Trechos em que uma função fica abaixo do mínimo SÓ por causa de almoços (contando quem está
 * almoçando, o mínimo seria atendido). Fora das janelas dos turnos com mínimo, nada é conferido.
 */
export function findLunchGaps(input: LunchInput, plan: LunchPlan): LunchGap[] {
  const ctx = makeContext(input);
  const roleOrder = new Map(input.config.roles.map((r, i) => [r.id, i]));
  const gaps: LunchGap[] = [];
  for (let day = 0; day < CYCLE_DAYS; day++) {
    const blocks = blocksFor(ctx, plan, day);
    if (blocks.length === 0) continue;
    const req = requiredByRole(input.config, day);
    const present = new Map<string, Int16Array>();
    const lunch = new Map<string, Int16Array>();
    for (const bl of blocks) {
      addRange(arrayFor(present, bl.roleId), bl.start, bl.end, 1);
      if (bl.breakStart !== null && bl.breakEnd !== null) {
        addRange(arrayFor(lunch, bl.roleId), bl.breakStart, bl.breakEnd, 1);
      }
    }
    const roles = [...req.keys()].sort((a, b) => (roleOrder.get(a) ?? Infinity) - (roleOrder.get(b) ?? Infinity));
    for (const roleId of roles) {
      const r = req.get(roleId)!;
      const p = present.get(roleId) ?? EMPTY;
      const l = lunch.get(roleId) ?? EMPTY;
      let open: LunchGap | null = null;
      for (let t = 0; t <= SPAN; t++) {
        const working = t < SPAN ? p[t] - l[t] : 0;
        const caused = t < SPAN && r[t] > 0 && working < r[t] && p[t] >= r[t];
        if (caused) {
          const missing = r[t] - working;
          if (open) {
            open.to = t + 1;
            open.missing = Math.max(open.missing, missing);
          } else {
            open = { day, roleId, from: t, to: t + 1, missing };
          }
        } else if (open) {
          gaps.push(open);
          open = null;
        }
      }
    }
  }
  return gaps;
}
