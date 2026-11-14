import { useEffect, useMemo } from 'react';
import { computeCoverage, type CoverageResult } from '../domain/coverage';
import { fitEmployee, generateSchedule } from '../domain/generator';
import { findLunchGaps, planLunches, presenceForDay, type LunchGap, type LunchInput, type LunchPlan, type PresenceBlock } from '../domain/lunch';
import { evaluateRules, type EmployeeReport, type LegalAlert } from '../domain/rules';
import { suggestAll, type Suggestion } from '../domain/suggestions';
import { weekOf } from '../domain/time';
import type { AppDocument, DayIndex, LunchMark, Schedule } from '../domain/types';
import { appStore, useAppStore } from './store';

export interface Derived {
  coverage: CoverageResult;
  reports: Record<string, EmployeeReport>;
  /** Todos os alertas legais, na ordem da equipe. */
  alerts: LegalAlert[];
  /** Sugestões por item do resumo, chave `${roleId}|${shiftId}`. */
  suggestions: Map<string, Suggestion[]>;
  /** Início do almoço de cada pessoa em cada dia (explícito ou planejado pelo site); null quando não trabalha. */
  lunchPlan: LunchPlan;
  /** Trechos em que uma função fica abaixo do mínimo por causa dos almoços (sem os assumidos pelo dono). */
  lunchGaps: LunchGap[];
  /** Almoços sem cobertura que o dono ou a família assumiu. */
  coveredLunchGaps: LunchGap[];
  /** Marcações de almoço que não batem mais com nenhum buraco (o almoço mudou de horário). */
  orphanLunchMarks: LunchMark[];
  /** Quem está na loja num dia, com entrada, saída e almoço (para a visão do dia). */
  presence(day: DayIndex): PresenceBlock[];
}

/**
 * Cobertura → almoços → regras CLT → sugestões (R16), recalculado a cada mudança do documento.
 * Os almoços usam a cobertura (segunda área e jornadas extras) para saber quem conta em cada função.
 */
export function deriveAll(doc: AppDocument, schedule: Schedule): Derived {
  const { config, employees, marks } = doc;
  const coverage = computeCoverage({ config, employees, schedule, marks });
  const lunchInput: LunchInput = { config, employees, schedule, flex: coverage.flex, extraShifts: coverage.extraShifts };
  const lunchPlan = planLunches(lunchInput);
  const allLunchGaps = findLunchGaps(lunchInput, lunchPlan);
  const lunchMarks = doc.lunchMarks ?? [];
  const isCovered = (g: LunchGap) => lunchMarks.some((m) => sameLunchGap(m, g));
  const lunchGaps = allLunchGaps.filter((g) => !isCovered(g));
  const coveredLunchGaps = allLunchGaps.filter(isCovered);
  const orphanLunchMarks = lunchMarks.filter((m) => !allLunchGaps.some((g) => sameLunchGap(m, g)));
  const rulesInput = { config, employees, schedule, extraShifts: coverage.extraShifts, lunchPlan };
  const reports = evaluateRules(rulesInput);
  const alerts = employees.flatMap((e) => reports[e.id]?.alerts ?? []);
  const suggestions = suggestAll({ config, employees, schedule }, coverage.summary);
  const presenceCache = new Map<DayIndex, PresenceBlock[]>();
  const presence = (day: DayIndex) => {
    let blocks = presenceCache.get(day);
    if (!blocks) {
      blocks = presenceForDay(lunchInput, lunchPlan, day);
      presenceCache.set(day, blocks);
    }
    return blocks;
  };
  return { coverage, reports, alerts, suggestions, lunchPlan, lunchGaps, coveredLunchGaps, orphanLunchMarks, presence };
}

/** Uma marcação de almoço vale para o buraco com o mesmo dia, função e intervalo. */
export function sameLunchGap(m: Pick<LunchMark, 'day' | 'roleId' | 'from' | 'to'>, g: Pick<LunchGap, 'day' | 'roleId' | 'from' | 'to'>): boolean {
  return m.day === g.day && m.roleId === g.roleId && m.from === g.from && m.to === g.to;
}

/** Marca ou desmarca um almoço sem cobertura como assumido pelo dono/família. */
export function toggleLunchCover(gap: LunchGap): void {
  const { document, setLunchMarks } = appStore.getState();
  const current = document.lunchMarks ?? [];
  const exists = current.some((m) => sameLunchGap(m, gap));
  setLunchMarks(
    exists
      ? current.filter((m) => !sameLunchGap(m, gap))
      : [...current, { day: gap.day, roleId: gap.roleId, from: gap.from, to: gap.to }],
  );
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

  // Mesma regra para os almoços: se o almoço mudou de horário, a marcação antiga sai.
  const orphanLunch = derived?.orphanLunchMarks;
  useEffect(() => {
    if (!orphanLunch || orphanLunch.length === 0) return;
    const current = appStore.getState().document.lunchMarks ?? [];
    const next = current.filter((m) => !orphanLunch.some((o) => sameLunchGap(o, m)));
    if (next.length !== current.length) appStore.getState().setLunchMarks(next);
  }, [orphanLunch]);

  return derived;
}

/**
 * Gera a escala do zero (regerar): apaga trocas de folga, ajustes de dia e marcações; mantém o cadastro (KTD13).
 * Devolve a mensagem de erro se o gerador falhar.
 */
export function runGenerate(): string | null {
  const { document, setSchedule, setMarks, setLunchMarks } = appStore.getState();
  try {
    const schedule = generateSchedule({ config: document.config, employees: document.employees });
    setSchedule(schedule);
    setMarks([]);
    setLunchMarks([]);
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
