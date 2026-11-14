import { exampleDocument } from './example';
import {
  defaultBreakFor,
  effectiveHours,
  formatDuration,
  formatTime,
  grossMinutes,
  isValidHours,
  parseTime,
  weekdayOf,
  workedMinutes,
  wrapDay,
} from './time';

describe('tempo', () => {
  test('converte "05:45" em 345 minutos e de volta', () => {
    expect(parseTime('05:45')).toBe(345);
    expect(formatTime(345)).toBe('05:45');
  });

  test('rejeita horários inválidos', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7h')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
  });

  test('horas líquidas de 6:30–14:00 com 1h de intervalo são 390 minutos', () => {
    expect(workedMinutes({ start: 390, end: 840, breakMinutes: 60 })).toBe(390);
  });

  test('jornada que cruza a meia-noite (22:00–06:00) dá 480 minutos brutos', () => {
    expect(grossMinutes({ start: 1320, end: 360 })).toBe(480);
  });

  test('formata durações', () => {
    expect(formatDuration(450)).toBe('7h30');
    expect(formatDuration(360)).toBe('6h');
    expect(formatDuration(45)).toBe('45min');
  });

  test('intervalo padrão: 1h acima de 6h, 15min acima de 4h', () => {
    expect(defaultBreakFor(390, 840)).toBe(60); // 7h30 bruto
    expect(defaultBreakFor(480, 840)).toBe(15); // 6h bruto -> 5h45 trabalhadas
    expect(defaultBreakFor(480, 720)).toBe(0); // 4h
  });

  test('dias do ciclo: semana e circularidade', () => {
    expect(weekdayOf(6)).toBe(6);
    expect(weekdayOf(7)).toBe(0);
    expect(wrapDay(21)).toBe(0);
    expect(wrapDay(-1)).toBe(20);
  });

  test('horário efetivo: dia > cadastro > turno (KTD13)', () => {
    const doc = exampleDocument(new Date('2026-11-14'));
    const rosa = doc.employees.find((e) => e.id === 'rosa')!;
    const andreza = doc.employees.find((e) => e.id === 'andreza')!;
    expect(effectiveHours(doc.config, andreza, { status: 'work' })?.start).toBe(390);
    expect(effectiveHours(doc.config, rosa, { status: 'work' })?.start).toBe(345);
    expect(
      effectiveHours(doc.config, rosa, { status: 'work', hours: { start: 420, end: 900, breakMinutes: 60 } })?.start,
    ).toBe(420);
    // Rosa num turno diferente do cadastro usa o horário daquele turno
    expect(effectiveHours(doc.config, rosa, { status: 'work', shiftId: 'tarde' })?.start).toBe(780);
  });

  test('valida horários', () => {
    expect(isValidHours({ start: 600, end: 600, breakMinutes: 0 })).not.toBeNull();
    expect(isValidHours({ start: 600, end: 660, breakMinutes: 90 })).not.toBeNull();
    expect(isValidHours({ start: 390, end: 840, breakMinutes: 60 })).toBeNull();
  });
});
