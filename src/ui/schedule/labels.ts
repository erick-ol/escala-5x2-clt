import type { LegalAlert } from '../../domain/rules';
import { weekOf, weekdayOf } from '../../domain/time';
import { WEEKDAY_NAMES, type Employee, type StoreConfig } from '../../domain/types';

const TONES = ['a', 'b', 'c'] as const;
export type ShiftTone = (typeof TONES)[number];

/** Cor do turno pela posição no cadastro: --shift-a, -b, -c (repete a partir do 4º). */
export function shiftTone(config: StoreConfig, shiftId: string): ShiftTone {
  const i = config.shifts.findIndex((s) => s.id === shiftId);
  return TONES[(i < 0 ? 0 : i) % TONES.length];
}

export function shiftInitial(config: StoreConfig, shiftId: string): string {
  const name = config.shifts.find((s) => s.id === shiftId)?.name.trim() ?? '?';
  return name.charAt(0).toUpperCase() || '?';
}

export function shiftName(config: StoreConfig, shiftId: string): string {
  return config.shifts.find((s) => s.id === shiftId)?.name ?? 'turno removido';
}

export function roleName(config: StoreConfig, roleId: string): string {
  return config.roles.find((r) => r.id === roleId)?.name ?? 'função removida';
}

/** Nome curto para a coluna fixa de 375px: primeiro nome, até 6 letras. */
export function shortName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length <= 6 ? first : `${first.slice(0, 4)}.`;
}

export function dayLabel(day: number): string {
  return `${WEEKDAY_NAMES[weekdayOf(day)].toLowerCase()}, semana ${weekOf(day) + 1}`;
}

/** "Segunda, semana 1" / "Semana 2" / "Ciclo inteiro". */
export function alertWhere(alert: LegalAlert): string {
  if (alert.day !== null) return `${WEEKDAY_NAMES[weekdayOf(alert.day)]}, semana ${weekOf(alert.day) + 1}`;
  if (alert.week !== null) return `Semana ${alert.week + 1}`;
  return 'Ciclo inteiro';
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function employeeName(employees: Employee[], id: string): string {
  return employees.find((e) => e.id === id)?.name ?? 'Pessoa removida';
}
