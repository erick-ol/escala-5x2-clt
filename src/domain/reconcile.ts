import { fitEmployee } from './generator';
import { weekdayOf } from './time';
import type { AppDocument, Cell, Schedule } from './types';

/**
 * Deixa a escala coerente com a configuração atual. Roda ao carregar, ao restaurar um backup
 * e quando o dono mantém a escala depois de mexer na configuração.
 *
 * - Toda pessoa tem uma linha; linhas de quem saiu da equipe são removidas.
 * - Dia que passou a ser fechado vira "loja fechada" (sem ajustes de turno/horário).
 * - Dia que passou a ser aberto deixa de ser "loja fechada": a linha da pessoa é reencaixada pelo gerador.
 * - Ajustes de turno que apontam para um turno que não existe mais são descartados.
 * - Marcações de quem saiu da equipe, ou de turno/função removidos, são descartadas.
 */
export function reconcileDocument(doc: AppDocument): AppDocument {
  const { config, employees } = doc;
  const shiftIds = new Set(config.shifts.map((s) => s.id));
  const roleIds = new Set(config.roles.map((r) => r.id));
  const employeeIds = new Set(employees.map((e) => e.id));

  const marks = doc.marks.filter(
    (m) =>
      shiftIds.has(m.shiftId) &&
      roleIds.has(m.roleId) &&
      (m.coveredBy.kind === 'owner' || employeeIds.has(m.coveredBy.employeeId)),
  );

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
