import {
  CYCLE_DAYS,
  DAYS_PER_WEEK,
  type Cell,
  type DayIndex,
  type Employee,
  type Minutes,
  type Shift,
  type StoreConfig,
  type Weekday,
  type WorkHours,
} from './types';

export const MINUTES_PER_DAY = 1440;

export function parseTime(text: string): Minutes | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes: Minutes): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "7h30", "6h", "45min" */
export function formatDuration(minutes: Minutes): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Duração bruta (entrada a saída), tratando jornada que cruza a meia-noite. */
export function grossMinutes(hours: Pick<WorkHours, 'start' | 'end'>): Minutes {
  const d = hours.end - hours.start;
  return d > 0 ? d : d + MINUTES_PER_DAY;
}

/** Tempo trabalhado: bruto menos intervalo (KTD17). */
export function workedMinutes(hours: WorkHours): Minutes {
  return Math.max(0, grossMinutes(hours) - hours.breakMinutes);
}

/** Intervalo padrão sugerido (KTD17): 1h acima de 6h trabalhadas, 15min acima de 4h, senão zero. */
export function defaultBreakFor(start: Minutes, end: Minutes): Minutes {
  const gross = grossMinutes({ start, end });
  // Com 15min de intervalo, ainda passaria de 6h trabalhadas? Então precisa de 1h.
  if (gross - 15 > 6 * 60) return 60;
  if (gross > 4 * 60) return 15;
  return 0;
}

export function weekdayOf(day: DayIndex): Weekday {
  return (((day % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK) as Weekday;
}

export function weekOf(day: DayIndex): number {
  return Math.floor(day / DAYS_PER_WEEK);
}

/** Dia circular do ciclo (KTD5): -1 vira 20, 21 vira 0. */
export function wrapDay(day: number): DayIndex {
  return ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
}

/** Nome do turno virtual dos dias de turno único. */
export const SINGLE_SHIFT_NAME = 'Turno único';
const VIRTUAL_PREFIX = '__dia';

/** Id do turno virtual de um dia da semana com turno único (ex.: `__dia6` no domingo). */
export function virtualShiftId(weekday: Weekday): string {
  return `${VIRTUAL_PREFIX}${weekday}`;
}

export function isVirtualShiftId(shiftId: string): boolean {
  return /^__dia[0-6]$/.test(shiftId);
}

/** Dia da semana aberto e marcado como "turno único": todos trabalham no horário da loja. */
export function isSingleShiftDay(config: StoreConfig, weekday: Weekday): boolean {
  const d = config.days[weekday];
  return !!d?.open && !!d.singleShift;
}

/** Turno virtual do dia (horário da loja, intervalo padrão), ou undefined se o dia não é de turno único. */
export function singleShiftOf(config: StoreConfig, weekday: Weekday): Shift | undefined {
  if (!isSingleShiftDay(config, weekday)) return undefined;
  const d = config.days[weekday];
  return {
    id: virtualShiftId(weekday),
    name: SINGLE_SHIFT_NAME,
    start: d.opensAt,
    end: d.closesAt,
    breakMinutes: defaultBreakFor(d.opensAt, d.closesAt),
  };
}

/** Turnos que valem num dia da semana: só o virtual nos dias de turno único, senão os cadastrados. */
export function dayShifts(config: StoreConfig, weekday: Weekday): Shift[] {
  const single = singleShiftOf(config, weekday);
  return single ? [single] : config.shifts;
}

/** Turno pelo id; resolve também o turno virtual (se o dia ainda é de turno único). */
export function findShift(config: StoreConfig, shiftId: string): Shift | undefined {
  if (isVirtualShiftId(shiftId)) return singleShiftOf(config, Number(shiftId.slice(VIRTUAL_PREFIX.length)) as Weekday);
  return config.shifts.find((s) => s.id === shiftId);
}

/** Turno em que a pessoa trabalha no dia: o virtual nos dias de turno único; senão o ajuste do dia ou o cadastro. */
export function effectiveShiftId(config: StoreConfig, employee: Employee, cell: Cell | undefined, day: DayIndex): string {
  const wd = weekdayOf(day);
  if (isSingleShiftDay(config, wd)) return virtualShiftId(wd);
  return cell?.shiftId ?? employee.shiftId;
}

/**
 * Mínimo de pessoas da função no turno, num dia do ciclo (0 se a loja está fechada).
 * No turno virtual (turno único) vale o maior mínimo da função entre os turnos cadastrados.
 * Nos turnos cadastrados de um dia de turno único, 0.
 */
export function requiredCount(config: StoreConfig, day: DayIndex, shiftId: string, roleId: string): number {
  const wd = weekdayOf(day);
  if (!config.days[wd]?.open) return 0;
  const single = isSingleShiftDay(config, wd);
  if (isVirtualShiftId(shiftId)) {
    if (!single || shiftId !== virtualShiftId(wd)) return 0;
    let max = 0;
    for (const m of config.minimums) if (m.roleId === roleId) max = Math.max(max, m.perWeekday[wd] ?? 0);
    return max;
  }
  if (single) return 0;
  const min = config.minimums.find((m) => m.shiftId === shiftId && m.roleId === roleId);
  return Math.max(0, min?.perWeekday[wd] ?? 0);
}

/**
 * Horário efetivo (KTD13): ajuste do dia > cadastro > padrão do turno.
 * Se o dia está num turno diferente do cadastro, o horário do cadastro não se aplica.
 * Nos dias de turno único vale o horário da loja (o horário do cadastro é do turno cadastrado).
 */
export function effectiveHours(
  config: StoreConfig,
  employee: Employee,
  cell: Cell | undefined,
  day: DayIndex,
): WorkHours | null {
  if (cell?.hours) return cell.hours;
  const shiftId = effectiveShiftId(config, employee, cell, day);
  if (shiftId === employee.shiftId && employee.customHours) return employee.customHours;
  const shift = findShift(config, shiftId);
  if (!shift) return null;
  return shiftHours(shift);
}

/** Horário do cadastro da pessoa (fora dos dias de turno único): cadastro > padrão do turno. */
export function registeredHours(config: StoreConfig, employee: Employee): WorkHours | null {
  if (employee.customHours) return employee.customHours;
  const shift = config.shifts.find((s) => s.id === employee.shiftId);
  return shift ? shiftHours(shift) : null;
}

/** Horário padrão de um turno (com o início do almoço, se o turno define um). */
export function shiftHours(shift: Shift): WorkHours {
  const hours: WorkHours = { start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes };
  if (shift.breakStart !== undefined) hours.breakStart = shift.breakStart;
  return hours;
}

export function isValidHours(hours: WorkHours): string | null {
  if (hours.start === hours.end) return 'Entrada e saída não podem ser iguais.';
  if (hours.breakMinutes < 0) return 'O intervalo não pode ser negativo.';
  if (hours.breakMinutes >= grossMinutes(hours)) return 'O intervalo é maior que a jornada.';
  return null;
}
