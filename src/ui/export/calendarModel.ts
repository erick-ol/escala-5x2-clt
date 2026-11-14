import { parseISODate } from '../../domain/dates';
import type { ISODate } from '../../domain/types';
import { slugify } from './download';
import { OWNER_LABEL, type LegendItem, type MonthExportModel } from './exportModel';
import type { PersonalDay, PersonalModel } from './personalModel';

/**
 * Exportação do mês em formato de calendário de parede (domingo a sábado, uma linha por semana).
 * Só o que pode sair na exportação (R20): nada de alertas nem da marcação "Funcionária mulher" (R5a).
 */

/** Equipes maiores que isto saem em duas páginas na impressão (semanas divididas). */
export const TEAM_CALENDAR_ONE_PAGE_MAX = 9;

export interface TeamCalendarEntry {
  name: string;
  /** "→ Balc.": a pessoa cobre outra função neste dia. */
  tag?: string;
  /** Vaga coberta: pelo dono/família ou por alguém da equipe numa jornada extra. */
  cover?: 'owner' | 'employee';
}

export interface TeamCalendarGroup {
  /** Sigla do turno ("M", "T", "U"). */
  initial: string;
  entries: TeamCalendarEntry[];
}

export type TeamCalendarDayKind = 'open' | 'closed' | 'holiday' | 'outside';

export interface TeamCalendarDay {
  date: ISODate;
  /** Número do dia no mês (1–31). */
  day: number;
  kind: TeamCalendarDayKind;
  /** Quem trabalha, por turno (na ordem da legenda). */
  groups: TeamCalendarGroup[];
  /** Quem folga. */
  off: string[];
  /** Vagas sem ninguém: "Falta 1 balconista (T)". Só na impressão. */
  missing: string[];
}

export interface TeamCalendarWeek {
  sunday: ISODate;
  days: TeamCalendarDay[];
}

export interface TeamCalendarModel {
  storeName: string;
  /** "Dezembro de 2026" */
  monthLabel: string;
  legend: LegendItem[];
  weeks: TeamCalendarWeek[];
  /** Semanas por página na impressão (uma página; duas para equipes grandes). */
  printPages: TeamCalendarWeek[][];
  hasFlex: boolean;
  hasCoverer: boolean;
  hasMissing: boolean;
  /** "escala-mercado-do-exemplo-dezembro-2026.png" */
  fileName: string;
  /** "Mercado do exemplo — Dezembro de 2026" */
  shareTitle: string;
}

export function dayNumberOf(date: ISODate): number {
  return parseISODate(date)?.day ?? 0;
}

/** Primeiro nome; o nome inteiro quando duas pessoas têm o mesmo primeiro nome. */
export function shortNames(names: string[]): Map<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? '';
  const count = new Map<string, number>();
  for (const n of names) count.set(first(n), (count.get(first(n)) ?? 0) + 1);
  return new Map(names.map((n) => [n, (count.get(first(n)) ?? 0) > 1 ? n.trim() : first(n) || 'Sem nome']));
}

function plural(word: string, n: number): string {
  return n > 1 && !/[sxz]$/i.test(word) ? `${word}s` : word;
}

export function buildTeamCalendar(model: MonthExportModel): TeamCalendarModel {
  const order = model.legend.map((l) => l.initial);
  const rank = (initial: string) => {
    const i = order.indexOf(initial);
    return i < 0 ? order.length : i;
  };
  const allNames = model.weeks[0]?.rows.map((r) => r.name) ?? [];
  const short = shortNames(allNames);
  const nameOf = (full: string) => short.get(full) ?? (full.trim() || 'Sem nome');

  const weeks = model.weeks.map((w): TeamCalendarWeek => ({
    sunday: w.sunday,
    days: w.dates.map((date, i): TeamCalendarDay => {
      const base = { date, day: dayNumberOf(date), groups: [], off: [], missing: [] };
      if (!w.inMonth[i]) return { ...base, kind: 'outside' };
      const cells = w.rows.map((r) => r.cells[i]);
      if (cells.some((c) => c.kind === 'closed' && c.holiday)) return { ...base, kind: 'holiday' };
      if (cells.every((c) => c.kind === 'closed')) return { ...base, kind: 'closed' };

      const groups = new Map<string, TeamCalendarEntry[]>();
      const add = (initial: string, entry: TeamCalendarEntry) => {
        const list = groups.get(initial) ?? [];
        list.push(entry);
        groups.set(initial, list);
      };
      const off: string[] = [];
      w.rows.forEach((row) => {
        const cell = row.cells[i];
        if (cell.kind === 'off') off.push(nameOf(row.name));
        else if (cell.kind === 'work') add(cell.initial, { name: nameOf(row.name), ...(cell.flex ? { tag: cell.flex } : {}) });
      });

      const missingCount = new Map<string, { role: string; initial: string; n: number }>();
      for (const gap of w.gapRows) {
        const cell = gap.cells[i];
        if (cell.kind === 'owner') add(gap.shiftInitial, { name: OWNER_LABEL, cover: 'owner' });
        else if (cell.kind === 'employee') add(gap.shiftInitial, { name: nameOf(cell.label), cover: 'employee' });
        else if (cell.kind === 'missing') {
          const key = `${gap.roleName}|${gap.shiftInitial}`;
          const item = missingCount.get(key) ?? { role: gap.roleName, initial: gap.shiftInitial, n: 0 };
          item.n += 1;
          missingCount.set(key, item);
        }
      }
      const missing = [...missingCount.values()]
        .sort((a, b) => rank(a.initial) - rank(b.initial))
        .map((m) => `Falta ${m.n} ${plural(m.role.trim().toLocaleLowerCase('pt-BR'), m.n)} (${m.initial})`);

      return {
        ...base,
        kind: 'open',
        groups: [...groups.entries()]
          .sort(([a], [b]) => rank(a) - rank(b))
          .map(([initial, entries]) => ({ initial, entries })),
        off,
        missing,
      };
    }),
  }));

  const days = weeks.flatMap((w) => w.days);
  const entries = days.flatMap((d) => d.groups.flatMap((g) => g.entries));
  const half = Math.ceil(weeks.length / 2);
  const printPages = allNames.length > TEAM_CALENDAR_ONE_PAGE_MAX ? [weeks.slice(0, half), weeks.slice(half)] : [weeks];
  return {
    storeName: model.storeName,
    monthLabel: model.monthLabel,
    legend: model.legend,
    weeks,
    printPages,
    hasFlex: entries.some((e) => !!e.tag),
    hasCoverer: entries.some((e) => e.cover === 'employee'),
    hasMissing: days.some((d) => d.missing.length > 0),
    fileName: `escala-${slugify(model.storeName)}-${slugify(model.monthLabel.replace(/ de /g, ' '))}.png`,
    shareTitle: `${model.storeName} — ${model.monthLabel}`,
  };
}

/** Uma semana do calendário individual: 7 dias (domingo a sábado) e o total da semana. */
export interface PersonalCalendarWeek {
  key: string;
  total: string;
  minutes: number;
  days: { day: number; outside: boolean; info: PersonalDay }[];
}

/** Calendário individual do mês: as semanas do modelo da pessoa, com o número de cada dia. */
export function personalCalendarWeeks(model: PersonalModel): PersonalCalendarWeek[] {
  return model.weeks.map((w) => ({
    key: w.key,
    total: w.total,
    minutes: w.minutes,
    days: w.days.map((d) => ({ day: d.date ? dayNumberOf(d.date) : 0, outside: !!d.outside, info: d })),
  }));
}
