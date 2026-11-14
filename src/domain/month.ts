import { computeCoverage, type CoverageResult } from './coverage';
import { addDays, daysBetween, daysInMonth, formatDayMonth, sundayOnOrBefore, toISODate, weekdayOfDate } from './dates';
import { findLunchGaps, planLunches, type LunchGap, type LunchInput, type LunchPlan } from './lunch';
import { evaluateRules, type LegalAlert } from './rules';
import { columnOf } from './time';
import {
  CYCLE_DAYS,
  DAYS_PER_WEEK,
  type AppDocument,
  type Cell,
  type DayIndex,
  type ExtraShift,
  type ISODate,
  type LunchMark,
  type Schedule,
  type Weekday,
} from './types';

/**
 * Visão Mês: o ciclo de 21 dias projetado nas datas reais.
 *
 * - Dia do ciclo de uma data = (dias desde `calendar.cycleStart`) mod 21. Como o ciclo começa num domingo,
 *   o dia da semana sempre bate e cada semana de domingo a sábado cai inteira numa semana do ciclo.
 * - Célula efetiva numa data: feriado (loja fechada para todos) > ajuste da data > ciclo.
 * - Cobertura e almoço: para cada semana real, um documento "sintético" com o ciclo em que a semana
 *   correspondente foi trocada pelas células das datas (as outras duas semanas ficam de folga e são ignoradas)
 *   e, nos feriados, o dia da semana fechado na configuração (sem mínimo). Assim cobertura, almoço e visão do dia
 *   reaproveitam as funções do ciclo sem mudança. As marcações de cobertura e de almoço do ciclo valem nas datas
 *   que caem no mesmo dia do ciclo (menos nos feriados).
 * - Regras CLT: modo linear (sem emendar o fim no começo) sobre as datas do mês com margem de semanas antes
 *   e depois, para pegar descansos, sequências e domingos que atravessam a virada do mês.
 *   Só aparecem os alertas que tocam alguma data do mês.
 */

/** Semanas de margem antes do mês: 2, para o rodízio de domingo dos homens (3 domingos seguidos) no 1º domingo. */
export const PAD_WEEKS_BEFORE = 2;
/** Semanas de margem depois do mês: descanso e interjornada que atravessam a virada. */
export const PAD_WEEKS_AFTER = 1;

export function cycleDayOf(cycleStart: ISODate, date: ISODate): DayIndex {
  const n = daysBetween(cycleStart, date);
  return ((n % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
}

/** Semana do ciclo (0, 1 ou 2) em que cai a data. */
export function cycleWeekOf(cycleStart: ISODate, date: ISODate): number {
  return Math.floor(cycleDayOf(cycleStart, date) / DAYS_PER_WEEK);
}

/** As 7 datas da semana que começa no domingo `sunday`. */
export function weekDates(sunday: ISODate): ISODate[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(sunday, i));
}

export function monthDates(year: number, month: number): ISODate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => toISODate(year, month, i + 1));
}

/** Domingos das semanas (domingo a sábado) que têm ao menos um dia no mês. */
export function monthWeeks(year: number, month: number): ISODate[] {
  const first = sundayOnOrBefore(toISODate(year, month, 1));
  const last = toISODate(year, month, daysInMonth(year, month));
  const weeks: ISODate[] = [];
  for (let sunday = first; sunday <= last; sunday = addDays(sunday, DAYS_PER_WEEK)) weeks.push(sunday);
  return weeks;
}

export function isInMonth(date: ISODate, year: number, month: number): boolean {
  return date.startsWith(`${toISODate(year, month, 1).slice(0, 7)}-`);
}

export type CellSource = 'cycle' | 'override' | 'holiday';

export interface DateCell {
  /** Célula que vale na data (undefined se a pessoa não tem linha no ciclo). */
  cell: Cell | undefined;
  source: CellSource;
  cycleDay: DayIndex;
  /** Célula do ciclo naquele dia (sem ajuste da data nem feriado). */
  cycleCell: Cell | undefined;
}

const overrideKey = (date: ISODate, employeeId: string) => `${date}|${employeeId}`;

function overrideIndex(doc: AppDocument): Map<string, Cell> {
  return new Map(doc.calendar.dateOverrides.map((o) => [overrideKey(o.date, o.employeeId), o.cell]));
}

