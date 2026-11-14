import { useEffect, useMemo } from 'react';
import { computeCoverage, type CoverageResult } from '../domain/coverage';
import { fitEmployee, generateSchedule } from '../domain/generator';
import { evaluateRules, type EmployeeReport, type LegalAlert } from '../domain/rules';
import { suggestAll, type Suggestion } from '../domain/suggestions';
import { weekOf } from '../domain/time';
import type { AppDocument, Schedule } from '../domain/types';
import { appStore, useAppStore } from './store';

export interface Derived {
  coverage: CoverageResult;
  reports: Record<string, EmployeeReport>;
  /** Todos os alertas legais, na ordem da equipe. */
  alerts: LegalAlert[];
  /** Sugestões por item do resumo, chave `${roleId}|${shiftId}`. */
  suggestions: Map<string, Suggestion[]>;
}

/** Cobertura → jornadas extras → regras CLT → sugestões (R16), recalculado a cada mudança do documento. */
export function deriveAll(doc: AppDocument, schedule: Schedule): Derived {
  const { config, employees, marks } = doc;
  const coverage = computeCoverage({ config, employees, schedule, marks });
  const reports = evaluateRules({ config, employees, schedule, extraShifts: coverage.extraShifts });
  const alerts = employees.flatMap((e) => reports[e.id]?.alerts ?? []);
  const suggestions = suggestAll({ config, employees, schedule }, coverage.summary);
  return { coverage, reports, alerts, suggestions };
}

/** Semana a que um alerta pertence; null quando vale para o ciclo inteiro. */
export function alertWeek(alert: LegalAlert): number | null {
  if (alert.week !== null) return alert.week;
  return alert.day !== null ? weekOf(alert.day) : null;
}

/** Alertas de uma pessoa visíveis numa semana (os do ciclo inteiro aparecem em todas). */
export function alertsInWeek(alerts: LegalAlert[], week: number): LegalAlert[] {
  return alerts.filter((a) => {
    const w = alertWeek(a);
    return w === null || w === week;
  });
}

export function useDerived(): Derived | null {
  const doc = useAppStore((s) => s.document);
  const derived = useMemo(() => (doc.schedule ? deriveAll(doc, doc.schedule) : null), [doc]);

  // KTD15: marcações sem buraco correspondente saem do documento, então não voltam sozinhas.
  const orphans = derived?.coverage.orphanMarks;
  useEffect(() => {
    if (!orphans || orphans.length === 0) return;
    const current = appStore.getState().document.marks;
    const next = current.filter((m) => !orphans.includes(m));
    // Guarda contra laço: só grava se algo realmente saiu.
    if (next.length !== current.length) appStore.getState().setMarks(next);
  }, [orphans]);

  return derived;
}

/**
 * Gera a escala do zero (regerar): apaga trocas de folga, ajustes de dia e marcações; mantém o cadastro (KTD13).
 * Devolve a mensagem de erro se o gerador falhar.
 */
export function runGenerate(): string | null {
  const { document, setSchedule, setMarks } = appStore.getState();
  try {
    const schedule = generateSchedule({ config: document.config, employees: document.employees });
    setSchedule(schedule);
    setMarks([]);
    return null;
  } catch (error) {
    console.error(error);
    return 'Não foi possível gerar a escala com esta configuração.';
  }
}

/** Encaixa na escala existente quem foi cadastrado depois dela (store.addEmployee só dá a linha padrão). */
export function fitAddedEmployees(previousIds: ReadonlySet<string>): void {
  const { config, employees, schedule } = appStore.getState().document;
  if (!schedule) return;
  const added = employees.filter((e) => !previousIds.has(e.id) && schedule[e.id]);
  if (added.length === 0) return;
  // As linhas padrão dos recém-chegados não entram na conta enquanto cada um é encaixado.
  const working: Schedule = { ...schedule };
  for (const e of added) delete working[e.id];
  for (const e of added) {
    working[e.id] = fitEmployee({ config, employees, schedule: working }, e.id);
    appStore.getState().setRow(e.id, working[e.id]);
  }
}
