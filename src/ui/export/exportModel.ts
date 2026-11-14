import { computeCoverage, type CoverageResult } from '../../domain/coverage';
import { formatDayMonth, monthLabel } from '../../domain/dates';
import { isInMonth, projectMonth } from '../../domain/month';
import { flexFor, flexTag } from '../flex';
import {
  SINGLE_SHIFT_NAME,
  effectiveHours,
  effectiveShiftId,
  formatTime,
  isVirtualShiftId,
  singleShiftOf,
} from '../../domain/time';
import {
  COLUMN_SHORT,
  CYCLE_DAYS,
  DAYS_PER_WEEK,
  WEEKDAY_SHORT,
  WEEK_ORDER,
  type AppDocument,
  type ISODate,
  type Schedule,
  type Shift,
  type StoreConfig,
  type WorkHours,
} from '../../domain/types';

/**
 * Modelo só com o que pode sair na exportação (R20).
 * Nunca inclui alertas internos nem a marcação "Funcionária mulher" (R5a).
 */
export type ExportCell =
  | {
      kind: 'work';
      initial: string;
      times: string;
      /** Marcador "→ Balc." quando a pessoa cobre outra função (segunda área) neste dia. */
      flex?: string;
    }
  | { kind: 'off' }
  /** `holiday`: loja fechada só naquela data (visão Mês). */
  | { kind: 'closed'; holiday?: boolean };

export interface ExportRow {
  id: string;
  name: string;
  roleName: string;
  cells: ExportCell[];
}

export type GapCell =
  | { kind: 'none' }
  | { kind: 'owner'; label: string }
  | { kind: 'employee'; label: string }
  | { kind: 'missing'; label: string };

export interface GapRow {
  key: string;
  label: string;
  cells: GapCell[];
}

export interface LegendItem {
  initial: string;
  name: string;
  times: string;
}

export interface ExportModel {
  storeName: string;
  hasSchedule: boolean;
  legend: LegendItem[];
  rows: ExportRow[];
  gapRows: GapRow[];
}

export const OWNER_LABEL = 'Dono/família';
export const MISSING_LABEL = 'Falta';

export function formatRange(hours: Pick<WorkHours, 'start' | 'end'>): string {
  return `${formatTime(hours.start)}–${formatTime(hours.end)}`;
}