/** Feriado numa data em que a loja abriria (num dia da semana fechado, a loja já está fechada pelo ciclo). */
export function isHolidayDate(doc: AppDocument, date: ISODate): boolean {
  return doc.calendar.closedDates.includes(date) && !!doc.config.days[weekdayOfDate(date)]?.open;
}

function resolveCell(
  doc: AppDocument,
  overrides: Map<string, Cell>,
  holidays: ReadonlySet<ISODate>,
  employeeId: string,
  date: ISODate,
): DateCell {
  const cycleDay = cycleDayOf(doc.calendar.cycleStart, date);
  const cycleCell = doc.schedule?.[employeeId]?.[cycleDay];
  if (holidays.has(date) && doc.config.days[weekdayOfDate(date)]?.open) {
    return { cell: cycleCell ? { status: 'closed' } : undefined, source: 'holiday', cycleDay, cycleCell };
  }
  const override = overrides.get(overrideKey(date, employeeId));
  if (override && cycleCell && cycleCell.status !== 'closed') return { cell: override, source: 'override', cycleDay, cycleCell };
  return { cell: cycleCell, source: 'cycle', cycleDay, cycleCell };
}

/** Célula efetiva de uma pessoa numa data: feriado > ajuste da data > ciclo. */
export function cellOnDate(doc: AppDocument, employeeId: string, date: ISODate): DateCell {
  return resolveCell(doc, overrideIndex(doc), new Set(doc.calendar.closedDates), employeeId, date);
}

export interface ProjectedWeek {
  /** Domingo que abre a semana (domingo a sábado). */
  sunday: ISODate;
  dates: ISODate[];
  /** Semana do ciclo (0..2) que cai nestas datas. */
  cycleWeek: number;
  /** Primeiro dia do ciclo desta semana (cycleWeek × 7): o documento sintético usa estes índices. */
  firstDay: DayIndex;
  /** Feriado em cada uma das 7 datas. */
  holidays: boolean[];
  /** Células com ajuste da data: `${employeeId}|${i}` (i = 0 domingo … 6 sábado). */
  overridden: Set<string>;
  /**
   * Documento sintético: o ciclo com a semana `cycleWeek` trocada pelas células destas datas, as outras
   * semanas de folga, os feriados como dia fechado na configuração e só as marcações desta semana.
   */
  doc: AppDocument;
  /**
   * Cobertura das 7 datas (buracos, coberturas, segunda área e jornadas extras só desta semana).
   * `summary`/`headline` ficam vazios: o resumo por padrão é coisa do ciclo.
   */
  coverage: CoverageResult;
  lunchInput: LunchInput;
  lunchPlan: LunchPlan;
  /** Almoços sem cobertura (sem os assumidos pelo dono/família). */
  lunchGaps: LunchGap[];
  coveredLunchGaps: LunchGap[];
}

const sameLunch = (m: Pick<LunchMark, 'day' | 'roleId' | 'from' | 'to'>, g: Pick<LunchGap, 'day' | 'roleId' | 'from' | 'to'>) =>
  m.day === g.day && m.roleId === g.roleId && m.from === g.from && m.to === g.to;

