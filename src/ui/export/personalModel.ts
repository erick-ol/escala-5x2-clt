import { computeCoverage, type CoverageResult } from '../../domain/coverage';
import { formatDayMonth, formatFullDate, monthLabel } from '../../domain/dates';
import { extraLunchKey, planLunches, type LunchPlan } from '../../domain/lunch';
import { isInMonth, monthWeeks, projectWeek } from '../../domain/month';
import {
  SINGLE_SHIFT_NAME,
  effectiveHours,
  effectiveShiftId,
  findShift,
  formatDuration,
  formatTime,
  isVirtualShiftId,
  registeredHours,
  weekdayOf,
  workedMinutes,
} from '../../domain/time';
import {
  COLUMN_SHORT,
  DAYS_PER_WEEK,
  WEEKDAY_SHORT,
  WEEKS,
  type AppDocument,
  type Cell,
  type DayIndex,
  type Employee,
  type ISODate,
  type StoreConfig,
  type WorkHours,
} from '../../domain/types';
import { slugify } from './download';
import { displayStoreName, formatRange, singleShiftInitial } from './exportModel';

/**
 * Escala individual (para entregar a cada pessoa): só os próprios horários, almoço e folgas.
 * Nunca inclui alertas, buracos de outras pessoas nem a marcação "Funcionária mulher" (R5a, R20).
 */

export type PersonalScope = { kind: 'cycle' } | { kind: 'month'; year: number; month: number };

export type PersonalDayKind = 'work' | 'off' | 'closed' | 'holiday' | 'none';

export interface PersonalDay {
  key: string;
  /** "Seg 30/11" (mês) ou "Semana 1 · Seg" (ciclo). */
  label: string;
  kind: PersonalDayKind;
  /** "06:30–14:00 · almoço 10:00–11:00", "Folga", "Loja fechada", "Feriado", "Turno único 07:00–13:00 · almoço …". */
  text: string;
  /** "cobre balconista": dia em que a pessoa vai para a segunda área. */
  note?: string;
  /** Jornadas extras ("coberto por [esta pessoa]"): "Cobre balconista · Tarde 13:00–20:30 · almoço …". */
  extras: string[];
  /** Data fora do mês exportado (sai apagada). */
  outside?: boolean;
  /** Data real (só no mês): o calendário mostra o número do dia. */
  date?: ISODate;
  /** Dia de trabalho, em partes, para o calendário: "U" ou "Tarde" (turno fora do cadastro). */
  shiftTag?: string;
  /** "06:30–14:00" */
  range?: string;
  /** "almoço 11:30–12:30" */
  lunch?: string;
}

export interface PersonalWeek {
  key: string;
  /** "Semana de 30/11" (mês) ou "Semana 1" (ciclo). */
  label: string;
  minutes: number;
  /** "40h", "37h30" */
  total: string;
  days: PersonalDay[];
}

export interface PersonalModel {
  employeeId: string;
  storeName: string;
  name: string;
  /** "Caixa · cobre balconista quando preciso" */
  roleLine: string;
  /** "Manhã · 06:30–14:00 · 1h de almoço" */
  shiftLine: string;
  /** "Ciclo de 3 semanas a partir de 30/11/2026" ou "Dezembro de 2026" */
  periodLabel: string;
  scope: PersonalScope['kind'];
  weeks: PersonalWeek[];
  /** Mês exportado (só no escopo do mês). */
  month?: { year: number; month: number };
  /** "escala-andreza-dezembro-2026.png" */
  fileName: string;
  /** "Escala de Andreza — Dezembro de 2026" */
  shareTitle: string;
}

const lower = (text: string) => text.trim().toLocaleLowerCase('pt-BR');

/** Dados de uma semana já calculados (ciclo inteiro ou documento sintético de uma semana do mês). */
interface Source {
  config: StoreConfig;
  cells: Record<string, (Cell | undefined)[]>;
  coverage: CoverageResult;
  lunchPlan: LunchPlan;
  /** Feriado por índice de dia. */
  holiday(day: DayIndex): boolean;
}

function lunchOnly(hours: WorkHours, start: number | null | undefined): string {
  if (hours.breakMinutes <= 0 || start === null || start === undefined) return '';
  return `intervalo ${formatTime(start)}–${formatTime(start + hours.breakMinutes)}`;
}

