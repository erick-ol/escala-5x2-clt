import { DAILY_LIMIT_MINUTES } from '../../domain/legal';
import { defaultBreakFor, isValidHours } from '../../domain/time';
import { WEEKDAY_NAMES, type AppDocument, type Minimum, type Regime, type Shift, type StoreConfig, type StoreDay } from '../../domain/types';

/** Gera um id legível e único a partir de um nome ("Manhã" → "manha", "manha-2"...). */
export function slugId(name: string, taken: Iterable<string>, fallback = 'item'): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Id aleatório para itens criados sem nome. */
export function randomId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${raw.slice(0, 8)}`;
}

const SHIFT_NAMES: Record<number, string[]> = {
  1: ['Integral'],
  2: ['Manhã', 'Tarde'],
  3: ['Manhã', 'Tarde', 'Noite'],
};

/** Dia aberto com a maior jornada da loja, ou null se nenhum dia abre com horário válido. */
export function longestOpenDay(days: StoreDay[]): StoreDay | null {
  let best: StoreDay | null = null;
  // Dias de turno único não usam os turnos: ficam de fora, a não ser que todos sejam assim.
  const normal = days.filter((d) => d.open && !d.singleShift);
  for (const d of normal.length > 0 ? normal : days) {
    if (!d.open || d.closesAt <= d.opensAt) continue;
    if (!best || d.closesAt - d.opensAt > best.closesAt - best.opensAt) best = d;
  }
  return best;
}

/**
 * R2: divide o dia aberto mais longo em N turnos consecutivos de mesma duração (arredondada a 5min),
 * com o intervalo padrão de KTD17. Mantém os ids dos turnos existentes pela posição.
 */
/**
 * Sugere turnos com a jornada oficial do regime: 8h24 trabalhadas no regime de 42h (liminar do STF)
 * ou 8h no de 40h, mais o intervalo. O primeiro turno começa na abertura e o último termina no fechamento;
 * os do meio ficam igualmente espaçados. Quando a soma passa do horário da loja, os turnos se sobrepõem
 * e as equipes trabalham juntas no meio do dia.
 */
export function suggestShifts(days: StoreDay[], count: number, existing: Shift[] = [], regime: Regime = '42h'): Shift[] {
  const day = longestOpenDay(days);
  if (!day) return [];
  const n = Math.min(3, Math.max(1, Math.round(count)));
  const span = day.closesAt - day.opensAt;
  const worked = DAILY_LIMIT_MINUTES[regime];
  const full = worked + defaultBreakFor(0, worked + 60);
  const duration = Math.min(full, span);
  const names = SHIFT_NAMES[n];
  const shifts: Shift[] = [];
  for (let i = 0; i < n; i += 1) {
    const offset = n === 1 ? 0 : Math.round(((span - duration) * i) / (n - 1) / 5) * 5;
    const start = i === n - 1 && n > 1 ? day.closesAt - duration : day.opensAt + offset;
    const end = start + duration;
    const name = names[i];
    const id = existing[i]?.id ?? slugId(name, [...existing.map((s) => s.id), ...shifts.map((s) => s.id)], 'turno');
    const breakMinutes = duration === full ? full - worked : defaultBreakFor(start, end);
    shifts.push({ id, name, start, end, breakMinutes });
  }
  return shifts;
}

/** Remove mínimos de funções ou turnos que não existem mais. */
export function pruneMinimums(config: Pick<StoreConfig, 'roles' | 'shifts' | 'minimums'>): Minimum[] {
  const roles = new Set(config.roles.map((r) => r.id));
  const shifts = new Set(config.shifts.map((s) => s.id));
  return config.minimums.filter((m) => roles.has(m.roleId) && shifts.has(m.shiftId));
}

export function findMinimum(minimums: Minimum[], roleId: string, shiftId: string): Minimum | undefined {
  return minimums.find((m) => m.roleId === roleId && m.shiftId === shiftId);
}

// ---------- Validação por etapa (devolve o motivo ou null) ----------

export function validateStoreHours(config: StoreConfig): string | null {
  if (!config.days.some((d) => d.open)) return 'Marque pelo menos um dia em que a loja abre.';
  for (let i = 0; i < config.days.length; i += 1) {
    const d = config.days[i];
    if (d.open && d.closesAt <= d.opensAt) {
      return `${WEEKDAY_NAMES[i]}: o fechamento precisa ser depois da abertura.`;
    }
  }
  return null;
}

export function validateShifts(config: StoreConfig): string | null {
  if (config.shifts.length === 0) return 'Cadastre pelo menos um turno (ou use "Sugerir turnos").';
  if (config.shifts.length > 3) return 'Use no máximo 3 turnos.';
  for (let i = 0; i < config.shifts.length; i += 1) {
    const s = config.shifts[i];
    const label = s.name.trim() || `Turno ${i + 1}`;
    if (!s.name.trim()) return `Turno ${i + 1}: dê um nome ao turno.`;
    const problem = isValidHours(s);
    if (problem) return `${label}: ${problem}`;
  }
  return null;
}

export function validateRoles(config: StoreConfig): string | null {
  if (config.roles.length === 0) return 'Cadastre pelo menos uma função (ex.: caixa).';
  for (let i = 0; i < config.roles.length; i += 1) {
    if (!config.roles[i].name.trim()) return `Função ${i + 1}: dê um nome à função.`;
  }
  for (const role of config.roles) {
    for (const shift of config.shifts) {
      const m = findMinimum(config.minimums, role.id, shift.id);
      const ok = m && m.perWeekday.length === 7 && m.perWeekday.every((v) => Number.isInteger(v) && v >= 0);
      if (!ok) return `${role.name}: informe o mínimo de pessoas no turno ${shift.name} (0 ou mais).`;
    }
  }
  return null;
}

export function validateTeam(doc: AppDocument): string | null {
  const { config, employees } = doc;
  if (employees.length === 0) return 'Cadastre pelo menos uma pessoa na equipe.';
  const roles = new Set(config.roles.map((r) => r.id));
  const shifts = new Set(config.shifts.map((s) => s.id));
  for (let i = 0; i < employees.length; i += 1) {
    const e = employees[i];
    if (!e.name.trim()) return `Pessoa ${i + 1}: o nome é obrigatório.`;
    if (!roles.has(e.roleId)) return `${e.name}: escolha a função.`;
    if (!shifts.has(e.shiftId)) return `${e.name}: escolha o turno.`;
    if (e.customHours) {
      const problem = isValidHours(e.customHours);
      if (problem) return `${e.name}: ${problem}`;
    }
  }
  return null;
}

export const STEP_VALIDATORS: Array<(doc: AppDocument) => string | null> = [
  (d) => validateStoreHours(d.config),
  (d) => validateShifts(d.config),
  (d) => validateRoles(d.config),
  validateTeam,
];
