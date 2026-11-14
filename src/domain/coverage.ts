import { effectiveShiftId, weekdayOf } from './time';
import {
  CYCLE_DAYS,
  WEEKDAY_NAMES,
  WEEKS,
  type CoverageMark,
  type DayIndex,
  type Employee,
  type ExtraShift,
  type Schedule,
  type StoreConfig,
  type Weekday,
} from './types';

export interface Gap {
  day: DayIndex;
  shiftId: string;
  roleId: string;
  slot: number;
}

export interface CoveredGap extends Gap {
  mark: CoverageMark;
}

export interface SummaryItem {
  roleId: string;
  shiftId: string;
  weekdays: Weekday[];
  perWeek: number;
  text: string;
}

export interface CoverageInput {
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule;
  marks: CoverageMark[];
}

export interface CoverageResult {
  /** Vagas faltantes sem cobertura. */
  gaps: Gap[];
  /** Vagas faltantes cobertas por uma marcação. */
  covered: CoveredGap[];
  /** Marcações sem vaga faltante correspondente (o store remove, KTD15). */
  orphanMarks: CoverageMark[];
  /** Jornadas de "coberto por [funcionário]" para as regras CLT (KTD16). */
  extraShifts: ExtraShift[];
  summary: SummaryItem[];
  headline: string;
}

export function gapKey(g: Pick<Gap, 'day' | 'shiftId' | 'roleId' | 'slot'>): string {
  return `${g.day}|${g.shiftId}|${g.roleId}|${g.slot}`;
}

const cellKey = (day: DayIndex, shiftId: string, roleId: string) => `${day}|${shiftId}|${roleId}`;

/** Mínimo exigido por dia/turno/função (0 se a loja está fechada ou não há mínimo). */
function requiredFor(config: StoreConfig, day: DayIndex, shiftId: string, roleId: string): number {
  const wd = weekdayOf(day);
  if (!config.days[wd]?.open) return 0;
  const min = config.minimums.find((m) => m.shiftId === shiftId && m.roleId === roleId);
  return Math.max(0, min?.perWeekday[wd] ?? 0);
}

