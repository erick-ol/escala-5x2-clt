import type { ISODate, Weekday } from './types';

/**
 * Datas do calendário sem fuso horário: "aaaa-mm-dd" e aritmética de ano/mês/dia em números inteiros
 * (nunca `Date.toISOString`, que converte para UTC e pode trocar o dia).
 */

export interface DateParts {
  year: number;
  /** 1 = janeiro … 12 = dezembro. */
  month: number;
  day: number;
}

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseISODate(text: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isISODate(text: string): boolean {
  return parseISODate(text) !== null;
}

/** Dias desde 1970-01-01 (algoritmo "days from civil", só inteiros). */
export function dayNumber(date: ISODate): number {
  const p = parseISODate(date);
  if (!p) throw new Error(`Data inválida: ${date}`);
  const y = p.month <= 2 ? p.year - 1 : p.year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = p.month > 2 ? p.month - 3 : p.month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + p.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverso de `dayNumber`. */
export function fromDayNumber(n: number): ISODate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return toISODate(year, month, day);
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromDayNumber(dayNumber(date) + n);
}

/** Dias de `from` até `to` (negativo se `to` vem antes). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

/** 0 = segunda … 6 = domingo (1970-01-01 foi uma quinta). */
export function weekdayOfDate(date: ISODate): Weekday {
  return ((((dayNumber(date) + 3) % 7) + 7) % 7) as Weekday;
}

/** Domingo da semana (domingo a sábado) da data: a própria data, se já for domingo. */
export function sundayOnOrBefore(date: ISODate): ISODate {
  return addDays(date, -((weekdayOfDate(date) + 1) % 7));
}

/** A data é um domingo? */
export function isSunday(date: ISODate): boolean {
  return weekdayOfDate(date) === 6;
}

/** Data de hoje no fuso de quem usa. */
export function localToday(now: Date = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} de ${year}`;
}

/** Mês seguinte (delta = 1) ou anterior (delta = -1). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** "30/11" */
export function formatDayMonth(date: ISODate): string {
  const p = parseISODate(date);
  return p ? `${pad(p.day)}/${pad(p.month)}` : date;
}

/** "30/11/2026" */
export function formatFullDate(date: ISODate): string {
  const p = parseISODate(date);
  return p ? `${pad(p.day)}/${pad(p.month)}/${p.year}` : date;
}
