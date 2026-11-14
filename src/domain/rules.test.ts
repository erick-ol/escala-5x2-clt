import { exampleDocument } from './example';
import { evaluateEmployee, evaluateRules, type AlertKind, type LegalAlert, type RulesInput } from './rules';
import type { Cell, Employee, ExtraShift, StoreConfig, WorkHours } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const SUNDAYS = [6, 13, 20];

const doc = exampleDocument(new Date('2026-11-14'));
const baseConfig: StoreConfig = { ...doc.config, regime: '42h' };

function emp(overrides: Partial<Employee> = {}): Employee {
  return { id: 'e1', name: 'Fulano', roleId: 'caixa', shiftId: 'manha', isWoman: false, ...overrides };
}

const W: Cell = { status: 'work' };
const O: Cell = { status: 'off' };
const C: Cell = { status: 'closed' };
const at = (start: number, end: number, breakMinutes = 60): Cell => ({
  status: 'work',
  hours: { start, end, breakMinutes },
});

/** Semana padrão 5x2: segunda a sexta trabalhando, sábado e domingo de folga. */
function week5x2(): Cell[] {
  return [W, W, W, W, W, O, O];
}

function cycle(...weeks: Cell[][]): Cell[] {
  const cells = weeks.flat();
  expect(cells).toHaveLength(21);
  return cells;
}

function std(): Cell[] {
  return cycle(week5x2(), week5x2(), week5x2());
}

function input(cells: Cell[], opts: { employee?: Partial<Employee>; config?: Partial<StoreConfig>; extra?: ExtraShift[] } = {}): RulesInput {
  const e = emp(opts.employee);
  return {
    config: { ...baseConfig, ...opts.config },
    employees: [e],
    schedule: { [e.id]: cells },
    extraShifts: opts.extra,
  };
}

function alerts(cells: Cell[], opts: Parameters<typeof input>[1] = {}): LegalAlert[] {
  return evaluateEmployee(input(cells, opts), 'e1').alerts;
}

function ofKind(list: LegalAlert[], kind: AlertKind): LegalAlert[] {
  return list.filter((a) => a.kind === kind);
}

function withCells(base: Cell[], changes: Record<number, Cell>): Cell[] {
  const cells = [...base];
  for (const [day, cell] of Object.entries(changes)) cells[Number(day)] = cell;
  return cells;
}