/** Sigla curta por turno: primeira letra; em caso de repetição, duas letras ou número. */
export function shiftInitials(shifts: Shift[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  shifts.forEach((shift, index) => {
    const clean = shift.name.trim().toUpperCase();
    const candidates = [clean.slice(0, 1), clean.slice(0, 2), `T${index + 1}`];
    const initial = candidates.find((c) => c.length > 0 && !used.has(c)) ?? `T${index + 1}`;
    used.add(initial);
    result.set(shift.id, initial);
  });
  return result;
}

/** Sigla do turno único ("U"; "TU" se um turno cadastrado já usa "U"). */
function singleInitial(initials: Map<string, string>): string {
  const used = new Set(initials.values());
  return used.has('U') ? 'TU' : 'U';
}

export function displayStoreName(document: AppDocument): string {
  return document.config.name.trim() || 'Escala';
}

interface Helpers {
  initialOf(shiftId: string): string;
  roleName: Map<string, string>;
  shiftById: Map<string, Shift>;
  nameById: Map<string, string>;
}

function helpers(document: AppDocument): Helpers {
  const { config, employees } = document;
  const initials = shiftInitials(config.shifts);
  const uInitial = singleInitial(initials);
  return {
    initialOf: (shiftId) => (isVirtualShiftId(shiftId) ? uInitial : (initials.get(shiftId) ?? '?')),
    roleName: new Map(config.roles.map((r) => [r.id, r.name])),
    shiftById: new Map(config.shifts.map((s) => [s.id, s])),
    nameById: new Map(employees.map((e) => [e.id, e.name])),
  };
}

function buildLegend(document: AppDocument): LegendItem[] {
  const { config } = document;
  const initials = shiftInitials(config.shifts);
  const uInitial = singleInitial(initials);
  const legend: LegendItem[] = config.shifts.map((s) => ({
    initial: initials.get(s.id) ?? '?',
    name: s.name,
    times: formatRange(s),
  }));
  // Dias de turno único: todos no horário da loja ("U = Turno único Dom 07:00–13:00").
  const singles = WEEK_ORDER.flatMap((w) => {
    const shift = singleShiftOf(config, w);
    return shift ? [`${WEEKDAY_SHORT[w]} ${formatRange(shift)}`] : [];
  });
  if (singles.length > 0) legend.push({ initial: uInitial, name: SINGLE_SHIFT_NAME, times: singles.join(', ') });
  return legend;
}

/**
 * Linhas das pessoas e das vagas para os dias `days` (índices do ciclo, ou do documento sintético de uma
 * semana do mês). As células saem na ordem de `days`.
 */
function buildBody(
  h: Helpers,
  config: StoreConfig,
  employees: AppDocument['employees'],
  schedule: Schedule,
  coverage: CoverageResult,
  days: number[],
): { rows: ExportRow[]; gapRows: GapRow[] } {
  const position = new Map(days.map((d, i) => [d, i]));
  const rows: ExportRow[] = employees.map((e) => {
    const row = schedule[e.id] ?? [];
    const cells: ExportCell[] = days.map((day) => {
      const cell = row[day];
      if (!cell || cell.status === 'closed') return { kind: 'closed' };
      if (cell.status === 'off') return { kind: 'off' };
      const hours = effectiveHours(config, e, cell, day);
      const flex = flexFor(coverage, e.id, day);
      return {
        kind: 'work',
        initial: h.initialOf(effectiveShiftId(config, e, cell, day)),
        times: hours ? formatRange(hours) : '',
        ...(flex ? { flex: flexTag(h.roleName.get(flex.roleId) ?? '') } : {}),
      };
    });
    return { id: e.id, name: e.name, roleName: h.roleName.get(e.roleId) ?? '', cells };
  });

  const all = [
    ...coverage.gaps.map((g) => ({ gap: g, cell: { kind: 'missing', label: MISSING_LABEL } as GapCell })),
    ...coverage.covered.map((c) => ({
      gap: c,
      cell: (c.mark.coveredBy.kind === 'owner'
        ? { kind: 'owner', label: OWNER_LABEL }
        : { kind: 'employee', label: h.nameById.get(c.mark.coveredBy.employeeId) ?? '' }) as GapCell,
    })),
  ].filter((x) => position.has(x.gap.day));

  // Uma linha por função + turno + número da vaga, na ordem da configuração.
  const groups = new Map<string, GapRow>();
  const order: { key: string; shiftIdx: number; roleIdx: number; slot: number }[] = [];
  for (const { gap, cell } of all) {
    // Os turnos únicos de dias diferentes ficam na mesma linha.
    const virtual = isVirtualShiftId(gap.shiftId);
    const key = `${virtual ? 'unico' : gap.shiftId}|${gap.roleId}|${gap.slot}`;
    let group = groups.get(key);
    if (!group) {
      const shiftName = virtual ? SINGLE_SHIFT_NAME : (h.shiftById.get(gap.shiftId)?.name ?? '');
      const slotText = gap.slot > 0 ? ` (${gap.slot + 1}ª vaga)` : '';
      group = {
        key,
        label: `${h.roleName.get(gap.roleId) ?? ''} · ${shiftName}${slotText}`,
        cells: days.map(() => ({ kind: 'none' }) as GapCell),
      };
      groups.set(key, group);
      order.push({
        key,
        shiftIdx: virtual ? config.shifts.length : config.shifts.findIndex((s) => s.id === gap.shiftId),
        roleIdx: config.roles.findIndex((r) => r.id === gap.roleId),
        slot: gap.slot,
      });
    }
    group.cells[position.get(gap.day)!] = cell;
  }
  order.sort((a, b) => a.shiftIdx - b.shiftIdx || a.roleIdx - b.roleIdx || a.slot - b.slot);
  return { rows, gapRows: order.map((o) => groups.get(o.key)!) };
}

export function buildExportModel(document: AppDocument): ExportModel {
  const { config, employees, schedule, marks } = document;
  const legend = buildLegend(document);
  if (!schedule) {
    return { storeName: displayStoreName(document), hasSchedule: false, legend, rows: [], gapRows: [] };
  }
  const coverage = computeCoverage({ config, employees, schedule, marks });
  const days = Array.from({ length: CYCLE_DAYS }, (_, d) => d);
  const { rows, gapRows } = buildBody(helpers(document), config, employees, schedule, coverage, days);
  return { storeName: displayStoreName(document), hasSchedule: true, legend, rows, gapRows };
}

/** Uma semana real (domingo a sábado) da exportação do mês. */
export interface MonthExportWeek {
  /** Domingo que abre a semana. */
  sunday: ISODate;
  dates: ISODate[];
  /** "29/11 – 05/12" */
  label: string;
  cycleWeek: number;
  /** "Dom 29/11" */
  headers: string[];
  /** Data dentro do mês (fora dele, a coluna sai apagada). */
  inMonth: boolean[];
  rows: ExportRow[];
  gapRows: GapRow[];
}

export interface MonthExportModel {
  storeName: string;
  /** "Dezembro de 2026" */
  monthLabel: string;
  legend: LegendItem[];
  weeks: MonthExportWeek[];
}

/** Exportação do mês: o ciclo projetado nas datas, com feriados e ajustes da data. Sem alertas (R20). */
export function buildMonthExportModel(document: AppDocument, year: number, month: number): MonthExportModel | null {
  const projection = projectMonth(document, year, month);
  if (!projection) return null;
  const h = helpers(document);
  const weeks = projection.weeks.map((w): MonthExportWeek => {
    const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => w.firstDay + i);
    const synth = w.doc;
    const body = buildBody(h, synth.config, synth.employees, synth.schedule!, w.coverage, days);
    const rows = body.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c, i): ExportCell => (w.holidays[i] ? { kind: 'closed', holiday: true } : c)),
    }));
    return {
      sunday: w.sunday,
      dates: w.dates,
      label: `${formatDayMonth(w.dates[0])} – ${formatDayMonth(w.dates[6])}`,
      cycleWeek: w.cycleWeek,
      headers: w.dates.map((d, i) => `${COLUMN_SHORT[i]} ${formatDayMonth(d)}`),
      inMonth: w.dates.map((d) => isInMonth(d, year, month)),
      rows,
      gapRows: body.gapRows,
    };
  });
  return { storeName: displayStoreName(document), monthLabel: monthLabel(year, month), legend: buildLegend(document), weeks };
}
