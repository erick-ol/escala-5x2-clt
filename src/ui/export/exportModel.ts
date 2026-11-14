import { computeCoverage } from '../../domain/coverage';
import { effectiveHours, effectiveShiftId, formatTime } from '../../domain/time';
import { CYCLE_DAYS, type AppDocument, type Shift, type WorkHours } from '../../domain/types';

/**
 * Modelo só com o que pode sair na exportação (R20).
 * Nunca inclui alertas internos nem a marcação "Funcionária mulher" (R5a).
 */
export type ExportCell =
  | { kind: 'work'; initial: string; times: string }
  | { kind: 'off' }
  | { kind: 'closed' };

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

export function displayStoreName(document: AppDocument): string {
  return document.config.name.trim() || 'Escala';
}

export function buildExportModel(document: AppDocument): ExportModel {
  const { config, employees, schedule, marks } = document;
  const initials = shiftInitials(config.shifts);
  const roleName = new Map(config.roles.map((r) => [r.id, r.name]));
  const shiftById = new Map(config.shifts.map((s) => [s.id, s]));
  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  const legend = config.shifts.map((s) => ({
    initial: initials.get(s.id) ?? '?',
    name: s.name,
    times: formatRange(s),
  }));

  if (!schedule) {
    return { storeName: displayStoreName(document), hasSchedule: false, legend, rows: [], gapRows: [] };
  }

  const rows: ExportRow[] = employees.map((e) => {
    const row = schedule[e.id] ?? [];
    const cells: ExportCell[] = Array.from({ length: CYCLE_DAYS }, (_, day) => {
      const cell = row[day];
      if (!cell || cell.status === 'closed') return { kind: 'closed' };
      if (cell.status === 'off') return { kind: 'off' };
      const hours = effectiveHours(config, e, cell);
      return {
        kind: 'work',
        initial: initials.get(effectiveShiftId(e, cell)) ?? '?',
        times: hours ? formatRange(hours) : '',
      };
    });
    return { id: e.id, name: e.name, roleName: roleName.get(e.roleId) ?? '', cells };
  });

  const coverage = computeCoverage({ config, employees, schedule, marks });
  const all = [
    ...coverage.gaps.map((g) => ({ gap: g, cell: { kind: 'missing', label: MISSING_LABEL } as GapCell })),
    ...coverage.covered.map((c) => ({
      gap: c,
      cell: (c.mark.coveredBy.kind === 'owner'
        ? { kind: 'owner', label: OWNER_LABEL }
        : { kind: 'employee', label: nameById.get(c.mark.coveredBy.employeeId) ?? '' }) as GapCell,
    })),
  ];

  // Uma linha por função + turno + número da vaga, na ordem da configuração.
  const groups = new Map<string, GapRow>();
  const order: { key: string; shiftIdx: number; roleIdx: number; slot: number }[] = [];
  for (const { gap, cell } of all) {
    const key = `${gap.shiftId}|${gap.roleId}|${gap.slot}`;
    let group = groups.get(key);
    if (!group) {
      const shift = shiftById.get(gap.shiftId);
      const slotText = gap.slot > 0 ? ` (${gap.slot + 1}ª vaga)` : '';
      group = {
        key,
        label: `${roleName.get(gap.roleId) ?? ''} · ${shift?.name ?? ''}${slotText}`,
        cells: Array.from({ length: CYCLE_DAYS }, () => ({ kind: 'none' }) as GapCell),
      };
      groups.set(key, group);
      order.push({
        key,
        shiftIdx: config.shifts.findIndex((s) => s.id === gap.shiftId),
        roleIdx: config.roles.findIndex((r) => r.id === gap.roleId),
        slot: gap.slot,
      });
    }
    group.cells[gap.day] = cell;
  }
  order.sort((a, b) => a.shiftIdx - b.shiftIdx || a.roleIdx - b.roleIdx || a.slot - b.slot);
  const gapRows = order.map((o) => groups.get(o.key)!);

  return { storeName: displayStoreName(document), hasSchedule: true, legend, rows, gapRows };
}