function lunchText(hours: WorkHours, start: number | null | undefined): string {
  const lunch = lunchOnly(hours, start);
  return lunch ? ` · ${lunch}` : '';
}

function buildDay(
  src: Source,
  e: Employee,
  roleName: Map<string, string>,
  day: DayIndex,
  label: string,
  key: string,
  outside: boolean,
  singleTag: string,
  date?: ISODate,
): { day: PersonalDay; minutes: number } {
  const { config } = src;
  const cell = src.cells[e.id]?.[day];
  let minutes = 0;

  const extras = src.coverage.extraShifts
    .filter((x) => x.employeeId === e.id && x.day === day)
    .map((x) => {
      minutes += workedMinutes(x.hours);
      const shift = findShift(config, x.shiftId);
      const shiftName = shift ? (isVirtualShiftId(shift.id) ? SINGLE_SHIFT_NAME : shift.name) : '';
      const role = lower(roleName.get(x.roleId ?? e.roleId) ?? '');
      const lunch = lunchText(x.hours, src.lunchPlan[extraLunchKey(x)]?.[day]);
      return `Cobre ${role}${shiftName ? ` · ${shiftName}` : ''} ${formatRange(x.hours)}${lunch}`;
    });

  const base = { key, label, extras, ...(outside ? { outside: true } : {}), ...(date ? { date } : {}) };
  if (src.holiday(day)) return { day: { ...base, kind: 'holiday', text: 'Feriado' }, minutes };
  if (!cell) return { day: { ...base, kind: 'none', text: '—' }, minutes };
  if (cell.status === 'closed') return { day: { ...base, kind: 'closed', text: 'Loja fechada' }, minutes };
  if (cell.status === 'off') return { day: { ...base, kind: 'off', text: 'Folga' }, minutes };

  const hours = effectiveHours(config, e, cell, day);
  const shiftId = effectiveShiftId(config, e, cell, day);
  if (!hours) return { day: { ...base, kind: 'work', text: 'Trabalha (horário a definir)' }, minutes };
  minutes += workedMinutes(hours);
  // Nome do turno só quando não é o do cadastro (turno único, troca de turno no dia).
  const prefix = isVirtualShiftId(shiftId)
    ? `${SINGLE_SHIFT_NAME} `
    : shiftId !== e.shiftId
      ? `${findShift(config, shiftId)?.name ?? ''} `.trimStart()
      : '';
  const range = formatRange(hours);
  const lunch = lunchOnly(hours, src.lunchPlan[e.id]?.[day]);
  const text = `${prefix}${range}${lunch ? ` · ${lunch}` : ''}`;
  const shiftTag = isVirtualShiftId(shiftId) ? singleTag : prefix.trim();
  const flex = src.coverage.flex.find((f) => f.employeeId === e.id && f.day === day);
  const note = flex ? `cobre ${lower(roleName.get(flex.roleId) ?? '')}` : undefined;
  const parts = { range, ...(lunch ? { lunch } : {}), ...(shiftTag ? { shiftTag } : {}) };
  return { day: { ...base, kind: 'work', text, ...parts, ...(note ? { note } : {}) }, minutes };
}

function header(document: AppDocument, e: Employee, roleName: Map<string, string>) {
  const { config } = document;
  const role = roleName.get(e.roleId) ?? '';
  const secondary =
    e.secondaryRoleId && e.secondaryRoleId !== e.roleId ? roleName.get(e.secondaryRoleId) : undefined;
  const roleLine = secondary ? `${role} · cobre ${lower(secondary)} quando preciso` : role;
  const shift = config.shifts.find((s) => s.id === e.shiftId);
  const hours = registeredHours(config, e);
  const parts = [shift?.name ?? '', hours ? formatRange(hours) : ''];
  if (hours && hours.breakMinutes > 0) parts.push(`${formatDuration(hours.breakMinutes)} de intervalo`);
  return { roleLine, shiftLine: parts.filter(Boolean).join(' · ') };
}

