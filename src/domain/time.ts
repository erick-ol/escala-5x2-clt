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

export function findShift(config: StoreConfig, shiftId: string): Shift | undefined {
  return config.shifts.find((s) => s.id === shiftId);
}

export function effectiveShiftId(employee: Employee, cell: Cell | undefined): string {
  return cell?.shiftId ?? employee.shiftId;
}

/**
 * Horário efetivo (KTD13): ajuste do dia > cadastro > padrão do turno.
 * Se o dia está num turno diferente do cadastro, o horário do cadastro não se aplica.
 */
export function effectiveHours(config: StoreConfig, employee: Employee, cell: Cell | undefined): WorkHours | null {
  if (cell?.hours) return cell.hours;
  const shiftId = effectiveShiftId(employee, cell);
  if (shiftId === employee.shiftId && employee.customHours) return employee.customHours;
  const shift = findShift(config, shiftId);
  if (!shift) return null;
  return { start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes };
}

export function isValidHours(hours: WorkHours): string | null {
  if (hours.start === hours.end) return 'Entrada e saída não podem ser iguais.';
  if (hours.breakMinutes < 0) return 'O intervalo não pode ser negativo.';
  if (hours.breakMinutes >= grossMinutes(hours)) return 'O intervalo é maior que a jornada.';
  return null;
}