describe('motor de regras CLT', () => {
  test('5x2 padrão no turno da manhã não gera alertas e soma 32h30 por semana', () => {
    const report = evaluateEmployee(input(std()), 'e1');
    expect(report.alerts).toEqual([]);
    expect(report.weeklyMinutes).toEqual([h(32, 30), h(32, 30), h(32, 30)]);
    expect(report.employeeId).toBe('e1');
  });

  test('escala de referência ajustada para 5x2 não gera alertas (incluindo teto)', () => {
    const schedule: Record<string, Cell[]> = {};
    for (const e of doc.employees) schedule[e.id] = std();
    const result = evaluateRules({ config: baseConfig, employees: doc.employees, schedule });
    expect(Object.keys(result).sort()).toEqual(doc.employees.map((e) => e.id).sort());
    for (const e of doc.employees) {
      expect(result[e.id].alerts).toEqual([]);
      expect(Math.max(...result[e.id].weeklyMinutes)).toBeLessThanOrEqual(h(42));
    }
    expect(result.andreza.weeklyMinutes).toEqual([h(32, 30), h(32, 30), h(32, 30)]);
    expect(result.rosa.weeklyMinutes[0]).toBe(h(33, 45));
  });

  test('funcionário sem linha na escala gera relatório vazio', () => {
    const report = evaluateEmployee({ config: baseConfig, employees: [emp()], schedule: {} }, 'e1');
    expect(report.weeklyMinutes).toEqual([0, 0, 0]);
  });

  describe('descanso entre jornadas (11h)', () => {
    test('AE4: saída 20:30 na sexta e entrada 5:45 no sábado gera alerta', () => {
      const cells = withCells(std(), { 4: at(h(13), h(20, 30)), 5: at(h(5, 45), h(13, 30)), 6: O });
      // Semana 1 fica com só um dia sem trabalho; o foco aqui é o descanso.
      const list = ofKind(alerts(cells), 'intershift-rest');
      expect(list).toHaveLength(1);
      expect(list[0].day).toBe(5);
      expect(list[0].message).toBe('Descanso de 9h15 entre jornadas (mínimo 11h)');
    });

    test('virada do ciclo: saída 22:00 no dia 21 e entrada 6:00 no dia 1 gera alerta', () => {
      const cells = withCells(std(), { 20: at(h(14), h(22)), 0: at(h(6), h(14)) });
      const list = ofKind(alerts(cells), 'intershift-rest');
      expect(list).toHaveLength(1);
      expect(list[0].day).toBe(0);
      expect(list[0].message).toContain('8h');
    });

    test('exatamente 11h não gera alerta', () => {
      const cells = withCells(std(), { 0: at(h(9), h(17)), 1: at(h(4), h(12)) });
      expect(ofKind(alerts(cells), 'intershift-rest')).toEqual([]);
    });

    test('jornada que cruza a meia-noite conta a saída no dia seguinte', () => {
      // Segunda 22:00 a terça 06:00, terça 13:00 → 7h de descanso.
      const cells = withCells(std(), { 0: at(h(22), h(6)), 1: at(h(13), h(19)) });
      const list = ofKind(alerts(cells), 'intershift-rest');
      expect(list.map((a) => a.day)).toEqual([1]);
    });
  });

  describe('rodízio de domingo', () => {
    test('AE5: sem R5a trabalhando os 3 domingos gera alerta', () => {
      const cells = withCells(std(), { 6: W, 13: W, 20: W, 5: O, 12: O, 19: O });
      const list = ofKind(alerts(cells), 'sunday-rotation');
      expect(list).toHaveLength(1);
      expect(list[0].message).toContain('3 semanas');
    });

    test('sem R5a trabalhando 2 dos 3 domingos não gera alerta', () => {
      const cells = withCells(std(), { 6: W, 13: W, 5: O, 12: O });
      expect(ofKind(alerts(cells), 'sunday-rotation')).toEqual([]);
    });

    test.each([
      { name: 'domingos 1 e 2', worked: [6, 13], expectedDays: [13] },
      { name: 'domingos 2 e 3', worked: [13, 20], expectedDays: [20] },
      { name: 'domingo 3 seguido do domingo 1 (virada)', worked: [20, 6], expectedDays: [6] },
      { name: 'os 3 domingos', worked: [6, 13, 20], expectedDays: [6, 13, 20] },
    ])('AE7: com R5a, $name gera alerta', ({ worked, expectedDays }) => {
      const changes: Record<number, Cell> = {};
      for (const d of worked) {
        changes[d] = W;
        changes[d - 1] = O;
      }
      const list = ofKind(alerts(withCells(std(), changes), { employee: { isWoman: true } }), 'sunday-rotation');
      expect(list.map((a) => a.day).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(expectedDays);
      expect(list[0].message).toContain('2 semanas');
    });

    test('com R5a, trabalhando só 1 domingo não gera alerta', () => {
      const cells = withCells(std(), { 13: W, 12: O });
      expect(ofKind(alerts(cells, { employee: { isWoman: true } }), 'sunday-rotation')).toEqual([]);
    });

    test('domingo de loja fechada conta como descanso', () => {
      const closedSunday = baseConfig.days.map((d, i) => (i === 6 ? { ...d, open: false } : d));
      const cells = cycle(
        [W, W, W, W, W, O, C],
        [W, W, W, W, W, O, C],
        [W, W, W, W, W, O, C],
      );
      expect(alerts(cells, { config: { days: closedSunday }, employee: { isWoman: true } })).toEqual([]);
    });

    test('jornada extra num domingo de folga conta como domingo trabalhado', () => {
      const cells = withCells(std(), { 6: W, 13: W, 5: O, 12: O });
      const extra: ExtraShift[] = [{ employeeId: 'e1', day: 20, shiftId: 'manha', hours: { start: h(6, 30), end: h(14), breakMinutes: 60 } }];
      expect(ofKind(alerts(cells, { extra }), 'sunday-rotation')).toHaveLength(1);
    });
  });

  describe('folgas por semana', () => {
    test.each([
      { name: '3 folgas', week: [W, W, O, W, O, O, W] as Cell[], kind: 'too-many-offs' as AlertKind },
      { name: '1 folga', week: [W, W, W, W, W, W, O] as Cell[], kind: 'days-off' as AlertKind },
    ])('semana com $name gera alerta', ({ week, kind }) => {
      const list = alerts(cycle(week5x2(), week, week5x2()));
      const found = ofKind(list, kind);
      expect(found).toHaveLength(1);
      expect(found[0].week).toBe(1);
    });

    test('loja fechada no domingo e 1 folga atribuída não gera alerta de folgas', () => {
      const cells = cycle([W, W, W, W, W, O, C], week5x2(), week5x2());
      const list = alerts(cells);
      expect(ofKind(list, 'days-off')).toEqual([]);
      expect(ofKind(list, 'too-many-offs')).toEqual([]);
    });

    test('2 folgas mais domingo fechado (3 dias sem trabalho) não gera alerta', () => {
      const cells = cycle([W, W, W, W, O, O, C], week5x2(), week5x2());
      expect(ofKind(alerts(cells), 'too-many-offs')).toEqual([]);
    });

    test('jornada extra num dia de folga tira o dia da contagem de dias sem trabalho', () => {
      const extra: ExtraShift[] = [{ employeeId: 'e1', day: 5, shiftId: 'manha', hours: { start: h(6, 30), end: h(14), breakMinutes: 60 } }];
      const found = ofKind(alerts(std(), { extra }), 'days-off');
      expect(found.map((a) => a.week)).toEqual([0]);
    });
  });

  describe('jornada extra (coberto por)', () => {
    test('entra nas horas e no descanso da pessoa', () => {
      // Folga de domingo vira jornada extra das 13:00 às 22:00 (8h); segunda de manhã segue normal.
      const extra: ExtraShift[] = [{ employeeId: 'e1', day: 6, shiftId: 'tarde', hours: { start: h(13), end: h(22), breakMinutes: 60 } }];
      const report = evaluateEmployee(input(std(), { extra }), 'e1');
      expect(report.weeklyMinutes[0]).toBe(h(32, 30) + h(8));
      // Domingo 22:00 → segunda 06:30 = 8h30 de descanso.
      expect(ofKind(report.alerts, 'intershift-rest').map((a) => a.day)).toEqual([7]);
    });

    test('ignora jornada extra de outra pessoa', () => {
      const extra: ExtraShift[] = [{ employeeId: 'outro', day: 5, shiftId: 'manha', hours: { start: h(6, 30), end: h(14), breakMinutes: 60 } }];
      expect(evaluateEmployee(input(std(), { extra }), 'e1').weeklyMinutes[0]).toBe(h(32, 30));
    });
  });

  describe('limite diário e teto semanal', () => {
    test('duas jornadas no mesmo dia (turnos diferentes) somam para a regra de 8h', () => {
      const extra: ExtraShift[] = [{ employeeId: 'e1', day: 2, shiftId: 'tarde', hours: { start: h(15), end: h(19), breakMinutes: 0 } }];
      const list = ofKind(alerts(std(), { extra }), 'daily-limit');
      expect(list).toHaveLength(1);
      expect(list[0].day).toBe(2);
      expect(list[0].message).toContain('10h30');
    });

    test('5 dias de 9h líquidas no regime 42h geram teto semanal e 8h diárias com acordo coletivo', () => {
      const nine = at(h(8), h(18), 60);
      const week: Cell[] = [nine, nine, nine, nine, nine, O, O];
      const list = alerts(cycle(week, week5x2(), week5x2()));
      const weekly = ofKind(list, 'weekly-limit');
      expect(weekly).toHaveLength(1);
      expect(weekly[0].week).toBe(0);
      expect(weekly[0].message).toContain('45h');
      expect(weekly[0].message).toContain('42h');
      const daily = ofKind(list, 'daily-limit');
      expect(daily.map((a) => a.day)).toEqual([0, 1, 2, 3, 4]);
      expect(daily[0].message).toMatch(/acordo ou convenção coletiva/);
      expect(daily[0].message).toMatch(/42h/);
    });

    test('regime 40h usa o teto de 40h', () => {
      const eight = at(h(8), h(17), 60);
      const day = at(h(8), h(17, 30), 60); // 8h30
      const week: Cell[] = [eight, eight, eight, eight, day, O, O]; // 40h30
      expect(ofKind(alerts(cycle(week, week5x2(), week5x2()), { config: { regime: '40h' } }), 'weekly-limit')).toHaveLength(1);
      expect(ofKind(alerts(cycle(week, week5x2(), week5x2()), { config: { regime: '42h' } }), 'weekly-limit')).toEqual([]);
    });

    test('exatamente 8h no dia não gera alerta', () => {
      const cells = withCells(std(), { 0: at(h(8), h(17), 60) });
      expect(ofKind(alerts(cells), 'daily-limit')).toEqual([]);
    });
  });

  describe('intervalo intrajornada', () => {
    test.each([
      { name: '7h30 com 30min gera alerta', hours: { start: h(8), end: h(16), breakMinutes: 30 }, expected: 1 },
      { name: '7h30 com 1h não gera', hours: { start: h(8), end: h(16, 30), breakMinutes: 60 }, expected: 0 },
      { name: '5h com 15min não gera', hours: { start: h(8), end: h(13, 15), breakMinutes: 15 }, expected: 0 },
      { name: '5h sem intervalo gera', hours: { start: h(8), end: h(13), breakMinutes: 0 }, expected: 1 },
      { name: '4h sem intervalo não gera', hours: { start: h(8), end: h(12), breakMinutes: 0 }, expected: 0 },
      { name: 'exatamente 6h com 15min não gera', hours: { start: h(8), end: h(14, 15), breakMinutes: 15 }, expected: 0 },
    ])('jornada de $name', ({ hours, expected }: { hours: WorkHours; expected: number }) => {
      const cells = withCells(std(), { 0: { status: 'work', hours } });
      const list = ofKind(alerts(cells), 'break');
      expect(list).toHaveLength(expected);
      if (expected) expect(list[0].day).toBe(0);
    });

    test('mensagem explica o mínimo', () => {
      const cells = withCells(std(), { 0: at(h(8), h(16), 30) });
      expect(ofKind(alerts(cells), 'break')[0].message).toBe('Jornada de 7h30 com intervalo de 30min (mínimo 1h)');
    });
  });

  describe('descanso semanal de 35h', () => {
    test('folga única entre saída 20:30 e entrada 5:45 (33h15) gera alerta; duas seguidas não', () => {
      // Semana 2 (índice 1): folgas na quarta e no sábado, saída 20:30 e entrada 5:45.
      const late = at(h(13), h(20, 30), 60);
      const early = at(h(5, 45), h(13, 30), 60);
      const split: Cell[] = [W, late, O, early, late, O, early];
      const list = ofKind(alerts(cycle(week5x2(), split, week5x2())), 'weekly-rest');
      expect(list).toHaveLength(1);
      expect(list[0].week).toBe(1);
      expect(list[0].message).toContain('33h15');

      const together: Cell[] = [W, W, W, early, late, O, O];
      expect(ofKind(alerts(cycle(week5x2(), together, week5x2())), 'weekly-rest')).toEqual([]);
    });

    test('descanso que só invade a semana por poucas horas não vale para ela', () => {
      // Semana 0 com sábado/domingo de folga; semana 1 só com folgas isoladas e longas jornadas.
      const late = at(h(13), h(20, 30), 60);
      const early = at(h(5, 45), h(13, 30), 60);
      const split: Cell[] = [early, W, late, O, early, late, O];
      const list = ofKind(alerts(cycle(week5x2(), split, [early, W, W, W, W, O, O])), 'weekly-rest');
      expect(list.map((a) => a.week)).toEqual([1]);
    });

    test('virada do ciclo: folga de sábado/domingo na semana 3 ainda vale', () => {
      expect(ofKind(alerts(std()), 'weekly-rest')).toEqual([]);
    });

    test('pessoa sem nenhuma jornada não gera alerta de descanso', () => {
      const cells = Array.from({ length: 21 }, () => O);
      const list = alerts(cells);
      expect(ofKind(list, 'weekly-rest')).toEqual([]);
      expect(ofKind(list, 'intershift-rest')).toEqual([]);
    });
  });

  test('evaluateRules devolve um relatório por funcionário', () => {
    const a = emp({ id: 'a' });
    const b = emp({ id: 'b', isWoman: true });
    const result = evaluateRules({
      config: baseConfig,
      employees: [a, b],
      schedule: { a: std(), b: withCells(std(), { 6: W, 13: W, 4: O, 11: O }) },
    });
    expect(result.a.alerts).toEqual([]);
    expect(result.b.alerts.map((x) => x.kind)).toEqual(['sunday-rotation']);
    expect(result.b.alerts.every((x) => x.employeeId === 'b')).toBe(true);
    expect(SUNDAYS).toContain(result.b.alerts[0].day);
  });
  test('dia de trabalho com turno inexistente gera alerta em vez de contar 0h em silêncio', () => {
    const cells = withCells(std(), { 0: { status: 'work', shiftId: 'removido' } });
    const list = ofKind(alerts(cells, { employee: { shiftId: 'manha' } }), 'no-hours');
    expect(list).toHaveLength(1);
    expect(list[0].day).toBe(0);
  });

  test('intervalo acima de 2h numa jornada de mais de 6h gera alerta; 2h exatas não', () => {
    expect(ofKind(alerts(withCells(std(), { 0: at(h(8), h(18), 150) })), 'break')).toHaveLength(1);
    expect(ofKind(alerts(withCells(std(), { 0: at(h(8), h(17), 120) })), 'break')).toHaveLength(0);
  });

  test('rodízio de domingo é checado pelas células mesmo com o domingo marcado como fechado na configuração', () => {
    const allSundays = withCells(std(), { 6: W, 13: W, 20: W, 4: O, 11: O, 18: O });
    const days = baseConfig.days.map((d, w) => (w === 6 ? { ...d, open: false } : d));
    expect(ofKind(alerts(allSundays, { config: { days } }), 'sunday-rotation')).toHaveLength(1);
    expect(ofKind(alerts(cycle([W, W, W, W, W, O, C], [W, W, W, W, W, O, C], [W, W, W, W, W, O, C]), { config: { days } }), 'sunday-rotation')).toHaveLength(0);
  });
  test('regime de 42h aceita 8h24 por dia (liminar do STF); 40h aceita só 8h', () => {
    const eight24 = withCells(std(), { 0: at(h(6, 30), h(15, 54), 60) });
    expect(ofKind(alerts(eight24, { config: { regime: '42h' } }), 'daily-limit')).toHaveLength(0);
    expect(ofKind(alerts(eight24, { config: { regime: '40h' } }), 'daily-limit')).toHaveLength(1);
    const over = withCells(std(), { 0: at(h(6, 30), h(16, 0), 60) });
    expect(ofKind(alerts(over, { config: { regime: '42h' } }), 'daily-limit')[0].message).toMatch(/8h24/);
  });

  test('cinco dias de 8h24 somam 42h e não passam do teto de 42h', () => {
    const day = at(h(6, 30), h(15, 54), 60);
    const week = [day, day, day, day, day, O, O];
    const report = evaluateEmployee(input(cycle(week, week, week), { config: { regime: '42h' } }), 'e1');
    expect(report.weeklyMinutes).toEqual([42 * 60, 42 * 60, 42 * 60]);
    expect(report.alerts.filter((a) => a.kind === 'weekly-limit' || a.kind === 'daily-limit')).toHaveLength(0);
  });
});
