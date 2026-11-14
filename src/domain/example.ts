import { localToday, sundayOnOrBefore } from './dates';
import { defaultRegime } from './legal';
import type { AppDocument, StoreDay } from './types';
import { DEFAULT_LUNCH_FROM, SCHEMA_VERSION } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

const openDay: StoreDay = { open: true, opensAt: h(6, 15), closesAt: h(20, 45), singleShift: false };
/** Domingo só de manhã, com turno único: todos entram juntos. */
const sunday: StoreDay = { open: true, opensAt: h(6, 45), closesAt: h(13, 45), singleShift: true };

/**
 * Exemplo pré-carregado (R7): mercado com 7 funcionários (caixa, balcão e reposição), manhã e tarde,
 * aberto 7 dias, regime de 40h e folgas que podem ser separadas.
 * Segunda a sábado 06:15–20:45; domingo só de manhã (06:45–13:45) com turno único e 2 no balcão.
 * O repositor não tem mínimo: entra como caixa quando falta alguém. A Rosi não tem turno fixo: cobre as folgas do balcão.
 */
export function exampleDocument(today: Date = new Date()): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: {
      name: 'Mercado do exemplo',
      days: Array.from({ length: 7 }, (_, w) => ({ ...(w === 6 ? sunday : openDay) })),
      shifts: [
        { id: 'manha', name: 'Manhã', start: h(6, 15), end: h(15, 15), breakMinutes: 60 },
        { id: 'tarde', name: 'Tarde', start: h(11, 45), end: h(20, 45), breakMinutes: 60 },
      ],
      roles: [
        { id: 'caixa', name: 'Caixa' },
        { id: 'balconista', name: 'Balconista' },
        { id: 'repositor', name: 'Repositor' },
      ],
      minimums: [
        { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'balconista', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 2] },
        { roleId: 'repositor', shiftId: 'manha', perWeekday: [0, 0, 0, 0, 0, 0, 0] },
        { roleId: 'caixa', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'balconista', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 2] },
        { roleId: 'repositor', shiftId: 'tarde', perWeekday: [0, 0, 0, 0, 0, 0, 0] },
      ],
      regime: '40h',
      offPattern: 'flexible',
      lunchFrom: DEFAULT_LUNCH_FROM,
    },
    employees: [
      { id: 'andreza', name: 'Andreza', roleId: 'caixa', shiftId: 'manha', isWoman: true },
      { id: 'richard', name: 'Richard', roleId: 'repositor', secondaryRoleId: 'caixa', shiftId: 'manha', isWoman: false },
      {
        id: 'rosa',
        name: 'Rosa',
        roleId: 'balconista',
        shiftId: 'manha',
        isWoman: true,
        customHours: { start: h(5, 45), end: h(14, 45), breakMinutes: 60 },
      },
      { id: 'pedro', name: 'Pedro', roleId: 'balconista', shiftId: 'tarde', isWoman: false },
      { id: 'lucas', name: 'Lucas', roleId: 'caixa', secondaryRoleId: 'balconista', shiftId: 'tarde', isWoman: false },
      { id: 'joao', name: 'João', roleId: 'caixa', shiftId: 'tarde', isWoman: false },
      { id: 'rosi', name: 'Rosi', roleId: 'balconista', shiftId: 'manha', floating: true, isWoman: true },
    ],
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: sundayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };
}

export function emptyDocument(today: Date = new Date()): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: {
      name: '',
      days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(8), closesAt: h(18), singleShift: false })),
      shifts: [],
      roles: [],
      minimums: [],
      regime: defaultRegime(today),
      offPattern: 'together',
      lunchFrom: DEFAULT_LUNCH_FROM,
    },
    employees: [],
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: sundayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };
}
