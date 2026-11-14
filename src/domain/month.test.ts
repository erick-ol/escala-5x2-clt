import {
  addDays,
  daysBetween,
  daysInMonth,
  fromDayNumber,
  dayNumber,
  isISODate,
  localToday,
  mondayOnOrBefore,
  monthLabel,
  shiftMonth,
  weekdayOfDate,
} from './dates';
import { exampleDocument } from './example';
import { generateSchedule } from './generator';
import { cellOnDate, cycleDayOf, monthWeeks, projectMonth, projectWeek, weekAlertsAsCycle } from './month';
import { reconcileDocument } from './reconcile';
import { evaluateRules, linearWorkStreaks } from './rules';
import type { AppDocument, Cell, Schedule } from './types';
import { parseDocument } from '../state/schema';

const TODAY = new Date('2026-11-14T12:00:00');
const START = '2026-11-30';

/** Exemplo com escala gerada e ciclo começando na segunda 30/11/2026. */
function generated(tweak?: (d: AppDocument) => void): AppDocument {
  const base = exampleDocument(TODAY);
  const doc: AppDocument = {
    ...base,
    schedule: generateSchedule({ config: base.config, employees: base.employees }),
    calendar: { cycleStart: START, closedDates: [], dateOverrides: [] },
  };
  tweak?.(doc);
  return doc;
}

/** Escala feita à mão: todos 5x2 (seg–sex), folga sáb + dom, sem buracos de mínimo. */
function handmade(tweak?: (d: AppDocument) => void): AppDocument {
  return generated((d) => {
    d.config.minimums = [];
    const week: Cell[] = [...Array(5).fill({ status: 'work' }), { status: 'off' }, { status: 'off' }];
    const schedule: Schedule = {};
    for (const e of d.employees) schedule[e.id] = [...week, ...week, ...week].map((c) => ({ ...c }));
    d.schedule = schedule;
    tweak?.(d);
  });
}

const override = (date: string, employeeId: string, cell: Cell) => ({ date, employeeId, cell });

