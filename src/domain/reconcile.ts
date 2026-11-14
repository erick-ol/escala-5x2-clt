import { isISODate, localToday, mondayOnOrBefore, weekdayOfDate } from './dates';
import { fitEmployee } from './generator';
import { findShift, isSingleShiftDay, weekdayOf } from './time';
import type { AppDocument, CalendarSettings, Cell, DateOverride, Employee, Schedule } from './types';

/**
 * Projeção no calendário coerente com a configuração e a equipe:
 * - início do ciclo inválido vira a segunda-feira desta semana; fora de segunda, volta para a segunda anterior;
 * - feriados inválidos ou repetidos saem (ficam em ordem);
 * - ajustes de data de quem saiu da equipe, de data inválida, repetidos (vale o último) ou num dia da semana
 *   em que a loja não abre saem; ajuste "loja fechada" num dia aberto sai; turno removido ou em dia de
 *   turno único é tirado do ajuste (mesma regra das células do ciclo).
 */
function reconcileCalendar(doc: AppDocument, employeeIds: ReadonlySet<string>, shiftIds: ReadonlySet<string>): CalendarSettings {
  const { config } = doc;
  const current = doc.calendar as CalendarSettings | undefined;
  const fallback = mondayOnOrBefore(localToday());
  if (!current) return { cycleStart: fallback, closedDates: [], dateOverrides: [] };

  let changed = false;
  let cycleStart = current.cycleStart;
  if (!isISODate(cycleStart)) cycleStart = fallback;
  else if (weekdayOfDate(cycleStart) !== 0) cycleStart = mondayOnOrBefore(cycleStart);
  if (cycleStart !== current.cycleStart) changed = true;

  const closedDates = [...new Set(current.closedDates.filter(isISODate))].sort();
  if (closedDates.length !== current.closedDates.length || closedDates.some((d, i) => d !== current.closedDates[i])) changed = true;

  const byKey = new Map<string, DateOverride>();
  for (const o of current.dateOverrides) {
    if (!isISODate(o.date) || !employeeIds.has(o.employeeId)) continue;
    const wd = weekdayOfDate(o.date);
    if (!config.days[wd]?.open || o.cell.status === 'closed') continue;
    let cell: Cell = o.cell;
    if (cell.shiftId && (isSingleShiftDay(config, wd) || !shiftIds.has(cell.shiftId))) {
      const removed = !isSingleShiftDay(config, wd);
      const { shiftId: _drop, hours, ...rest } = cell;
      void _drop;
      cell = removed || !hours ? rest : { ...rest, hours };
    }
    const key = `${o.date}|${o.employeeId}`;
    byKey.delete(key);
    byKey.set(key, cell === o.cell ? o : { ...o, cell });
  }
  const dateOverrides = [...byKey.values()];
  if (dateOverrides.length !== current.dateOverrides.length || dateOverrides.some((o, i) => o !== current.dateOverrides[i])) {
    changed = true;
  }
  return changed ? { cycleStart, closedDates, dateOverrides } : current;
}

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
 * - Projeção no calendário (visão Mês): ver `reconcileCalendar`.
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

  const calendar = reconcileCalendar(doc, employeeIds, shiftIds);
  if (calendar !== doc.calendar) doc = { ...doc, calendar };

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
