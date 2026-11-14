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

/** Pessoa contada na segunda área (função `roleId`) porque a principal já estava completa no turno. */
export interface FlexCover {
  day: DayIndex;
  shiftId: string;
  /** Função coberta (a segunda área da pessoa). */
  roleId: string;
  employeeId: string;
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
  /** Quem foi contado na segunda área, por dia e turno. */
  flex: FlexCover[];
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

/** Segunda área válida: função existente e diferente da principal. */
export function validSecondary(e: Employee, roleIds: ReadonlySet<string>): string | undefined {
  const r = e.secondaryRoleId;
  return r && r !== e.roleId && roleIds.has(r) ? r : undefined;
}

interface Counted {
  /** Pessoas contadas por dia/turno/função, já com a segunda área aplicada. */
  counts: Map<string, number>;
  /** Função em que cada pessoa conta, por `${day}|${shiftId}|${employeeId}` (só quem foi para a segunda área). */
  flexRole: Map<string, string>;
  flex: FlexCover[];
}

/**
 * Pessoas escaladas por dia/turno/função, pelo turno atribuído no dia (KTD8).
 * Depois, em cada dia/turno, para cada função com falta (na ordem das funções), quem tem essa função
 * como segunda área e cuja função principal está com sobra passa a contar nela (na ordem da equipe).
 * Nunca abre falta na função principal.
 */
function countWithFlex(config: StoreConfig, employees: Employee[], schedule: Schedule): Counted {
  const counts = new Map<string, number>();
  const roleIds = new Set(config.roles.map((r) => r.id));
  /** Quem tem segunda área, por dia/turno, na ordem da equipe. */
  const flexible = new Map<string, Employee[]>();
  for (const e of employees) {
    const row = schedule[e.id];
    if (!row) continue;
    const secondary = validSecondary(e, roleIds);
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const cell = row[d];
      if (cell?.status !== 'work') continue;
      const shiftId = effectiveShiftId(e, cell);
      const k = cellKey(d, shiftId, e.roleId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (secondary) {
        const fk = `${d}|${shiftId}`;
        const list = flexible.get(fk);
        if (list) list.push(e);
        else flexible.set(fk, [e]);
      }
    }
  }

  const flex: FlexCover[] = [];
  const flexRole = new Map<string, string>();
  if (flexible.size === 0) return { counts, flexRole, flex };
  for (let d = 0; d < CYCLE_DAYS; d++) {
    for (const shift of config.shifts) {
      const candidates = flexible.get(`${d}|${shift.id}`);
      if (!candidates) continue;
      for (const role of config.roles) {
        const required = requiredFor(config, d, shift.id, role.id);
        const k = cellKey(d, shift.id, role.id);
        for (const e of candidates) {
          if ((counts.get(k) ?? 0) >= required) break;
          if (validSecondary(e, roleIds) !== role.id) continue;
          const pk = cellKey(d, shift.id, e.roleId);
          const primary = counts.get(pk) ?? 0;
          if (primary <= requiredFor(config, d, shift.id, e.roleId)) continue;
          counts.set(pk, primary - 1);
          counts.set(k, (counts.get(k) ?? 0) + 1);
          flexRole.set(`${d}|${shift.id}|${e.id}`, role.id);
          flex.push({ day: d, shiftId: shift.id, roleId: role.id, employeeId: e.id });
        }
      }
    }
  }
  return { counts, flexRole, flex };
}

export function countGaps(config: StoreConfig, employees: Employee[], schedule: Schedule): number {
  const { counts } = countWithFlex(config, employees, schedule);
  let total = 0;
  for (let d = 0; d < CYCLE_DAYS; d++) {
    for (const shift of config.shifts) {
      for (const role of config.roles) {
        const required = requiredFor(config, d, shift.id, role.id);
        if (required > 0) total += Math.max(0, required - (counts.get(cellKey(d, shift.id, role.id)) ?? 0));
      }
    }
  }
  return total;
}

export function computeCoverage({ config, employees, schedule, marks }: CoverageInput): CoverageResult {
  const { counts, flexRole, flex } = countWithFlex(config, employees, schedule);
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
  // sai da contagem da função em que estava contando naquele dia (KTD16): a principal ou, se foi
  // para a segunda área, a segunda área. A segunda área é aplicada antes das marcações.
  for (const m of marks) {
    if (m.coveredBy.kind !== 'employee' || !targetValid(m)) continue;
    const e = byId.get(m.coveredBy.employeeId);
    if (!e) continue;
    const cell = schedule[e.id]?.[m.day];
    if (cell?.status === 'work' && effectiveShiftId(e, cell) === m.shiftId) {
      const k = cellKey(m.day, m.shiftId, flexRole.get(`${m.day}|${m.shiftId}|${e.id}`) ?? e.roleId);
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
  return { gaps, covered, orphanMarks, extraShifts, flex, summary, headline: buildHeadline(summary) };
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