function buildWeek(doc: AppDocument, sunday: ISODate, overrides: Map<string, Cell>, holidaySet: ReadonlySet<ISODate>): ProjectedWeek {
  const { config, employees } = doc;
  const dates = weekDates(sunday);
  const cycleWeek = cycleWeekOf(doc.calendar.cycleStart, sunday);
  const firstDay = cycleWeek * DAYS_PER_WEEK;
  const holidays = dates.map((d) => holidaySet.has(d) && !!config.days[weekdayOfDate(d)]?.open);
  const inWeek = (day: number) => day >= firstDay && day < firstDay + DAYS_PER_WEEK && !holidays[day - firstDay];

  const schedule: Schedule = {};
  const overridden = new Set<string>();
  for (const e of employees) {
    if (!doc.schedule?.[e.id]) continue;
    const row: Cell[] = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'off' }));
    dates.forEach((date, i) => {
      const r = resolveCell(doc, overrides, holidaySet, e.id, date);
      if (r.source === 'override') overridden.add(`${e.id}|${i}`);
      row[firstDay + i] = r.cell ?? { status: 'off' };
    });
    schedule[e.id] = row;
  }

  const synthConfig = holidays.some(Boolean)
    ? {
        ...config,
        days: config.days.map((d, wd) => (holidays[columnOf(wd as Weekday)] ? { ...d, open: false, singleShift: false } : d)),
      }
    : config;
  const marks = doc.marks.filter((m) => inWeek(m.day));
  const lunchMarks = (doc.lunchMarks ?? []).filter((m) => inWeek(m.day));
  const synth: AppDocument = { ...doc, config: synthConfig, schedule, marks, lunchMarks };

  const full = computeCoverage({ config: synthConfig, employees, schedule, marks });
  const keep = <T extends { day: number }>(list: T[]) => list.filter((x) => inWeek(x.day));
  const coverage: CoverageResult = {
    ...full,
    gaps: keep(full.gaps),
    covered: keep(full.covered),
    orphanMarks: [],
    extraShifts: keep(full.extraShifts),
    flex: keep(full.flex),
    summary: [],
    headline: '',
  };
  const lunchInput: LunchInput = {
    config: synthConfig,
    employees,
    schedule,
    flex: coverage.flex,
    extraShifts: coverage.extraShifts,
  };
  const lunchPlan = planLunches(lunchInput);
  const allLunch = keep(findLunchGaps(lunchInput, lunchPlan));
  const isCovered = (g: LunchGap) => lunchMarks.some((m) => sameLunch(m, g));

  return {
    sunday,
    dates,
    cycleWeek,
    firstDay,
    holidays,
    overridden,
    doc: synth,
    coverage,
    lunchInput,
    lunchPlan,
    lunchGaps: allLunch.filter((g) => !isCovered(g)),
    coveredLunchGaps: allLunch.filter(isCovered),
  };
}

/** Uma semana real (domingo a sábado) projetada; null se ainda não há escala. */
export function projectWeek(doc: AppDocument, sunday: ISODate): ProjectedWeek | null {
  if (!doc.schedule) return null;
  return buildWeek(doc, sundayOnOrBefore(sunday), overrideIndex(doc), new Set(doc.calendar.closedDates));
}

/** Alerta das regras CLT com as datas reais. */
export interface MonthAlert extends LegalAlert {
  /** Data do alerta (o `day` do alerta), ou null quando vale para a semana inteira. */
  date: ISODate | null;
  /** Última data do trecho (sequência de dias trabalhados), quando passa de um dia. */
  endDate?: ISODate;
  /** Domingo da semana do alerta. */
  weekStart: ISODate | null;
}

export interface MonthEmployeeReport {
  employeeId: string;
  /** Minutos trabalhados em cada semana de `weeks` (semanas que tocam o mês). */
  weeklyMinutes: number[];
  alerts: MonthAlert[];
}

export interface MonthProjection {
  year: number;
  month: number;
  dates: ISODate[];
  weeks: ProjectedWeek[];
  reports: Record<string, MonthEmployeeReport>;
  /** Alertas que tocam o mês, na ordem da equipe. */
  alerts: MonthAlert[];
  /** Vagas sem ninguém em datas do mês. */
  gapCount: number;
  /** Almoços sem cobertura em datas do mês. */
  lunchGapCount: number;
}

/**
 * Projeção de um mês: semanas com cobertura e almoço por data e regras CLT em linha reta.
 * Devolve null se ainda não há escala.
 */