function finish(
  document: AppDocument,
  e: Employee,
  roleName: Map<string, string>,
  scope: PersonalScope,
  periodLabel: string,
  weeks: PersonalWeek[],
): PersonalModel {
  const name = e.name.trim() || 'Funcionário';
  const period = scope.kind === 'month' ? slugify(periodLabel.replace(/ de /g, ' ')) : 'ciclo';
  return {
    employeeId: e.id,
    storeName: displayStoreName(document),
    name,
    ...header(document, e, roleName),
    periodLabel,
    scope: scope.kind,
    ...(scope.kind === 'month' ? { month: { year: scope.year, month: scope.month } } : {}),
    weeks,
    fileName: `escala-${slugify(name)}-${period}.png`,
    shareTitle: `Escala de ${name} — ${periodLabel}`,
  };
}

function cycleModels(document: AppDocument): PersonalModel[] {
  const { config, employees, schedule, marks } = document;
  if (!schedule) return [];
  const coverage = computeCoverage({ config, employees, schedule, marks });
  const lunchPlan = planLunches({ config, employees, schedule, flex: coverage.flex, extraShifts: coverage.extraShifts });
  const src: Source = { config, cells: schedule, coverage, lunchPlan, holiday: () => false };
  const roleName = new Map(config.roles.map((r) => [r.id, r.name]));
  const periodLabel = `Ciclo de ${WEEKS} semanas a partir de ${formatFullDate(document.calendar.cycleStart)}`;
  const singleTag = singleShiftInitial(config.shifts);
  return employees.map((e) => {
    const weeks = Array.from({ length: WEEKS }, (_, w): PersonalWeek => {
      let minutes = 0;
      const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
        const d = w * DAYS_PER_WEEK + i;
        const label = `Semana ${w + 1} · ${WEEKDAY_SHORT[weekdayOf(d)]}`;
        const r = buildDay(src, e, roleName, d, label, `c${d}`, false, singleTag);
        minutes += r.minutes;
        return r.day;
      });
      return { key: `s${w}`, label: `Semana ${w + 1}`, minutes, total: formatDuration(minutes), days };
    });
    return finish(document, e, roleName, { kind: 'cycle' }, periodLabel, weeks);
  });
}

function monthModels(document: AppDocument, year: number, month: number): PersonalModel[] {
  if (!document.schedule) return [];
  const projected = monthWeeks(year, month).map((sunday) => projectWeek(document, sunday)!);
  const roleName = new Map(document.config.roles.map((r) => [r.id, r.name]));
  const periodLabel = monthLabel(year, month);
  const singleTag = singleShiftInitial(document.config.shifts);
  const sources = projected.map(
    (w): Source => ({
      config: w.doc.config,
      cells: w.doc.schedule!,
      coverage: w.coverage,
      lunchPlan: w.lunchPlan,
      holiday: (day) => !!w.holidays[day - w.firstDay],
    }),
  );
  return document.employees.map((e) => {
    const weeks = projected.map((w, wi): PersonalWeek => {
      let minutes = 0;
      const days = w.dates.map((date: ISODate, i) => {
        const d = w.firstDay + i;
        const label = `${COLUMN_SHORT[i]} ${formatDayMonth(date)}`;
        const r = buildDay(sources[wi], e, roleName, d, label, date, !isInMonth(date, year, month), singleTag, date);
        minutes += r.minutes;
        return r.day;
      });
      return {
        key: w.sunday,
        label: `Semana de ${formatDayMonth(w.sunday)}`,
        minutes,
        total: formatDuration(minutes),
        days,
      };
    });
    return finish(document, e, roleName, { kind: 'month', year, month }, periodLabel, weeks);
  });
}

/** Escalas individuais de toda a equipe, na ordem do cadastro (vazio se ainda não há escala). */
export function buildPersonalModels(document: AppDocument, scope: PersonalScope): PersonalModel[] {
  return scope.kind === 'month' ? monthModels(document, scope.year, scope.month) : cycleModels(document);
}

/** Escala individual de uma pessoa; null se não há escala ou a pessoa não existe. */
export function buildPersonalModel(document: AppDocument, employeeId: string, scope: PersonalScope): PersonalModel | null {
  return buildPersonalModels(document, scope).find((m) => m.employeeId === employeeId) ?? null;
}

/** Linhas da escala individual que a pessoa vai ler (para testes e acessibilidade). */
export function personalDayText(day: PersonalDay): string {
  return [day.text, day.note, ...day.extras].filter(Boolean).join(' · ');
}
