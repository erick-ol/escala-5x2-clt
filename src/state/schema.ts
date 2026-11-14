import { z } from 'zod';
import { addDays, isISODate, localToday, sundayOnOrBefore, weekdayOfDate } from '../domain/dates';
import { CYCLE_DAYS, DEFAULT_LUNCH_FROM, SCHEMA_VERSION, type AppDocument } from '../domain/types';

const minutes = z.number().int().min(0).max(1439);

const workHours = z.object({
  start: minutes,
  end: minutes,
  breakMinutes: z.number().int().min(0).max(1440),
  breakStart: minutes.optional(),
});

const storeDay = z.object({
  open: z.boolean(),
  opensAt: minutes,
  closesAt: minutes,
  singleShift: z.boolean().default(false),
  noOff: z.boolean().optional(),
});

const shift = workHours.extend({ id: z.string().min(1), name: z.string() });
const role = z.object({ id: z.string().min(1), name: z.string() });
const minimum = z.object({
  roleId: z.string(),
  shiftId: z.string(),
  perWeekday: z.array(z.number().int().min(0)).length(7),
});

const config = z.object({
  name: z.string(),
  days: z.array(storeDay).length(7),
  shifts: z.array(shift),
  roles: z.array(role),
  minimums: z.array(minimum),
  regime: z.enum(['42h', '40h']),
  offPattern: z.enum(['together', 'flexible']).default('together'),
  /** Ausente em documentos e backups antigos: 11:30. */
  lunchFrom: minutes.default(DEFAULT_LUNCH_FROM),
});

const employee = z.object({
  id: z.string().min(1),
  name: z.string(),
  roleId: z.string(),
  secondaryRoleId: z.string().optional(),
  shiftId: z.string(),
  floating: z.boolean().optional(),
  isWoman: z.boolean(),
  customHours: workHours.optional(),
});

const cell = z.object({
  status: z.enum(['work', 'off', 'closed']),
  shiftId: z.string().optional(),
  hours: workHours.optional(),
});

const coverer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner') }),
  z.object({ kind: z.literal('employee'), employeeId: z.string() }),
]);

const mark = z.object({
  day: z.number().int().min(0).max(CYCLE_DAYS - 1),
  shiftId: z.string(),
  roleId: z.string(),
  slot: z.number().int().min(0),
  coveredBy: coverer,
});

/**
 * Projeção no calendário (visão Mês). Ausente em documentos e backups antigos: o ciclo passa a começar
 * no domingo desta semana. Datas inválidas não derrubam a leitura: reconcile.ts as descarta.
 */
const calendar = z
  .object({
    cycleStart: z.string().default(() => sundayOnOrBefore(localToday())),
    closedDates: z.array(z.string()).default([]),
    dateOverrides: z.array(z.object({ date: z.string(), employeeId: z.string(), cell })).default([]),
  })
  .default({});

export const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  config,
  employees: z.array(employee),
  schedule: z.record(z.array(cell).length(CYCLE_DAYS)).nullable(),
  marks: z.array(mark),
  lunchMarks: z
    .array(
      z.object({
        day: z.number().int().min(0).max(CYCLE_DAYS - 1),
        roleId: z.string(),
        from: z.number().int().min(0),
        to: z.number().int().min(0),
      }),
    )
    .default([]),
  calendar,
});

export type ParseResult = { ok: true; document: AppDocument } | { ok: false; error: string };

/** Versão 1: semana de segunda a domingo (o dia 0 do ciclo era uma segunda). */
const V1 = 1;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Novo índice de um dia do ciclo da versão 1: cada dia anda uma posição (o domingo da semana 3, dia 20, vira o dia 0). */
const shiftV1Day = (day: unknown) => (typeof day === 'number' && Number.isInteger(day) ? (day + 1) % CYCLE_DAYS : day);

/**
 * Converte um documento da versão 1 (semana de segunda a domingo) para a 2 (domingo a sábado), sem validar
 * (a validação vem depois, com o esquema atual). Cada célula mantém o dia da semana: a linha de 21 dias gira
 * uma posição (novo índice = (antigo + 1) mod 21) e as marcações de cobertura e de almoço andam junto.
 * O início do ciclo volta um dia (da segunda para o domingo anterior), então cada data real continua com a
 * mesma célula. Feriados e ajustes de data são datas reais e não mudam. Como as semanas passam a ser de
 * domingo a sábado, algumas regras podem acusar alertas novos: basta gerar a escala de novo.
 */
export function migrateV1(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value, schemaVersion: SCHEMA_VERSION };
  if (isRecord(value.schedule)) {
    const schedule: Record<string, unknown> = {};
    for (const [id, row] of Object.entries(value.schedule)) {
      schedule[id] =
        Array.isArray(row) && row.length === CYCLE_DAYS ? row.map((_, i) => row[(i - 1 + CYCLE_DAYS) % CYCLE_DAYS]) : row;
    }
    out.schedule = schedule;
  }
  const shiftMarks = (list: unknown) =>
    Array.isArray(list) ? list.map((m) => (isRecord(m) ? { ...m, day: shiftV1Day(m.day) } : m)) : list;
  if ('marks' in value) out.marks = shiftMarks(value.marks);
  if ('lunchMarks' in value) out.lunchMarks = shiftMarks(value.lunchMarks);
  if (isRecord(value.calendar)) {
    const start = value.calendar.cycleStart;
    if (typeof start === 'string' && isISODate(start)) {
      // Segunda do ciclo antigo (a mesma correção que a leitura da versão 1 fazia) e o domingo anterior a ela.
      const monday = addDays(start, -weekdayOfDate(start));
      out.calendar = { ...value.calendar, cycleStart: addDays(monday, -1) };
    }
  }
  return out;
}

export function parseDocument(value: unknown): ParseResult {
  if (isRecord(value) && value.schemaVersion === V1) value = migrateV1(value);
  const result = documentSchema.safeParse(value);
  if (result.success) return { ok: true, document: result.data as AppDocument };
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as { schemaVersion: unknown }).schemaVersion !== SCHEMA_VERSION
  ) {
    return { ok: false, error: 'Este arquivo é de uma versão diferente do site e não pode ser lido.' };
  }
  return { ok: false, error: 'O arquivo não é um backup válido da escala.' };
}
