import { z } from 'zod';
import { CYCLE_DAYS, SCHEMA_VERSION, type AppDocument } from '../domain/types';

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
});

const employee = z.object({
  id: z.string().min(1),
  name: z.string(),
  roleId: z.string(),
  secondaryRoleId: z.string().optional(),
  shiftId: z.string(),
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
});

export type ParseResult = { ok: true; document: AppDocument } | { ok: false; error: string };

export function parseDocument(value: unknown): ParseResult {
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
