import { localToday, mondayOnOrBefore } from './dates';
import { defaultRegime } from './legal';
import type { AppDocument, StoreDay } from './types';
import { SCHEMA_VERSION } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

const openDay: StoreDay = { open: true, opensAt: h(6, 30), closesAt: h(20, 30), singleShift: false };
/** Domingo só de manhã, com turno único: todos entram juntos. */
const sunday: StoreDay = { open: true, opensAt: h(7), closesAt: h(13), singleShift: true };

/**
 * Exemplo pré-carregado (R7): mercado com 6 funcionários, caixa e balcão, manhã e tarde, aberto 7 dias.
 * Domingo abre só de manhã (07:00–13:00) com turno único.
 */
export function exampleDocument(today: Date = new Date()): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: {
      name: 'Mercado do exemplo',
      days: Array.from({ length: 7 }, (_, w) => ({ ...(w === 6 ? sunday : openDay) })),
      shifts: [
        { id: 'manha', name: 'Manhã', start: h(6, 30), end: h(14), breakMinutes: 60 },
        { id: 'tarde', name: 'Tarde', start: h(13), end: h(20, 30), breakMinutes: 60 },
      ],
      roles: [
        { id: 'caixa', name: 'Caixa' },
        { id: 'balconista', name: 'Balconista' },
      ],
      minimums: [
        { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'balconista', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'caixa', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'balconista', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
      ],
      regime: defaultRegime(today),
      offPattern: 'together',
    },
    employees: [
      { id: 'andreza', name: 'Andreza', roleId: 'caixa', secondaryRoleId: 'balconista', shiftId: 'manha', isWoman: true },
      { id: 'richard', name: 'Richard', roleId: 'caixa', shiftId: 'manha', isWoman: false },
      {
        id: 'rosa',
        name: 'Rosa',
        roleId: 'balconista',
        shiftId: 'manha',
        isWoman: true,
        customHours: { start: h(5, 45), end: h(13, 30), breakMinutes: 60 },
      },
      { id: 'pedro', name: 'Pedro', roleId: 'balconista', shiftId: 'tarde', isWoman: false },
      {
        id: 'lucas',
        name: 'Lucas',
        roleId: 'caixa',
        shiftId: 'tarde',
        isWoman: false,
        customHours: { start: h(13, 30), end: h(20, 30), breakMinutes: 60 },
      },
      { id: 'joao', name: 'João', roleId: 'caixa', secondaryRoleId: 'balconista', shiftId: 'tarde', isWoman: false },
    ],
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: mondayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
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
    },
    employees: [],
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: mondayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };
}
