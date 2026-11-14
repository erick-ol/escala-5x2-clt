import { fitEmployee } from './generator';
import { findShift, isSingleShiftDay, weekdayOf } from './time';
import type { AppDocument, Cell, Employee, Schedule } from './types';

/**
 * Deixa a escala coerente com a configuração atual. Roda ao carregar, ao restaurar um backup
 * e quando o dono mantém a escala depois de mexer na configuração.
 *
 * - Toda pessoa tem uma linha; linhas de quem saiu da equipe são removidas.
 * - Dia que passou a ser fechado vira "loja fechada" (sem ajustes de turno/horário).
 * - Dia que passou a ser aberto deixa de ser "loja fechada": a linha da pessoa é reencaixada pelo gerador.
 * - Ajustes de turno que apontam para um turno que não existe mais são descartados.
 * - Nos dias de turno único, ajustes de turno são descartados (todos ficam no turno único; o ajuste de horário fica).
 * - Marcações de quem saiu da equipe, ou de turno/função removidos, são descartadas.
 * - Segunda área que aponta para função removida, ou igual à função principal, é descartada.
 */
export function reconcileDocument(doc: AppDocument): AppDocument {
  const { config } = doc;
  const shiftIds = new Set(config.shifts.map((s) => s.id));
  const roleIds = new Set(config.roles.map((r) => r.id));
  const employeeIds = new Set(doc.employees.map((e) => e.id));

  let employeesChanged = false;
  const employees = doc.employees.map((e): Employee => {
    if (e.secondaryRoleId === undefined) return e;
    if (e.secondaryRoleId !== e.roleId && roleIds.has(e.secondaryRoleId)) return e;
    employeesChanged = true;
    const { secondaryRoleId: _drop, ...rest } = e;
    void _drop;
    return rest;
  });
  if (employeesChanged) doc = { ...doc, employees };

  const marks = doc.marks.filter(
    (m) =>
      (shiftIds.has(m.shiftId) || !!findShift(config, m.shiftId)) &&
      roleIds.has(m.roleId) &&
      (m.coveredBy.kind === 'owner' || employeeIds.has(m.coveredBy.employeeId)),
  );

  const lunchMarks = (doc.lunchMarks ?? []).filter((m) => roleIds.has(m.roleId));
  if (lunchMarks.length !== (doc.lunchMarks ?? []).length || !doc.lunchMarks) doc = { ...doc, lunchMarks };

  if (!doc.schedule) return marks.length === doc.marks.length ? doc : { ...doc, marks };

  const schedule: Schedule = {};
  const needsRefit: string[] = [];
  let changed = false;

  for (const employee of employees) {
    const row = doc.schedule[employee.id];
    if (!row) {
      needsRefit.push(employee.id);
      changed = true;
      continue;
    }
    let reopened = false;
    const next = row.map((cell, day): Cell => {
      const open = config.days[weekdayOf(day)].open;
      if (!open) {
        if (cell.status === 'closed' && !cell.shiftId && !cell.hours) return cell;
        changed = true;
        return { status: 'closed' };
      }
      if (cell.status === 'closed') {
        reopened = true;
        changed = true;
        return { status: 'work' };
      }
      if (cell.shiftId && isSingleShiftDay(config, weekdayOf(day))) {
        changed = true;
        const { shiftId: _drop, ...rest } = cell;
        void _drop;
        return rest;
      }
      if (cell.shiftId && !shiftIds.has(cell.shiftId)) {
        changed = true;
        const { shiftId: _drop, hours: _hours, ...rest } = cell;
        void _drop;
        void _hours;
        return rest;
      }
      return cell;
    });
    schedule[employee.id] = next;
    if (reopened) needsRefit.push(employee.id);
  }
  if (Object.keys(doc.schedule).some((id) => !employeeIds.has(id))) changed = true;

  for (const id of needsRefit) {
    const others: Schedule = { ...schedule };
    delete others[id];
    schedule[id] = fitEmployee({ config, employees, schedule: others }, id);
  }

  if (!changed && marks.length === doc.marks.length) return doc;
  return { ...doc, schedule, marks };
}