export function projectMonth(doc: AppDocument, year: number, month: number): MonthProjection | null {
  if (!doc.schedule) return null;
  const overrides = overrideIndex(doc);
  const holidaySet = new Set(doc.calendar.closedDates);
  const sundays = monthWeeks(year, month);
  const before = Array.from({ length: PAD_WEEKS_BEFORE }, (_, i) => addDays(sundays[0], -DAYS_PER_WEEK * (PAD_WEEKS_BEFORE - i)));
  const after = Array.from({ length: PAD_WEEKS_AFTER }, (_, i) => addDays(sundays[sundays.length - 1], DAYS_PER_WEEK * (i + 1)));
  const rangeSundays = [...before, ...sundays, ...after];
  const projected = rangeSundays.map((s) => buildWeek(doc, s, overrides, holidaySet));
  const weeks = projected.slice(PAD_WEEKS_BEFORE, PAD_WEEKS_BEFORE + sundays.length);
  const rangeStart = rangeSundays[0];
  const days = rangeSundays.length * DAYS_PER_WEEK;
  const dates = monthDates(year, month);
  const inMonth = (date: ISODate) => isInMonth(date, year, month);

  // Linha do tempo linear: células, jornadas extras e almoços planejados de cada semana, em sequência.
  const schedule: Schedule = {};
  for (const e of doc.employees) {
    if (!doc.schedule[e.id]) continue;
    schedule[e.id] = projected.flatMap((w) => w.doc.schedule![e.id].slice(w.firstDay, w.firstDay + DAYS_PER_WEEK));
  }
  const extraShifts: ExtraShift[] = projected.flatMap((w, wi) =>
    w.coverage.extraShifts.map((x) => ({ ...x, day: wi * DAYS_PER_WEEK + (x.day - w.firstDay) })),
  );
  const lunchPlan: LunchPlan = {};
  projected.forEach((w, wi) => {
    for (const [key, row] of Object.entries(w.lunchPlan)) {
      const target = (lunchPlan[key] ??= Array.from({ length: days }, () => null));
      for (let i = 0; i < DAYS_PER_WEEK; i++) target[wi * DAYS_PER_WEEK + i] = row[w.firstDay + i] ?? null;
    }
  });

  const raw = evaluateRules(
    { config: doc.config, employees: doc.employees, schedule, extraShifts, lunchPlan, days },
    { circular: false, weekName: (w) => `Semana de ${formatDayMonth(rangeSundays[w])}` },
  );

  const dateAt = (index: number) => addDays(rangeStart, index);
  const touchesMonth = (a: LegalAlert) => {
    if (a.day !== null) {
      for (let d = a.day; d <= (a.endDay ?? a.day); d++) if (inMonth(dateAt(d))) return true;
      return false;
    }
    if (a.week !== null) return weekDates(rangeSundays[a.week]).some(inMonth);
    return false;
  };
  const toMonthAlert = (a: LegalAlert): MonthAlert => ({
    ...a,
    date: a.day === null ? null : dateAt(a.day),
    ...(a.endDay !== undefined ? { endDate: dateAt(a.endDay) } : {}),
    weekStart: a.week === null ? null : rangeSundays[a.week],
  });

  const reports: Record<string, MonthEmployeeReport> = {};
  const alerts: MonthAlert[] = [];
  for (const e of doc.employees) {
    const r = raw[e.id];
    const list = (r?.alerts ?? []).filter(touchesMonth).map(toMonthAlert);
    reports[e.id] = {
      employeeId: e.id,
      weeklyMinutes: weeks.map((_, i) => r?.weeklyMinutes[PAD_WEEKS_BEFORE + i] ?? 0),
      alerts: list,
    };
    alerts.push(...list);
  }

  let gapCount = 0;
  let lunchGapCount = 0;
  for (const w of weeks) {
    gapCount += w.coverage.gaps.filter((g) => inMonth(w.dates[g.day - w.firstDay])).length;
    lunchGapCount += w.lunchGaps.filter((g) => inMonth(w.dates[g.day - w.firstDay])).length;
  }

  return { year, month, dates, weeks, reports, alerts, gapCount, lunchGapCount };
}

/**
 * Alertas de uma semana real no formato do ciclo (dia = índice do documento sintético, semana = semana do ciclo),
 * para a grade e o painel da célula reaproveitarem a lógica do ciclo. Um alerta que atravessa semanas
 * (sequência de dias trabalhados) aparece em cada semana que ele toca, no primeiro dia dele nessa semana.
 */
export function weekAlertsAsCycle(week: ProjectedWeek, alerts: MonthAlert[]): LegalAlert[] {
  const first = week.dates[0];
  const last = week.dates[DAYS_PER_WEEK - 1];
  const result: LegalAlert[] = [];
  for (const a of alerts) {
    if (a.date === null) {
      if (a.weekStart !== week.sunday) continue;
      result.push({ kind: a.kind, employeeId: a.employeeId, day: null, week: week.cycleWeek, message: a.message });
      continue;
    }
    const end = a.endDate ?? a.date;
    if (end < first || a.date > last) continue;
    const date = a.date < first ? first : a.date;
    const day = week.firstDay + daysBetween(first, date);
    result.push({ kind: a.kind, employeeId: a.employeeId, day, week: week.cycleWeek, message: a.message });
  }
  return result;
}
