import { countGaps, shiftPhrase, weekdaysPhrase, type SummaryItem } from './coverage';
import { fitEmployee } from './generator';
import { findShift, isVirtualShiftId, requiredCount } from './time';
import type { Employee, Schedule, StoreConfig, Weekday } from './types';

export type SuggestionKind = 'hire' | 'move-shift' | 'reduce-minimum';

export interface Suggestion {
  kind: SuggestionKind;
  text: string;
  roleId: string;
  shiftId: string;
  /** Buracos no ciclo inteiro antes e depois da sugestão. */
  gapsBefore: number;
  gapsAfter: number;
  employeeId?: string;
}

export interface SuggestionInput {
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule;
}

const HIRE_ID = '__sugestao_contratar__';

function names(config: StoreConfig, roleId: string, shiftId: string) {
  const role = config.roles.find((r) => r.id === roleId)?.name ?? 'pessoa';
  const shift = findShift(config, shiftId)?.name ?? '';
  return { role: role.toLowerCase(), shift: shiftPhrase(shift) };
}

function hireSuggestion(input: SuggestionInput, item: SummaryItem, before: number): Suggestion {
  const { config, employees, schedule } = input;
  // No turno único todos trabalham no mesmo horário: a pessoa nova entra num turno cadastrado (o que mais ajuda).
  const homes = isVirtualShiftId(item.shiftId) ? config.shifts.map((s) => s.id) : [item.shiftId];
  let after = Infinity;
  for (const shiftId of homes.length > 0 ? homes : [item.shiftId]) {
    const hire: Employee = { id: HIRE_ID, name: 'Nova pessoa', roleId: item.roleId, shiftId, isWoman: false };
    const withHire = [...employees, hire];
    const row = fitEmployee({ config, employees: withHire, schedule }, HIRE_ID);
    after = Math.min(after, countGaps(config, withHire, { ...schedule, [HIRE_ID]: row }));
  }
  const n = names(config, item.roleId, item.shiftId);
  return {
    kind: 'hire',
    text: `Contratar 1 ${n.role} ${n.shift}`,
    roleId: item.roleId,
    shiftId: item.shiftId,
    gapsBefore: before,
    gapsAfter: after,
  };
}

/** "Mover alguém de turno" só quando a troca reduz o total de buracos (R13, AE2). */
function moveSuggestions(input: SuggestionInput, item: SummaryItem, before: number): Suggestion[] {
  const { config, employees, schedule } = input;
  const out: Suggestion[] = [];
  // O turno único não é um turno do cadastro: não dá para "passar alguém" para ele.
  if (isVirtualShiftId(item.shiftId)) return out;
  for (const candidate of employees) {
    if (candidate.roleId !== item.roleId || candidate.shiftId === item.shiftId) continue;
    const moved: Employee = { ...candidate, shiftId: item.shiftId, customHours: undefined };
    const nextEmployees = employees.map((e) => (e.id === candidate.id ? moved : e));
    const rest = { ...schedule };
    delete rest[candidate.id];
    const row = fitEmployee({ config, employees: nextEmployees, schedule: rest }, candidate.id);
    const after = countGaps(config, nextEmployees, { ...rest, [candidate.id]: row });
    if (after < before) {
      const n = names(config, item.roleId, item.shiftId);
      out.push({
        kind: 'move-shift',
        text: `Passar ${candidate.name} para o turno ${n.shift.replace(/^(de|à|no turno) /, '')}`,
        roleId: item.roleId,
        shiftId: item.shiftId,
        gapsBefore: before,
        gapsAfter: after,
        employeeId: candidate.id,
      });
    }
  }
  return out.sort((a, b) => a.gapsAfter - b.gapsAfter).slice(0, 1);
}

function reduceSuggestion(input: SuggestionInput, item: SummaryItem, before: number): Suggestion | null {
  const { config } = input;
  const virtual = isVirtualShiftId(item.shiftId);
  const minimum = config.minimums.find((m) => m.roleId === item.roleId && m.shiftId === item.shiftId);
  if (!virtual && !minimum) return null;
  // Exigido hoje em cada dia do padrão (no turno único, o maior mínimo da função entre os turnos).
  const current = (w: Weekday) => (virtual ? requiredCount(config, w, item.shiftId, item.roleId) : (minimum?.perWeekday[w] ?? 0));
  const inItem = (w: number) => item.weekdays.includes(w as Weekday);
  const reduced: StoreConfig = {
    ...config,
    minimums: config.minimums.map((m) => {
      if (virtual ? m.roleId !== item.roleId : m !== minimum) return m;
      const perWeekday = m.perWeekday.map((v, w) =>
        inItem(w) ? (virtual ? Math.min(v, Math.max(0, current(w as Weekday) - 1)) : Math.max(0, v - 1)) : v,
      );
      return { ...m, perWeekday };
    }),
  };
  const after = countGaps(reduced, input.employees, input.schedule);
  if (after >= before) return null;
  const n = names(config, item.roleId, item.shiftId);
  const targets = item.weekdays.map((w) => Math.max(0, current(w) - 1));
  const allZero = targets.every((t) => t === 0);
  const sameTarget = targets.every((t) => t === targets[0]);
  const label = allZero
    ? `Aceitar ficar sem ${n.role}`
    : sameTarget
      ? `Reduzir para ${targets[0]} ${n.role}`
      : `Reduzir em 1 o mínimo de ${n.role}`;
  return {
    kind: 'reduce-minimum',
    text: `${label} ${n.shift} em ${weekdaysPhrase(item.weekdays)}`,
    roleId: item.roleId,
    shiftId: item.shiftId,
    gapsBefore: before,
    gapsAfter: after,
  };
}

/** Até 3 sugestões por padrão de buraco: contratar, mover alguém de turno, reduzir o mínimo. */
export function suggestFor(input: SuggestionInput, item: SummaryItem): Suggestion[] {
  const before = countGaps(input.config, input.employees, input.schedule);
  if (before === 0) return [];
  const list: Suggestion[] = [hireSuggestion(input, item, before), ...moveSuggestions(input, item, before)];
  const reduce = reduceSuggestion(input, item, before);
  if (reduce) list.push(reduce);
  return list.filter((s) => s.gapsAfter < s.gapsBefore);
}

export function suggestAll(input: SuggestionInput, summary: SummaryItem[]): Map<string, Suggestion[]> {
  const map = new Map<string, Suggestion[]>();
  for (const item of summary) map.set(`${item.roleId}|${item.shiftId}`, suggestFor(input, item));
  return map;
}
