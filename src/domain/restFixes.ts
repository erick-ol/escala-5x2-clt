import { computeCoverage, countGaps } from './coverage';
import { evaluateEmployee, type LegalAlert } from './rules';
import { allowsOff, effectiveShiftId, findShift, isSingleShiftDay, weekOf, weekdayOf } from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, WEEKDAY_NAMES, type Cell, type CoverageMark, type Employee, type Schedule, type StoreConfig } from './types';

export interface RestFixInput {
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule;
  marks?: CoverageMark[];
}

export interface RestFixChange {
  employeeId: string;
  day: number;
  cell: Cell;
}

export type RestFixKind = 'shift' | 'swap' | 'off';

/** Um ajuste que resolve (ou diminui) avisos de descanso de 11h sem criar buraco nem alerta legal. */
export interface RestFix {
  kind: RestFixKind;
  text: string;
  changes: RestFixChange[];
  /** Avisos de 11h das pessoas envolvidas, antes e depois. */
  warningsBefore: number;
  warningsAfter: number;
}

const MAX_FIXES = 3;
const KIND_ORDER: Record<RestFixKind, number> = { shift: 0, swap: 1, off: 2 };

const dayText = (d: number) => `${WEEKDAY_NAMES[weekdayOf(d)].toLowerCase()} (semana ${weekOf(d) + 1})`;

/**
 * Ajustes para um aviso de menos de 11h entre jornadas (o aviso cai no dia da 2ª jornada). Testa, na véspera e
 * no dia: mudar a pessoa de turno, trocar de turno com quem trabalha no outro turno nesse dia, e folgar nesse
 * dia no lugar de outra folga da mesma semana. Só fica o que não aumenta buracos nem alertas legais e diminui
 * os avisos de 11h das pessoas envolvidas; os melhores primeiro.
 */
export function restFixes(input: RestFixInput, warning: LegalAlert): RestFix[] {
  const { config, employees, schedule } = input;
  if (warning.kind !== 'intershift-rest' || warning.day === null) return [];
  const person = employees.find((e) => e.id === warning.employeeId);
  const row = person ? schedule[person.id] : undefined;
  if (!person || !row) return [];

  const gapsBefore = countGaps(config, employees, schedule);
  const evaluate = (s: Schedule, ids: string[]) => {
    const { extraShifts } = computeCoverage({ config, employees, schedule: s, marks: input.marks ?? [] });
    let alerts = 0;
    let rests = 0;
    for (const id of ids) {
      const report = evaluateEmployee({ config, employees, schedule: s, extraShifts }, id);
      alerts += report.alerts.length;
      rests += report.warnings.filter((w) => w.kind === 'intershift-rest').length;
    }
    return { alerts, rests };
  };

  const shiftOf = (e: Employee, d: number) => effectiveShiftId(config, e, schedule[e.id]?.[d], d);
  /** Célula de trabalho no turno pedido (no turno do cadastro, sem shiftId: volta o horário próprio). */
  const workCell = (e: Employee, shiftId: string): Cell => (shiftId === e.shiftId ? { status: 'work' } : { status: 'work', shiftId });

  const candidates: Omit<RestFix, 'warningsBefore' | 'warningsAfter'>[] = [];
  const prev = (warning.day + CYCLE_DAYS - 1) % CYCLE_DAYS;
  for (const d of [prev, warning.day]) {
    if (row[d]?.status !== 'work') continue;
    const mine = shiftOf(person, d);
    // No turno único todos trabalham no mesmo horário: só dá para folgar.
    const single = isSingleShiftDay(config, weekdayOf(d));

    // Mudar a pessoa de turno nesse dia.
    for (const shift of single ? [] : config.shifts) {
      if (shift.id === mine) continue;
      candidates.push({
        kind: 'shift',
        text: `${capitalize(dayText(d))}: ${person.name} na ${shift.name.toLowerCase()}`,
        changes: [{ employeeId: person.id, day: d, cell: workCell(person, shift.id) }],
      });
    }

    // Trocar de turno com quem trabalha no outro turno nesse dia.
    for (const other of single ? [] : employees) {
      if (other.id === person.id) continue;
      const theirs = schedule[other.id]?.[d];
      if (theirs?.status !== 'work') continue;
      const otherShift = shiftOf(other, d);
      if (otherShift === mine || !findShift(config, otherShift)) continue;
      const mineName = findShift(config, mine)?.name.toLowerCase() ?? '';
      const theirName = findShift(config, otherShift)?.name.toLowerCase() ?? '';
      candidates.push({
        kind: 'swap',
        text: `${capitalize(dayText(d))}: trocar de turno com ${other.name} (${person.name} na ${theirName}, ${other.name} na ${mineName})`,
        changes: [
          { employeeId: person.id, day: d, cell: workCell(person, otherShift) },
          { employeeId: other.id, day: d, cell: workCell(other, mine) },
        ],
      });
    }

    // Folgar nesse dia no lugar de outra folga da mesma semana.
    if (!allowsOff(config, weekdayOf(d))) continue;
    const week = weekOf(d);
    for (let x = week * DAYS_PER_WEEK; x < (week + 1) * DAYS_PER_WEEK; x++) {
      if (row[x]?.status !== 'off') continue;
      candidates.push({
        kind: 'off',
        text: `Folgar ${dayText(d)} e trabalhar ${dayText(x)}`,
        changes: [
          { employeeId: person.id, day: d, cell: { status: 'off' } },
          { employeeId: person.id, day: x, cell: { status: 'work' } },
        ],
      });
    }
  }

  const fixes: RestFix[] = [];
  for (const c of candidates) {
    const next = applyRestFix(schedule, c.changes);
    if (c.kind === 'off' && longRest(next[person.id])) continue;
    if (countGaps(config, employees, next) > gapsBefore) continue;
    const ids = [...new Set(c.changes.map((ch) => ch.employeeId))];
    const before = evaluate(schedule, ids);
    const after = evaluate(next, ids);
    if (after.alerts > before.alerts || after.rests >= before.rests) continue;
    fixes.push({ ...c, warningsBefore: before.rests, warningsAfter: after.rests });
  }
  fixes.sort(
    (a, b) =>
      a.warningsAfter - a.warningsBefore - (b.warningsAfter - b.warningsBefore) ||
      a.changes.length - b.changes.length ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  return fixes.slice(0, MAX_FIXES);
}

/** Escala com as mudanças aplicadas (não altera a original). */
export function applyRestFix(schedule: Schedule, changes: RestFixChange[]): Schedule {
  const next: Schedule = { ...schedule };
  for (const ch of changes) {
    const row = [...(next[ch.employeeId] ?? [])];
    row[ch.day] = ch.cell;
    next[ch.employeeId] = row;
  }
  return next;
}

/** Mais de 2 dias seguidos de descanso com folga (circular): o gerador não faz, o ajuste também não. */
function longRest(row: Cell[] | undefined): boolean {
  if (!row) return false;
  for (let d = 0; d < CYCLE_DAYS; d++) {
    const run = [0, 1, 2].map((i) => row[(d + i) % CYCLE_DAYS]);
    if (run.every((c) => c?.status !== 'work') && run.some((c) => c?.status === 'off')) return true;
  }
  return false;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
