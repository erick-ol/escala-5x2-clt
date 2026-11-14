import {
  DAILY_LIMIT_MINUTES,
  INTERSHIFT_REST_MINUTES,
  MIN_DAYS_OFF_PER_WEEK,
  WEEKLY_LIMIT_MINUTES,
  WEEKLY_REST_MINUTES,
} from './legal';
import { LUNCH_MAX_OFFSET, explicitLunchStart, extraLunchKey, type LunchPlan } from './lunch';
import { MINUTES_PER_DAY, effectiveHours, formatDuration, grossMinutes, weekOf, workedMinutes } from './time';
import {
  CYCLE_DAYS,
  DAYS_PER_WEEK,
  SUNDAY,
  WEEKS,
  type DayIndex,
  type Employee,
  type ExtraShift,
  type Schedule,
  type StoreConfig,
  type WorkHours,
} from './types';

export type AlertKind =
  | 'weekly-limit'
  | 'daily-limit'
  | 'days-off'
  | 'too-many-offs'
  | 'break'
  | 'break-late'
  | 'intershift-rest'
  | 'weekly-rest'
  | 'sunday-rotation'
  | 'work-streak'
  | 'no-hours';

export interface LegalAlert {
  kind: AlertKind;
  employeeId: string;
  day: DayIndex | null;
  week: number | null;
  message: string;
}

export interface EmployeeReport {
  employeeId: string;
  /** Minutos trabalhados em cada semana do ciclo (3 entradas). */
  weeklyMinutes: number[];
  alerts: LegalAlert[];
}

export interface RulesInput {
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule;
  /** Jornadas extras de "coberto por [funcionário]" (KTD16). */
  extraShifts?: ExtraShift[];
  /**
   * Almoços planejados pelo site (lunch.ts). Com ele, o almoço planejado entra na conferência de
   * 'break-late'; o início informado (`breakStart`) sempre entra. Sem nenhum dos dois, não confere.
   */
  lunchPlan?: LunchPlan;
}

const CYCLE_MINUTES = CYCLE_DAYS * MINUTES_PER_DAY;
const WEEK_MINUTES = DAYS_PER_WEEK * MINUTES_PER_DAY;
/** Parte de 24h do descanso semanal que precisa cair dentro da semana. */
const WEEKLY_REST_CORE_MINUTES = 24 * 60;
const MAX_ASSIGNED_OFFS_PER_WEEK = 2;
/** Máximo de dias seguidos de trabalho antes do descanso semanal. */
export const MAX_WORK_STREAK = 6;

/** Sequências de dias trabalhados no ciclo circular: dia inicial e tamanho. Sem descanso nenhum, uma de 21. */
export function workStreaks(worked: boolean[]): { start: DayIndex; length: number }[] {
  const n = worked.length;
  const restDay = worked.findIndex((w) => !w);
  if (restDay < 0) return n > 0 ? [{ start: 0, length: n }] : [];
  const streaks: { start: DayIndex; length: number }[] = [];
  let start = -1;
  for (let k = 1; k <= n; k++) {
    const d = (restDay + k) % n;
    if (worked[d]) {
      if (start < 0) start = d;
    } else if (start >= 0) {
      streaks.push({ start, length: (d - start + n) % n });
      start = -1;
    }
  }
  return streaks;
}

/** Jornada posicionada na linha do tempo do ciclo (minutos desde segunda 00:00 da semana 1). */
interface Jornada {
  day: DayIndex;
  /** Chave da jornada no LunchPlan. */
  lunchKey: string;
  hours: WorkHours;
  start: number;
  end: number;
  worked: number;
}

/** Jornadas de um dia somadas num bloco (KTD16: duas jornadas no mesmo dia contam juntas). */
interface DayBlock {
  day: DayIndex;
  start: number;
  end: number;
  worked: number;
  /** Intervalos declarados mais as pausas entre jornadas do mesmo dia. */
  pause: number;
  jornadas: Jornada[];
}

function toJornada(day: DayIndex, hours: WorkHours, lunchKey: string): Jornada {
  const start = day * MINUTES_PER_DAY + hours.start;
  return { day, lunchKey, hours, start, end: start + grossMinutes(hours), worked: workedMinutes(hours) };
}

function buildDays(
  input: RulesInput,
  employee: Employee,
): { blocks: (DayBlock | null)[]; worked: boolean[]; missingHours: DayIndex[] } {
  const cells = input.schedule[employee.id] ?? [];
  const extras = (input.extraShifts ?? []).filter((x) => x.employeeId === employee.id);
  const blocks: (DayBlock | null)[] = [];
  const worked: boolean[] = [];
  const missingHours: DayIndex[] = [];
  for (let day = 0; day < CYCLE_DAYS; day++) {
    const cell = cells[day];
    const jornadas: Jornada[] = [];
    if (cell?.status === 'work') {
      const hours = effectiveHours(input.config, employee, cell, day);
      if (hours) jornadas.push(toJornada(day, hours, employee.id));
      else missingHours.push(day);
    }
    for (const x of extras) if (x.day === day) jornadas.push(toJornada(day, x.hours, extraLunchKey(x)));
    worked.push(cell?.status === 'work' || jornadas.length > 0);
    if (jornadas.length === 0) {
      blocks.push(null);
      continue;
    }
    jornadas.sort((a, b) => a.start - b.start);
    let pause = 0;
    let end = jornadas[0].end;
    for (const j of jornadas) {
      pause += j.hours.breakMinutes;
      if (j.start > end) pause += j.start - end;
      end = Math.max(end, j.end);
    }
    blocks.push({
      day,
      start: jornadas[0].start,
      end,
      worked: jornadas.reduce((sum, j) => sum + j.worked, 0),
      pause,
      jornadas,
    });
  }
  return { blocks, worked, missingHours };
}