/** Pessoas escaladas por dia/turno/função, pelo turno atribuído no dia (KTD8). */
function baseCounts(employees: Employee[], schedule: Schedule): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of employees) {
    const row = schedule[e.id];
    if (!row) continue;
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const cell = row[d];
      if (cell?.status !== 'work') continue;
      const k = cellKey(d, effectiveShiftId(e, cell), e.roleId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

export function countGaps(config: StoreConfig, employees: Employee[], schedule: Schedule): number {
  const counts = baseCounts(employees, schedule);
  let total = 0;
  for (const min of config.minimums) {
    if (!config.shifts.some((s) => s.id === min.shiftId) || !config.roles.some((r) => r.id === min.roleId)) continue;
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const wd = weekdayOf(d);
      if (!config.days[wd]?.open) continue;
      const required = min.perWeekday[wd] ?? 0;
      if (required <= 0) continue;
      total += Math.max(0, required - (counts.get(cellKey(d, min.shiftId, min.roleId)) ?? 0));
    }
  }
  return total;
}

export function computeCoverage({ config, employees, schedule, marks }: CoverageInput): CoverageResult {
  const counts = baseCounts(employees, schedule);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const shiftById = new Map(config.shifts.map((s) => [s.id, s]));
  const roleIds = new Set(config.roles.map((r) => r.id));

  const targetValid = (m: CoverageMark) =>
    Number.isInteger(m.day) &&
    m.day >= 0 &&
    m.day < CYCLE_DAYS &&
    shiftById.has(m.shiftId) &&
    roleIds.has(m.roleId) &&
    !!config.days[weekdayOf(m.day)]?.open;

  // Passo 1 (uma vez só, sem recursão): quem já trabalha no mesmo turno e cobre outra vaga
  // sai da contagem da própria função naquele dia (KTD16).
  for (const m of marks) {
    if (m.coveredBy.kind !== 'employee' || !targetValid(m)) continue;
    const e = byId.get(m.coveredBy.employeeId);
    if (!e) continue;
    const cell = schedule[e.id]?.[m.day];
    if (cell?.status === 'work' && effectiveShiftId(e, cell) === m.shiftId) {
      const k = cellKey(m.day, m.shiftId, e.roleId);
      counts.set(k, Math.max(0, (counts.get(k) ?? 0) - 1));
    }
  }

  // Passo 2: vagas faltantes, na ordem dia → turno → função → vaga.
  const missingSlots: Gap[] = [];
  const missingByCell = new Map<string, number>();
  for (let d = 0; d < CYCLE_DAYS; d++) {
    for (const shift of config.shifts) {
      for (const role of config.roles) {
        const required = requiredFor(config, d, shift.id, role.id);
        if (required === 0) continue;
        const missing = Math.max(0, required - (counts.get(cellKey(d, shift.id, role.id)) ?? 0));
        if (missing === 0) continue;
        missingByCell.set(cellKey(d, shift.id, role.id), missing);
        for (let slot = 0; slot < missing; slot++) {
          missingSlots.push({ day: d, shiftId: shift.id, roleId: role.id, slot });
        }
      }
    }
  }

  // Passo 3: aplica as marcações às vagas.
  const coveredByKey = new Map<string, CoverageMark>();
  const orphanMarks: CoverageMark[] = [];
  const extraShifts: ExtraShift[] = [];
  for (const m of marks) {
    const missing = targetValid(m) ? (missingByCell.get(cellKey(m.day, m.shiftId, m.roleId)) ?? 0) : 0;
    const coverer = m.coveredBy.kind === 'employee' ? byId.get(m.coveredBy.employeeId) : undefined;
    const key = gapKey(m);
    if (
      !Number.isInteger(m.slot) ||
      m.slot < 0 ||
      m.slot >= missing ||
      coveredByKey.has(key) ||
      (m.coveredBy.kind === 'employee' && !coverer)
    ) {
      orphanMarks.push(m);
      continue;
    }
    coveredByKey.set(key, m);
    if (coverer) {
      const cell = schedule[coverer.id]?.[m.day];
      const sameShift = cell?.status === 'work' && effectiveShiftId(coverer, cell) === m.shiftId;
      if (!sameShift) {
        const shift = shiftById.get(m.shiftId)!;
        extraShifts.push({
          employeeId: coverer.id,
          day: m.day,
          shiftId: m.shiftId,
          hours: { start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes },
        });
      }
    }
  }

  const gaps: Gap[] = [];
  const covered: CoveredGap[] = [];
  for (const g of missingSlots) {
    const mark = coveredByKey.get(gapKey(g));
    if (mark) covered.push({ ...g, mark });
    else gaps.push(g);
  }

  const summary = buildSummary(config, gaps);
  return { gaps, covered, orphanMarks, extraShifts, summary, headline: buildHeadline(summary) };
}

/** "à tarde", "de manhã", "à noite"; outros nomes viram "no turno X". */
export function shiftPhrase(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'manhã' || n === 'manha' || n === 'madrugada') return `de ${n === 'manha' ? 'manhã' : n}`;
  if (n === 'tarde' || n === 'noite') return `à ${n}`;
  return `no turno ${name.trim()}`;
}

export function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function weekdaysPhrase(weekdays: Weekday[]): string {
  if (weekdays.length === 7) return 'todos os dias';
  return joinPt(weekdays.map((w) => WEEKDAY_NAMES[w].toLowerCase()));
}

function buildSummary(config: StoreConfig, gaps: Gap[]): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (const shift of config.shifts) {
    for (const role of config.roles) {
      const group = gaps.filter((g) => g.shiftId === shift.id && g.roleId === role.id);
      if (group.length === 0) continue;
      const weekdays = [...new Set(group.map((g) => weekdayOf(g.day)))].sort((a, b) => a - b);
      items.push({
        roleId: role.id,
        shiftId: shift.id,
        weekdays,
        perWeek: Math.ceil(group.length / WEEKS),
        text: `${role.name} ${shiftPhrase(shift.name)}: ${weekdaysPhrase(weekdays)}`,
      });
    }
  }
  return items;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function buildHeadline(summary: SummaryItem[]): string {
  if (summary.length === 0) return 'Tudo coberto';
  const total = summary.reduce((acc, s) => acc + s.perWeek, 0);
  const label = total === 1 ? 'buraco' : 'buracos';
  const details = summary.map((s) => lowerFirst(s.text).replace(': ', ', ')).join('; ');
  return `${total} ${label} por semana: ${details}`;
}
