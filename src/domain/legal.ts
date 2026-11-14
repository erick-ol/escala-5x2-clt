import type { Regime } from './types';

/**
 * Datas da EC 141/2026, vindas de fontes secundárias.
 * Conferir no texto oficial antes do deploy (Verification Contract).
 */
export const LEGAL_DATES = {
  promulgation: '2026-10-16',
  /** Início do teto de 42h e da 5x2 obrigatória (60 dias após a promulgação). */
  start42h: '2026-12-15',
  /** Virada para 40h, um ano depois da primeira etapa. */
  switch40h: '2027-12-15',
} as const;

export const WEEKLY_LIMIT_MINUTES: Record<Regime, number> = {
  '42h': 42 * 60,
  '40h': 40 * 60,
};

export const DAILY_LIMIT_MINUTES = 8 * 60;
export const INTERSHIFT_REST_MINUTES = 11 * 60;
/** 24h de descanso semanal + 11h de interjornada. */
export const WEEKLY_REST_MINUTES = 35 * 60;
export const MIN_DAYS_OFF_PER_WEEK = 2;
/** Comércio: um domingo de folga a cada 3 semanas (Lei 10.101/2000, art. 6º). */
export const SUNDAY_EVERY_WEEKS_DEFAULT = 3;
/** Mulheres: um domingo de folga a cada 2 semanas (CLT art. 386). */
export const SUNDAY_EVERY_WEEKS_WOMAN = 2;

export const LEGAL_SOURCE_URL = 'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/';

export function defaultRegime(today: Date = new Date()): Regime {
  // Data local (não UTC), para a virada acontecer à meia-noite no fuso de quem usa.
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return local >= LEGAL_DATES.switch40h ? '40h' : '42h';
}