const MAX_BREAK_MINUTES = 120;

/** KTD17: acima de 6h trabalhadas, 1h de intervalo; acima de 4h, 15min. */
function requiredBreak(worked: number): number {
  if (worked > 6 * 60) return 60;
  if (worked > 4 * 60) return 15;
  return 0;
}

/** Quanto do intervalo [a, b) da linha do tempo circular cai dentro de [lo, hi). */
function overlapCircular(a: number, b: number, lo: number, hi: number): number {
  let total = 0;
  for (const shift of [-CYCLE_MINUTES, 0, CYCLE_MINUTES]) {
    total += Math.max(0, Math.min(b, hi + shift) - Math.max(a, lo + shift));
  }
  return total;
}

export function evaluateEmployee(input: RulesInput, employeeId: string): EmployeeReport {
  const employee = input.employees.find((e) => e.id === employeeId);
  const report: EmployeeReport = { employeeId, weeklyMinutes: Array.from({ length: WEEKS }, () => 0), alerts: [] };
  if (!employee) return report;

  const { config } = input;
  const cells = input.schedule[employeeId] ?? [];
  const { blocks, worked, missingHours } = buildDays(input, employee);
  const alert = (kind: AlertKind, day: DayIndex | null, week: number | null, message: string) =>
    report.alerts.push({ kind, employeeId, day, week, message });

  // Dia de trabalho sem turno válido: as horas não podem ser conferidas (turno removido, dado inconsistente).
  for (const day of missingHours) {
    alert('no-hours', day, weekOf(day), 'Dia de trabalho sem turno válido: escolha o turno ou o horário para conferir as regras.');
  }

  // Horas por semana (a jornada pertence ao dia em que começa).
  for (const b of blocks) if (b) report.weeklyMinutes[weekOf(b.day)] += b.worked;

  // Teto semanal do regime.
  const weeklyLimit = WEEKLY_LIMIT_MINUTES[config.regime];
  report.weeklyMinutes.forEach((minutes, week) => {
    if (minutes > weeklyLimit) {
      alert(
        'weekly-limit',
        null,
        week,
        `Semana ${week + 1}: ${formatDuration(minutes)} trabalhadas (teto de ${formatDuration(weeklyLimit)})`,
      );
    }
  });

  // Folgas: ao menos 2 dias sem trabalho e no máximo 2 folgas atribuídas por semana (KTD14).
  for (let week = 0; week < WEEKS; week++) {
    let daysWithoutWork = 0;
    let assignedOffs = 0;
    for (let d = week * DAYS_PER_WEEK; d < (week + 1) * DAYS_PER_WEEK; d++) {
      if (!worked[d]) daysWithoutWork++;
      if (cells[d]?.status === 'off') assignedOffs++;
    }
    if (daysWithoutWork < MIN_DAYS_OFF_PER_WEEK) {
      alert(
        'days-off',
        null,
        week,
        `Semana ${week + 1} com ${daysWithoutWork} ${daysWithoutWork === 1 ? 'dia' : 'dias'} sem trabalho (mínimo ${MIN_DAYS_OFF_PER_WEEK})`,
      );
    }
    if (assignedOffs > MAX_ASSIGNED_OFFS_PER_WEEK) {
      alert('too-many-offs', null, week, `Semana ${week + 1} com ${assignedOffs} folgas (máximo ${MAX_ASSIGNED_OFFS_PER_WEEK})`);
    }
  }

  // Por dia: limite de 8h24 (42h, liminar do STF) ou 8h (40h) (R17a) e intervalo intrajornada (KTD17).
  for (const b of blocks) {
    if (!b) continue;
    const dailyLimit = DAILY_LIMIT_MINUTES[config.regime];
    if (b.worked > dailyLimit) {
      alert(
        'daily-limit',
        b.day,
        weekOf(b.day),
        config.regime === '42h'
          ? `${formatDuration(b.worked)} trabalhadas no dia (limite de 8h24 na transição de 42h). Acima disso, só com acordo ou convenção coletiva.`
          : `${formatDuration(b.worked)} trabalhadas no dia (limite de 8h). Acima disso, só com acordo ou convenção coletiva.`,
      );
    }
    const checks =
      b.jornadas.length === 1
        ? [{ worked: b.worked, pause: b.pause }]
        : [...b.jornadas.map((j) => ({ worked: j.worked, pause: j.hours.breakMinutes })), { worked: b.worked, pause: b.pause }];
    const failed = checks.find((c) => c.pause < requiredBreak(c.worked));
    const tooLong = b.jornadas.find((j) => j.worked > 6 * 60 && j.hours.breakMinutes > MAX_BREAK_MINUTES);
    if (tooLong) {
      alert(
        'break',
        b.day,
        weekOf(b.day),
        `Intervalo de ${formatDuration(tooLong.hours.breakMinutes)} (máximo de 2h sem acordo ou convenção coletiva)`,
      );
    }
    // Almoço tem de começar até a 6ª hora de trabalho (início informado ou planejado pelo site).
    for (const j of b.jornadas) {
      if (j.worked <= 6 * 60 || j.hours.breakMinutes <= 0) continue;
      const lunch = explicitLunchStart(j.hours) ?? input.lunchPlan?.[j.lunchKey]?.[j.day] ?? null;
      if (lunch !== null && lunch - j.hours.start > LUNCH_MAX_OFFSET) {
        alert('break-late', b.day, weekOf(b.day), 'Almoço começa depois de 6h de trabalho (máximo 6h antes da pausa)');
        break;
      }
    }
    if (failed) {
      alert(
        'break',
        b.day,
        weekOf(b.day),
        `Jornada de ${formatDuration(failed.worked)} com intervalo de ${formatDuration(failed.pause)} (mínimo ${formatDuration(requiredBreak(failed.worked))})`,
      );
    }
  }

  // Descansos entre blocos, na linha do tempo circular (KTD5).
  const timeline = blocks.filter((b): b is DayBlock => b !== null);
  const rests: { start: number; end: number; length: number }[] = [];
  timeline.forEach((b, i) => {
    const prev = timeline[(i - 1 + timeline.length) % timeline.length];
    const prevEnd = i === 0 ? prev.end - CYCLE_MINUTES : prev.end;
    const length = b.start - prevEnd;
    rests.push({ start: prevEnd, end: b.start, length });
    if (length < INTERSHIFT_REST_MINUTES) {
      alert(
        'intershift-rest',
        b.day,
        weekOf(b.day),
        `Descanso de ${formatDuration(Math.max(0, length))} entre jornadas (mínimo ${formatDuration(INTERSHIFT_REST_MINUTES)})`,
      );
    }
  });

  // Descanso semanal: em cada semana, um descanso de 35h seguidas do qual ao menos 24h caem dentro da semana.
  // Assim, uma folga que só invade a semana por algumas horas não conta para ela.
  if (timeline.length > 0) {
    for (let week = 0; week < WEEKS; week++) {
      const lo = week * WEEK_MINUTES;
      const hi = lo + WEEK_MINUTES;
      const ok = rests.some(
        (r) => r.length >= WEEKLY_REST_MINUTES && overlapCircular(r.start, r.end, lo, hi) >= WEEKLY_REST_CORE_MINUTES,
      );
      if (!ok) {
        const longest = Math.max(
          0,
          ...rests.filter((r) => overlapCircular(r.start, r.end, lo, hi) > 0).map((r) => Math.min(r.length, overlapCircular(r.start, r.end, lo, hi))),
        );
        alert(
          'weekly-rest',
          null,
          week,
          `Semana ${week + 1} sem descanso de 35h seguidas (maior descanso: ${formatDuration(longest)})`,
        );
      }
    }
  }

  // Dias seguidos de trabalho (circular; jornada extra conta como dia trabalhado).
  for (const streak of workStreaks(worked)) {
    if (streak.length > MAX_WORK_STREAK) {
      alert(
        'work-streak',
        streak.start,
        weekOf(streak.start),
        `${streak.length} dias seguidos de trabalho (máximo ${MAX_WORK_STREAK} antes do descanso semanal)`,
      );
    }
  }

  // Rodízio de domingo (R10, R10a). Domingo de loja fechada é descanso para todos (KTD14).
  {
    const sundays = Array.from({ length: WEEKS }, (_, w) => w * DAYS_PER_WEEK + SUNDAY);
    const workedSunday = sundays.map((d) => worked[d]);
    if (employee.isWoman) {
      // Um domingo de folga a cada 2 semanas: nunca dois domingos seguidos (domingo 3 → domingo 1 do próximo ciclo).
      sundays.forEach((d, w) => {
        const prev = (w - 1 + WEEKS) % WEEKS;
        if (workedSunday[w] && workedSunday[prev]) {
          alert(
            'sunday-rotation',
            d,
            w,
            'Trabalha 2 domingos seguidos. Precisa folgar ao menos um domingo a cada 2 semanas.',
          );
        }
      });
    } else if (workedSunday.every(Boolean)) {
      // Um domingo de folga a cada 3 semanas: no ciclo de 3, ao menos 1 dos 3.
      alert(
        'sunday-rotation',
        null,
        null,
        'Trabalha os 3 domingos do ciclo. Precisa folgar ao menos um domingo a cada 3 semanas.',
      );
    }
  }

  return report;
}

export function evaluateRules(input: RulesInput): Record<string, EmployeeReport> {
  const result: Record<string, EmployeeReport> = {};
  for (const e of input.employees) result[e.id] = evaluateEmployee(input, e.id);
  return result;
}
