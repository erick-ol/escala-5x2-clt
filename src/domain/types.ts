/** Minutos desde 00:00. Valores >= 1440 não são usados; uma jornada que cruza a meia-noite tem end < start. */
export type Minutes = number;

/** Índice do dia no ciclo: 0..20 (3 semanas, segunda a domingo). */
export type DayIndex = number;

/** 0 = segunda ... 6 = domingo. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKS = 3;
export const DAYS_PER_WEEK = 7;
export const CYCLE_DAYS = WEEKS * DAYS_PER_WEEK;
export const SUNDAY: Weekday = 6;

export const WEEKDAY_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'] as const;
export const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

export interface WorkHours {
  start: Minutes;
  end: Minutes;
  /** Intervalo (almoço) em minutos. */
  breakMinutes: Minutes;
  /**
   * Início do almoço (minutos desde 00:00). Opcional: sem ele, o site planeja o almoço sozinho
   * (lunch.ts), escalonando para a função não ficar descoberta e começando até a 6ª hora de trabalho.
   */
  breakStart?: Minutes;
}

export interface StoreDay {
  open: boolean;
  opensAt: Minutes;
  closesAt: Minutes;
  /**
   * Turno único: nesse dia todos trabalham no horário da loja (ex.: domingo só de manhã).
   * Os turnos cadastrados não valem; o mínimo de cada função é o maior entre os turnos.
   */
  singleShift?: boolean;
}

export interface Shift extends WorkHours {
  id: string;
  name: string;
}

export interface Role {
  id: string;
  name: string;
}

/** Mínimo de pessoas de uma função num turno, por dia da semana (índice 0 = segunda). */
export interface Minimum {
  roleId: string;
  shiftId: string;
  perWeekday: number[];
}

export type Regime = '42h' | '40h';

/**
 * Como o gerador distribui as 2 folgas da semana:
 * - 'together': folgas juntas (ex.: sáb + dom) sempre que possível;
 * - 'flexible': folgas podem ser separadas, se isso cobrir melhor a operação.
 * Nos dois casos o gerador evita mais de 2 folgas seguidas e mais de 6 dias seguidos de trabalho.
 */
export type OffPattern = 'together' | 'flexible';

export interface StoreConfig {
  name: string;
  /** 7 entradas, segunda a domingo. */
  days: StoreDay[];
  shifts: Shift[];
  roles: Role[];
  minimums: Minimum[];
  regime: Regime;
  offPattern: OffPattern;
}

export interface Employee {
  id: string;
  name: string;
  roleId: string;
  /** Segunda área: função que a pessoa cobre quando a principal já está completa naquele turno. */
  secondaryRoleId?: string;
  shiftId: string;
  /** R5a: só altera a regra de domingo; nunca aparece na exportação. */
  isWoman: boolean;
  /** Horário do cadastro; se ausente, vale o padrão do turno. */
  customHours?: WorkHours;
}

export type CellStatus = 'work' | 'off' | 'closed';

export interface Cell {
  status: CellStatus;
  /** Turno daquele dia, se diferente do turno do cadastro. */
  shiftId?: string;
  /** Ajuste de horário só daquele dia (KTD13). */
  hours?: WorkHours;
}

/** Linha de 21 células por funcionário. */
export type Schedule = Record<string, Cell[]>;

export type Coverer = { kind: 'owner' } | { kind: 'employee'; employeeId: string };

/** Marcação ligada a uma vaga faltante específica (KTD15). */
export interface CoverageMark {
  day: DayIndex;
  shiftId: string;
  roleId: string;
  /** Número da vaga faltante (0 = primeira). */
  slot: number;
  coveredBy: Coverer;
}

/** Jornada extra vinda de "coberto por [funcionário]" (KTD16), repassada às regras CLT. */
export interface ExtraShift {
  employeeId: string;
  day: DayIndex;
  shiftId: string;
  /** Função da vaga coberta (para o planejamento do almoço). Ausente em dados antigos: vale a função principal. */
  roleId?: string;
  hours: WorkHours;
}

/**
 * Almoço sem cobertura assumido pelo dono ou pela família: dia, função e o intervalo exato do buraco.
 * Se o almoço mudar de horário, o intervalo não bate mais e a marcação é descartada.
 */
export interface LunchMark {
  day: DayIndex;
  roleId: string;
  from: Minutes;
  to: Minutes;
}

export const SCHEMA_VERSION = 1 as const;

export interface AppDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  config: StoreConfig;
  employees: Employee[];
  schedule: Schedule | null;
  marks: CoverageMark[];
  lunchMarks: LunchMark[];
}
