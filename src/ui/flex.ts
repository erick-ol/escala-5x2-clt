import type { CoverageResult, FlexCover } from '../domain/coverage';
import type { DayIndex } from '../domain/types';

/** Função coberta por uma pessoa num dia, se ela estiver na segunda área. */
export function flexFor(coverage: CoverageResult, employeeId: string, day: DayIndex): FlexCover | undefined {
  return coverage.flex.find((f) => f.employeeId === employeeId && f.day === day);
}

/** Sigla curta da função para a célula: "Balconista" → "Balc.", "Caixa" → "Caixa". */
export function roleAbbrev(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length <= 5 ? first : `${first.slice(0, 4)}.`;
}

/** Marcador da célula: "→ Balc.". */
export function flexTag(roleName: string): string {
  return `→ ${roleAbbrev(roleName)}`;
}