describe('datas sem fuso', () => {
  test('dia da semana, segunda anterior e dia de hoje local', () => {
    expect(weekdayOfDate('2026-11-30')).toBe(0);
    expect(weekdayOfDate('2026-12-06')).toBe(6);
    expect(weekdayOfDate('1970-01-01')).toBe(3);
    expect(mondayOnOrBefore('2026-11-14')).toBe('2026-11-09');
    expect(mondayOnOrBefore('2026-11-30')).toBe('2026-11-30');
    expect(localToday(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  test('virada de mês, de ano e anos bissextos', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
    expect(daysBetween('2027-02-01', '2027-03-01')).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(isISODate('2027-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    for (const d of ['1999-12-31', '2026-11-30', '2028-02-29', '2400-02-29']) expect(fromDayNumber(dayNumber(d))).toBe(d);
  });

  test('nome do mês e troca de mês', () => {
    expect(monthLabel(2026, 12)).toBe('Dezembro de 2026');
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });
});

describe('ciclo projetado nas datas', () => {
  test('dia do ciclo: repete a cada 21 dias, inclusive antes do início e na virada do mês/ano', () => {
    expect(cycleDayOf(START, '2026-11-30')).toBe(0);
    expect(cycleDayOf(START, '2026-12-01')).toBe(1);
    expect(cycleDayOf(START, '2026-12-20')).toBe(20);
    expect(cycleDayOf(START, '2026-12-21')).toBe(0);
    expect(cycleDayOf(START, '2026-11-29')).toBe(20);
    expect(cycleDayOf(START, '2027-01-01')).toBe(32 % 21);
    // Fevereiro bissexto: 29/02/2028 e 01/03/2028 são dias seguidos do ciclo.
    const a = cycleDayOf(START, '2028-02-29');
    expect(cycleDayOf(START, '2028-03-01')).toBe((a + 1) % 21);
    // O dia da semana sempre bate.
    for (let i = -40; i < 400; i += 7) {
      const date = addDays(START, i);
      expect(cycleDayOf(START, date) % 7).toBe(weekdayOfDate(date));
    }
  });

  test('semanas de um mês: Dez/2026 tem 5 (30/11 a 28/12); Fev/2027 tem 4; Fev/2028 tem 5', () => {
    expect(monthWeeks(2026, 12)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']);
    expect(monthWeeks(2027, 2)).toEqual(['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']);
    expect(monthWeeks(2028, 2)).toHaveLength(5);
  });

  test('a projeção do mês usa a semana certa do ciclo em cada semana real', () => {
    const doc = generated();
    const month = projectMonth(doc, 2026, 12)!;
    expect(month.weeks.map((w) => w.cycleWeek)).toEqual([0, 1, 2, 0, 1]);
    expect(month.dates).toHaveLength(31);
    const week = month.weeks[1];
    for (const e of doc.employees) {
      week.dates.forEach((_, i) => expect(week.doc.schedule![e.id][week.firstDay + i]).toEqual(doc.schedule![e.id][7 + i]));
    }
  });

  test('ajuste vale só na data: a mesma posição do ciclo 21 dias depois continua igual', () => {
    const doc = generated();
    const day = doc.schedule!.rosa.findIndex((c) => c.status === 'work');
    const date = addDays(START, day);
    doc.calendar.dateOverrides = [override(date, 'rosa', { status: 'off' })];
    expect(cellOnDate(doc, 'rosa', date)).toMatchObject({ cell: { status: 'off' }, source: 'override' });
    expect(cellOnDate(doc, 'rosa', addDays(date, 21))).toMatchObject({ cell: { status: 'work' }, source: 'cycle' });
    expect(cellOnDate(doc, 'andreza', date).source).toBe('cycle');
    const week = projectWeek(doc, date)!;
    expect(week.overridden.has(`rosa|${weekdayOfDate(date)}`)).toBe(true);
    expect(week.overridden.size).toBe(1);
  });

  test('feriado: todos ficam "loja fechada" e a data não tem mínimo (sem buraco)', () => {
    const date = '2026-12-08';
    const wd = weekdayOfDate(date);
    // Sem feriado, todos de folga nessa data abrem buracos.
    const empty = generated((d) => {
      d.calendar.dateOverrides = d.employees.map((e) => override(date, e.id, { status: 'off' }));
    });
    const without = projectWeek(empty, date)!;
    expect(without.coverage.gaps.some((g) => g.day === without.firstDay + wd)).toBe(true);

    const holiday = generated((d) => {
      d.calendar.closedDates = [date];
    });
    const week = projectWeek(holiday, date)!;
    expect(week.holidays[wd]).toBe(true);
    for (const e of holiday.employees) {
      expect(week.doc.schedule![e.id][week.firstDay + wd]).toEqual({ status: 'closed' });
      expect(cellOnDate(holiday, e.id, date)).toMatchObject({ cell: { status: 'closed' }, source: 'holiday' });
    }
    expect(week.coverage.gaps.filter((g) => g.day === week.firstDay + wd)).toEqual([]);
    expect(week.lunchGaps.filter((g) => g.day === week.firstDay + wd)).toEqual([]);
    // O feriado conta como descanso: ninguém ganha alerta de folga por causa dele.
    const month = projectMonth(holiday, 2026, 12)!;
    const base = projectMonth(generated(), 2026, 12)!;
    expect(month.alerts.filter((a) => a.kind === 'days-off')).toEqual(base.alerts.filter((a) => a.kind === 'days-off'));
  });
});

describe('regras CLT nas datas reais (modo linear)', () => {
  test('escala 5x2 sem ajustes: nenhum alerta no mês', () => {
    const month = projectMonth(handmade(), 2026, 12)!;
    expect(month.alerts).toEqual([]);
    expect(month.reports.rosa.weeklyMinutes).toHaveLength(5);
  });

  test('ajuste que cria 3 folgas na semana gera "too-many-offs" com a semana real', () => {
    const doc = handmade((d) => {
      d.calendar.dateOverrides = [override('2026-12-09', 'rosa', { status: 'off' })];
    });
    const month = projectMonth(doc, 2026, 12)!;
    const alert = month.alerts.find((a) => a.kind === 'too-many-offs');
    expect(alert).toMatchObject({ employeeId: 'rosa', weekStart: '2026-12-07', date: null });
    expect(alert!.message).toBe('Semana de 07/12 com 3 folgas (máximo 2)');
    // O ciclo não mudou: a mesma posição 21 dias depois não tem alerta.
    expect(month.alerts.filter((a) => a.weekStart === '2026-12-28')).toEqual([]);
  });

  test('descanso de 11h quebrado na virada do mês (30/11 → 01/12) aparece em dezembro', () => {
    const doc = handmade((d) => {
      d.calendar.dateOverrides = [
        override('2026-11-30', 'richard', { status: 'work', hours: { start: 15 * 60, end: 23 * 60, breakMinutes: 60 } }),
      ];
    });
    const dec = projectMonth(doc, 2026, 12)!;
    expect(dec.alerts.filter((a) => a.kind === 'intershift-rest')).toEqual([
      expect.objectContaining({ employeeId: 'richard', date: '2026-12-01' }),
    ]);
    // Novembro só vê o fim do mês: o alerta é do dia 01/12 e fica de fora.
    const nov = projectMonth(doc, 2026, 11)!;
    expect(nov.alerts.filter((a) => a.kind === 'intershift-rest')).toEqual([]);
    // No ciclo circular nada muda (o ajuste é só da data).
    const cycle = evaluateRules({ config: doc.config, employees: doc.employees, schedule: doc.schedule! });
    expect(cycle.richard.alerts).toEqual([]);
  });

  test('7 dias seguidos de trabalho atravessando a semana geram "work-streak" na data do 7º dia', () => {
    const doc = handmade((d) => {
      d.calendar.dateOverrides = [
        override('2026-12-12', 'pedro', { status: 'work' }),
        override('2026-12-13', 'pedro', { status: 'work' }),
      ];
    });
    const month = projectMonth(doc, 2026, 12)!;
    const streak = month.alerts.find((a) => a.kind === 'work-streak');
    // Seg 07/12 a sex 18/12 = 12 dias seguidos; o 7º é domingo 13/12.
    expect(streak).toMatchObject({ employeeId: 'pedro', date: '2026-12-13', endDate: '2026-12-18' });
    expect(streak!.message).toMatch(/^12 dias seguidos/);
    // Aparece nas duas semanas que ele toca.
    const [w2, w3] = [month.weeks[1], month.weeks[2]];
    expect(weekAlertsAsCycle(w2, [streak!])).toEqual([expect.objectContaining({ day: w2.firstDay + 6 })]);
    expect(weekAlertsAsCycle(w3, [streak!])).toEqual([expect.objectContaining({ day: w3.firstDay })]);
  });

  test('domingos: mulher em 2 domingos seguidos; homem só no 3º domingo seguido (margem antes do mês)', () => {
    const doc = handmade((d) => {
      d.calendar.dateOverrides = [
        override('2026-11-29', 'rosa', { status: 'work' }),
        override('2026-12-06', 'rosa', { status: 'work' }),
        override('2026-11-22', 'pedro', { status: 'work' }),
        override('2026-11-29', 'pedro', { status: 'work' }),
        override('2026-12-06', 'pedro', { status: 'work' }),
      ];
    });
    const month = projectMonth(doc, 2026, 12)!;
    const sunday = month.alerts.filter((a) => a.kind === 'sunday-rotation');
    expect(sunday).toEqual([
      expect.objectContaining({ employeeId: 'rosa', date: '2026-12-06' }),
      expect.objectContaining({ employeeId: 'pedro', date: '2026-12-06' }),
    ]);
  });

  test('sequências lineares não emendam o fim no começo', () => {
    expect(linearWorkStreaks([true, false, true, true])).toEqual([
      { start: 0, length: 1 },
      { start: 2, length: 2 },
    ]);
  });
});

describe('documento', () => {
  test('reconcile descarta ajustes de quem saiu da equipe e leva o início do ciclo para a segunda', () => {
    const doc = generated((d) => {
      d.calendar = {
        cycleStart: '2026-12-03',
        closedDates: ['2026-12-25', 'x', '2026-12-25'],
        dateOverrides: [override('2026-12-02', 'rosa', { status: 'off' }), override('2026-12-02', 'fantasma', { status: 'off' })],
      };
    });
    const out = reconcileDocument(doc);
    expect(out.calendar.cycleStart).toBe('2026-11-30');
    expect(out.calendar.closedDates).toEqual(['2026-12-25']);
    expect(out.calendar.dateOverrides).toEqual([override('2026-12-02', 'rosa', { status: 'off' })]);
    const removed = reconcileDocument({ ...out, employees: out.employees.filter((e) => e.id !== 'rosa') });
    expect(removed.calendar.dateOverrides).toEqual([]);
  });

  test('documento coerente com calendário volta inalterado', () => {
    const doc = generated((d) => {
      d.calendar.dateOverrides = [override('2026-12-02', 'rosa', { status: 'off' })];
    });
    expect(reconcileDocument(doc)).toBe(doc);
  });

  test('documento antigo (sem calendário) é lido com os padrões', () => {
    const { calendar: _drop, ...old } = generated();
    void _drop;
    const result = parseDocument(JSON.parse(JSON.stringify(old)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { calendar } = result.document;
    expect(weekdayOfDate(calendar.cycleStart)).toBe(0);
    expect(calendar.closedDates).toEqual([]);
    expect(calendar.dateOverrides).toEqual([]);
  });
});
