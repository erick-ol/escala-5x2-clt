import { computeCoverage } from './coverage';
import { referenceDocument as exampleDocument } from '../test/fixtures';
import { generateSchedule } from './generator';
import {
  LUNCH_MAX_OFFSET,
  LUNCH_MIN_OFFSET,
  findLunchGaps,
  planLunches,
  presenceForDay,
  type LunchInput,
} from './lunch';
import { evaluateEmployee } from './rules';
import { effectiveHours, grossMinutes, isSingleShiftDay, weekdayOf } from './time';
import type { Cell, Employee, Schedule, StoreConfig } from './types';
import { CYCLE_DAYS } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

/** O exemplo com o domingo igual aos outros dias (sem turno único): estes testes não são sobre o turno único. */
function withoutSingleShift(config: StoreConfig): StoreConfig {
  return { ...config, days: config.days.map(() => ({ open: true, opensAt: 6 * 60 + 30, closesAt: 20 * 60 + 30, singleShift: false })) };
}

function baseConfig(): StoreConfig {
  return { ...withoutSingleShift(exampleDocument(new Date('2026-11-14')).config), regime: '42h' };
}

function emp(id: string, roleId: string, shiftId: string, extra: Partial<Employee> = {}): Employee {
  return { id, name: id, roleId, shiftId, isWoman: false, ...extra };
}

function allWork(employees: Employee[], cell: Cell = { status: 'work' }): Schedule {
  const s: Schedule = {};
  for (const e of employees) s[e.id] = Array.from({ length: CYCLE_DAYS }, () => ({ ...cell }));
  return s;
}

/** Mercado do exemplo com a escala gerada. `lunchFrom` troca o "Intervalo a partir de" (0 = sem preferência). */
function exampleInput(lunchFrom?: number): LunchInput {
  const doc = exampleDocument(new Date('2026-11-14'));
  const schedule = generateSchedule({ config: doc.config, employees: doc.employees });
  const { flex, extraShifts } = computeCoverage({ config: doc.config, employees: doc.employees, schedule, marks: [] });
  const config = lunchFrom === undefined ? doc.config : { ...doc.config, lunchFrom };
  return { config, employees: doc.employees, schedule, flex, extraShifts };
}

describe('planLunches', () => {
  it('planeja o intervalo entre 2h e 6h depois da entrada, terminando antes da saída, em grade de 15min', () => {
    const input = exampleInput();
    const plan = planLunches(input);
    for (const e of input.employees) {
      for (let d = 0; d < CYCLE_DAYS; d++) {
        const cell = input.schedule[e.id][d];
        const lunch = plan[e.id][d];
        if (cell.status !== 'work') {
          expect(lunch).toBeNull();
          continue;
        }
        const hours = effectiveHours(input.config, e, cell, d)!;
        expect(lunch).not.toBeNull();
        expect(lunch! % 15).toBe(0);
        expect(lunch!).toBeGreaterThanOrEqual(hours.start + LUNCH_MIN_OFFSET);
        expect(lunch!).toBeLessThanOrEqual(hours.start + LUNCH_MAX_OFFSET);
        expect(lunch! + hours.breakMinutes).toBeLessThan(hours.start + grossMinutes(hours));
      }
    }
  });

  it('é determinístico', () => {
    const input = exampleInput();
    expect(planLunches(input)).toEqual(planLunches(input));
  });

  it('sem intervalo, sem intervalo', () => {
    const config = baseConfig();
    const e = emp('a', 'caixa', 'manha', { customHours: { start: h(8), end: h(12), breakMinutes: 0 } });
    const plan = planLunches({ config, employees: [e], schedule: allWork([e]) });
    expect(plan.a.every((x) => x === null)).toBe(true);
  });

  it('dois caixas no mesmo turno com mínimo 1 nunca almoçam juntos', () => {
    const config = baseConfig();
    const employees = [emp('a', 'caixa', 'manha'), emp('b', 'caixa', 'manha')];
    const input: LunchInput = { config, employees, schedule: allWork(employees) };
    const plan = planLunches(input);
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const a = plan.a[d]!;
      const b = plan.b[d]!;
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(60);
    }
    expect(findLunchGaps(input, plan).filter((g) => g.roleId === 'caixa')).toEqual([]);
  });

  it('respeita o início de intervalo informado', () => {
    const config = baseConfig();
    const e = emp('a', 'caixa', 'manha', { customHours: { start: h(6, 30), end: h(14), breakMinutes: 60, breakStart: h(9) } });
    const input: LunchInput = { config, employees: [e], schedule: allWork([e]) };
    const plan = planLunches(input);
    expect(plan.a[0]).toBe(h(9));
    const [block] = presenceForDay(input, plan, 0);
    expect(block).toMatchObject({ breakStart: h(9), breakEnd: h(10), breakPlanned: false });
  });

  it('turno da madrugada: intervalo depois da meia-noite em minutos absolutos', () => {
    const config: StoreConfig = {
      ...baseConfig(),
      shifts: [{ id: 'noite', name: 'Noite', start: h(22), end: h(6), breakMinutes: 60 }],
      minimums: [{ roleId: 'caixa', shiftId: 'noite', perWeekday: [1, 1, 1, 1, 1, 1, 1] }],
    };
    const e = emp('a', 'caixa', 'noite');
    const input: LunchInput = { config, employees: [e], schedule: allWork([e]) };
    const plan = planLunches(input);
    const lunch = plan.a[0]!;
    expect(lunch).toBeGreaterThanOrEqual(h(22) + LUNCH_MIN_OFFSET);
    expect(lunch).toBeLessThanOrEqual(h(22) + LUNCH_MAX_OFFSET);
    expect(lunch).toBeGreaterThan(1440);
    const [block] = presenceForDay(input, plan, 0);
    expect(block.start).toBe(h(22));
    expect(block.end).toBe(h(6) + 1440);
    expect(block.breakStart).toBe(lunch);
    // Sozinho: o intervalo vira buraco exatamente no intervalo do intervalo.
    expect(findLunchGaps(input, plan).filter((g) => g.day === 0)).toEqual([
      { day: 0, roleId: 'caixa', from: lunch, to: lunch + 60, missing: 1 },
    ]);
  });

  it('explicit breakStart antes da entrada vira o dia seguinte (madrugada)', () => {
    const config = baseConfig();
    const e = emp('a', 'caixa', 'manha', { customHours: { start: h(22), end: h(6), breakMinutes: 60, breakStart: h(1) } });
    const plan = planLunches({ config, employees: [e], schedule: allWork([e]) });
    expect(plan.a[0]).toBe(h(1) + 1440);
  });

  it('planLunches com 30 pessoas × 21 dias (todas com segunda área) em menos de 200ms', () => {
    const config = baseConfig();
    const roles = ['caixa', 'balconista'];
    const shifts = ['manha', 'tarde'];
    // Pior caso: todo mundo com segunda área (cobertura de intervalo minuto a minuto).
    const employees = Array.from({ length: 30 }, (_, i) =>
      emp(`e${i}`, roles[i % 2], shifts[Math.floor(i / 2) % 2], { secondaryRoleId: roles[(i + 1) % 2] }),
    );
    const input: LunchInput = { config, employees, schedule: allWork(employees) };
    planLunches(input); // aquecimento
    const t0 = performance.now();
    planLunches(input);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('findLunchGaps', () => {
  it('um balconista sozinho com mínimo 1: o buraco é exatamente o intervalo', () => {
    const config = baseConfig();
    const e = emp('rosa', 'balconista', 'manha');
    const input: LunchInput = { config, employees: [e], schedule: allWork([e]) };
    const plan = planLunches(input);
    const gaps = findLunchGaps(input, plan).filter((g) => g.day === 2);
    const lunch = plan.rosa[2]!;
    expect(gaps).toEqual([{ day: 2, roleId: 'balconista', from: lunch, to: lunch + 60, missing: 1 }]);
  });

  it('não acusa buraco que não foi causado por intervalo', () => {
    const config = baseConfig();
    // Ninguém de balconista: falta o dia todo, mas não por intervalo.
    const e = emp('a', 'caixa', 'manha');
    const f = emp('b', 'caixa', 'manha');
    const input: LunchInput = { config, employees: [e, f], schedule: allWork([e, f]) };
    expect(findLunchGaps(input, planLunches(input))).toEqual([]);
  });

  // Sem preferência de horário (lunchFrom 0): com "a partir de 11:30", três intervalos de 1h da manhã não cabem
  // entre 11:30 e 13:30 e o buraco vira inevitável (ver "horário preferido do intervalo").
  it('mercado do exemplo sem preferência de horário: sem buraco de caixa de manhã quando os dois caixas da manhã trabalham', () => {
    const input = exampleInput(0);
    const plan = planLunches(input);
    const gaps = findLunchGaps(input, plan);
    const flexed = (id: string, d: number) => input.flex!.some((f) => f.employeeId === id && f.day === d);
    let checked = 0;
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const works = (id: string) => input.schedule[id][d].status === 'work' && !flexed(id, d);
      if (works('andreza') && works('richard')) {
        checked++;
        expect(gaps.filter((g) => g.day === d && g.roleId === 'caixa' && g.from < h(14))).toEqual([]);
      }
      if (works('joao') && works('lucas')) {
        checked++;
        expect(gaps.filter((g) => g.day === d && g.roleId === 'caixa' && g.to > h(14))).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('presenceForDay', () => {
  it('traz a função do dia, incluindo a segunda área', () => {
    const input = exampleInput();
    const plan = planLunches(input);
    // Primeiro dia na segunda área fora do domingo de turno único (lá o intervalo é de 15min).
    const f = input.flex!.find((x) => !isSingleShiftDay(input.config, weekdayOf(x.day)))!;
    expect(f).toBeDefined();
    const blocks = presenceForDay(input, plan, f.day);
    const block = blocks.find((b) => b.employeeId === f.employeeId)!;
    expect(block.roleId).toBe(f.roleId);
    expect(block.shiftId).toBe(f.shiftId);
    expect(block.breakPlanned).toBe(true);
    expect(block.breakEnd! - block.breakStart!).toBe(60);
    // Quem não está na segunda área nesse dia conta na principal; quem está conta na função coberta.
    const flexToday = new Map(input.flex!.filter((x) => x.day === f.day).map((x) => [x.employeeId, x.roleId]));
    for (const b of blocks) {
      const e = input.employees.find((x) => x.id === b.employeeId)!;
      expect(b.roleId).toBe(flexToday.get(b.employeeId) ?? e.roleId);
    }
  });

  it('jornada extra conta como presença na função coberta', () => {
    const config = baseConfig();
    const e = emp('a', 'caixa', 'manha');
    const schedule: Schedule = { a: Array.from({ length: CYCLE_DAYS }, (): Cell => ({ status: 'off' })) };
    const input: LunchInput = {
      config,
      employees: [e],
      schedule,
      extraShifts: [{ employeeId: 'a', day: 3, shiftId: 'tarde', roleId: 'balconista', hours: { start: h(13), end: h(20, 30), breakMinutes: 60 } }],
    };
    const plan = planLunches(input);
    const blocks = presenceForDay(input, plan, 3);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ employeeId: 'a', roleId: 'balconista', shiftId: 'tarde', start: h(13), breakPlanned: true });
    expect(blocks[0].breakStart).not.toBeNull();
  });
});

describe('regra break-late', () => {
  const config = baseConfig();
  const at = (breakStart: number | undefined, end = h(15)): Cell => ({
    status: 'work',
    hours: { start: h(7), end, breakMinutes: 60, ...(breakStart !== undefined ? { breakStart } : {}) },
  });
  const run = (cell: Cell, lunchPlan?: Record<string, (number | null)[]>) => {
    const e = emp('e1', 'caixa', 'manha');
    const cells = Array.from({ length: CYCLE_DAYS }, (_, d): Cell => (d % 7 < 5 ? cell : { status: 'off' }));
    return evaluateEmployee({ config, employees: [e], schedule: { e1: cells }, lunchPlan }, 'e1').alerts.filter(
      (a) => a.kind === 'break-late',
    );
  };

  it('intervalo às 6h15 de trabalho: alerta', () => {
    const list = run(at(h(13, 15)));
    expect(list).toHaveLength(15);
    expect(list[0].message).toBe('Intervalo começa depois de 6h de trabalho (máximo 6h antes da pausa)');
  });

  it('intervalo às 6h de trabalho: sem alerta', () => {
    expect(run(at(h(13)))).toEqual([]);
  });

  it('jornada de até 6h: sem alerta', () => {
    expect(run({ status: 'work', hours: { start: h(7), end: h(13, 15), breakMinutes: 15, breakStart: h(13) } })).toEqual([]);
  });

  it('sem início informado e sem plano: não confere', () => {
    expect(run(at(undefined))).toEqual([]);
  });

  it('usa o intervalo planejado quando há plano', () => {
    const late = Array.from({ length: CYCLE_DAYS }, () => h(13, 15));
    expect(run(at(undefined), { e1: late })).toHaveLength(15);
    const ok = Array.from({ length: CYCLE_DAYS }, () => h(11));
    expect(run(at(undefined), { e1: ok })).toEqual([]);
  });

  it('o plano real nunca gera alerta', () => {
    const input = exampleInput();
    const plan = planLunches(input);
    for (const e of input.employees) {
      const alerts = evaluateEmployee({ ...input, lunchPlan: plan }, e.id).alerts;
      expect(alerts.filter((a) => a.kind === 'break-late')).toEqual([]);
    }
  });
});

describe('cobertura de intervalo pela segunda área', () => {
  const morningTeam = () => [
    emp('andreza', 'caixa', 'manha', { secondaryRoleId: 'balconista' }),
    emp('richard', 'caixa', 'manha'),
    emp('rosa', 'balconista', 'manha', { customHours: { start: h(5, 45), end: h(13, 30), breakMinutes: 60 } }),
  ];
  const onlyMorning = (): StoreConfig => ({
    ...baseConfig(),
    minimums: baseConfig().minimums.filter((m) => m.shiftId === 'manha'),
  });

  // Sem preferência de horário (lunchFrom 0); com 11:30, ver "horário preferido do intervalo".
  it('mercado do exemplo sem preferência de horário: Andreza cobre o intervalo da Rosa quando Andreza e Richard trabalham de manhã', () => {
    const input = exampleInput(0);
    const plan = planLunches(input);
    const gaps = findLunchGaps(input, plan);
    const flexed = (id: string, d: number) => input.flex!.some((f) => f.employeeId === id && f.day === d);
    let checked = 0;
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const works = (id: string) => input.schedule[id][d].status === 'work' && !flexed(id, d);
      if (!(works('andreza') && works('richard') && works('rosa'))) continue;
      checked++;
      const rosaLunch = plan.rosa[d]!;
      expect(gaps.filter((g) => g.day === d && g.roleId === 'balconista' && g.from < rosaLunch + 60 && g.to > rosaLunch)).toEqual([]);
      const andreza = presenceForDay(input, plan, d).find((b) => b.employeeId === 'andreza')!;
      expect(andreza.lunchCovers).toEqual([{ from: rosaLunch, to: rosaLunch + 60, roleId: 'balconista', forEmployeeId: 'rosa' }]);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('sem cobertura quando a principal de quem cobriria ficaria abaixo do mínimo', () => {
    const [andreza, , rosa] = morningTeam();
    const employees = [andreza, rosa];
    const input: LunchInput = { config: onlyMorning(), employees, schedule: allWork(employees) };
    const plan = planLunches(input);
    const lunch = plan.rosa[0]!;
    expect(findLunchGaps(input, plan).filter((g) => g.day === 0 && g.roleId === 'balconista')).toEqual([
      { day: 0, roleId: 'balconista', from: lunch, to: lunch + 60, missing: 1 },
    ]);
    expect(presenceForDay(input, plan, 0).find((b) => b.employeeId === 'andreza')!.lunchCovers).toBeUndefined();
  });

  // Sem preferência de horário (lunchFrom 0): a partir de 11:30, os três intervalos não cabem sem sobrepor.
  it('o planejador não põe o intervalo de quem cobre (nem do colega que garante a sobra) junto com o da Rosa', () => {
    const employees = morningTeam();
    const input: LunchInput = { config: { ...onlyMorning(), lunchFrom: 0 }, employees, schedule: allWork(employees) };
    const plan = planLunches(input);
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const rosa = plan.rosa[d]!;
      for (const id of ['andreza', 'richard']) {
        const other = plan[id][d]!;
        expect(other + 60 <= rosa || other >= rosa + 60).toBe(true);
      }
    }
    expect(findLunchGaps(input, plan)).toEqual([]);
  });

  it('quem já está na segunda área no turno não cobre intervalo', () => {
    const employees = morningTeam();
    const input: LunchInput = {
      config: onlyMorning(),
      employees,
      schedule: allWork(employees),
      flex: [{ day: 0, shiftId: 'manha', roleId: 'balconista', employeeId: 'andreza' }],
    };
    const plan = planLunches(input);
    const blocks = presenceForDay(input, plan, 0);
    expect(blocks.find((b) => b.employeeId === 'andreza')).toMatchObject({ roleId: 'balconista' });
    expect(blocks.every((b) => b.lunchCovers === undefined)).toBe(true);
  });

  it('trechos do mesmo dia e função saem juntados, sem vizinhos', () => {
    const input = exampleInput();
    const gaps = findLunchGaps(input, planLunches(input));
    for (let i = 1; i < gaps.length; i++) {
      const a = gaps[i - 1];
      const b = gaps[i];
      if (a.day === b.day && a.roleId === b.roleId) expect(b.from).toBeGreaterThan(a.to);
    }
  });
});

describe('horário preferido do intervalo (lunchFrom)', () => {
  /** Algum início da grade de 15min dentro da janela legal fica em ≥ `from`? */
  const hasLegalAfter = (start: number, end: number, b: number, from: number) => {
    const first = Math.ceil((start + LUNCH_MIN_OFFSET) / 15) * 15;
    const last = Math.min(start + LUNCH_MAX_OFFSET, end - b - 1);
    return Math.max(first, Math.ceil(from / 15) * 15) <= last;
  };

  it('o exemplo vem com 11:30', () => {
    expect(exampleDocument(new Date('2026-11-14')).config.lunchFrom).toBe(h(11, 30));
  });

  it('mercado do exemplo: intervalo na janela legal, a maioria a partir de 11:30, sem mais falta que sem preferência', () => {
    const input = exampleInput();
    const plan = planLunches(input);
    let withLate = 0;
    let late = 0;
    for (const e of input.employees) {
      for (let d = 0; d < CYCLE_DAYS; d++) {
        const cell = input.schedule[e.id][d];
        if (cell.status !== 'work') continue;
        const hours = effectiveHours(input.config, e, cell, d)!;
        const lunch = plan[e.id][d]!;
        const end = hours.start + grossMinutes(hours);
        expect(lunch).toBeGreaterThanOrEqual(hours.start + LUNCH_MIN_OFFSET);
        expect(lunch).toBeLessThanOrEqual(hours.start + LUNCH_MAX_OFFSET);
        expect(lunch + hours.breakMinutes).toBeLessThan(end);
        if (hasLegalAfter(hours.start, end, hours.breakMinutes, h(11, 30))) {
          withLate++;
          if (lunch >= h(11, 30)) late++;
        }
      }
    }
    expect(withLate).toBeGreaterThan(0);
    expect(late / withLate).toBeGreaterThan(0.8);
    // Antecipar só quando evita falta: a falta total não passa da de quem não tem preferência de horário.
    const minutes = (lunchFrom: number) => {
      const inp = exampleInput(lunchFrom);
      return findLunchGaps(inp, planLunches(inp)).reduce((sum, g) => sum + (g.to - g.from), 0);
    };
    expect(minutes(h(11, 30))).toBeLessThanOrEqual(minutes(0));
  });

  it('antecipa o intervalo antes de 11:30 só quando evita falta', () => {
    const config: StoreConfig = {
      ...baseConfig(),
      roles: [{ id: 'caixa', name: 'Caixa' }],
      minimums: [
        { roleId: 'caixa', shiftId: 'manha', perWeekday: [2, 2, 2, 2, 2, 2, 2] },
        { roleId: 'caixa', shiftId: 'tarde', perWeekday: [0, 0, 0, 0, 0, 0, 0] },
      ],
    };
    // 2 no caixa de manhã com mínimo 2: qualquer intervalo abre falta, então nada a ganhar antecipando.
    const two = ['a', 'b'].map((id) => emp(id, 'caixa', 'manha'));
    const plan2 = planLunches({ config, employees: two, schedule: allWork(two) });
    for (const e of two) expect(plan2[e.id][1]).toBeGreaterThanOrEqual(h(11, 30));
    // 3 no caixa de manhã com mínimo 2: três intervalos de 1h não cabem entre 11:30 e 13:30 (limite das 6h)
    // sem sobrepor; um é antecipado e ninguém fica faltando.
    const three = ['a', 'b', 'c'].map((id) => emp(id, 'caixa', 'manha'));
    const input = { config, employees: three, schedule: allWork(three) };
    const plan3 = planLunches(input);
    const starts = three.map((e) => plan3[e.id][1]!).sort((x, y) => x - y);
    expect(starts.filter((s) => s < h(11, 30))).toHaveLength(1);
    expect(findLunchGaps(input, plan3).filter((g) => g.day === 1)).toEqual([]);
  });

  it('a tarde segue na janela legal (a partir de 11:30 sem esforço)', () => {
    const input = exampleInput();
    const plan = planLunches(input);
    for (const id of ['pedro', 'lucas', 'joao']) {
      const e = input.employees.find((x) => x.id === id)!;
      for (let d = 0; d < CYCLE_DAYS; d++) {
        const cell = input.schedule[id][d];
        if (cell.status !== 'work' || isSingleShiftDay(input.config, weekdayOf(d))) continue;
        const hours = effectiveHours(input.config, e, cell, d)!;
        expect(hours.start).toBeGreaterThanOrEqual(h(13));
        expect(plan[id][d]).toBeGreaterThanOrEqual(hours.start + LUNCH_MIN_OFFSET);
        expect(plan[id][d]).toBeLessThanOrEqual(hours.start + LUNCH_MAX_OFFSET);
      }
    }
  });

  it('jornada da tarde sozinha: o mesmo intervalo com ou sem preferência', () => {
    const e = emp('pedro', 'balconista', 'tarde');
    const config = baseConfig();
    const with1130 = planLunches({ config, employees: [e], schedule: allWork([e]) });
    const without = planLunches({ config: { ...config, lunchFrom: 0 }, employees: [e], schedule: allWork([e]) });
    expect(with1130).toEqual(without);
  });

  it('sem início legal a partir de 11:30 (06:00–10:00): o mais tarde possível', () => {
    const e = emp('a', 'caixa', 'manha', { customHours: { start: h(6), end: h(10), breakMinutes: 15 } });
    const plan = planLunches({ config: baseConfig(), employees: [e], schedule: allWork([e]) });
    // Janela legal: 08:00 até 09:44 (terminar antes das 10:00); na grade, o último início é 09:30.
    expect(plan.a[1]).toBe(h(9, 30));
  });

  it('"Intervalo a partir de" 12:00 empurra os intervalos da manhã; a regra das 6h continua valendo', () => {
    const a = emp('a', 'caixa', 'manha');
    const rosa = emp('rosa', 'balconista', 'manha', { customHours: { start: h(5, 45), end: h(13, 30), breakMinutes: 60 } });
    const employees = [a, rosa];
    const at = (lunchFrom: number) => planLunches({ config: { ...baseConfig(), lunchFrom }, employees, schedule: allWork(employees) });
    expect(at(h(11, 30)).a[1]).toBe(h(11, 30));
    expect(at(h(12)).a[1]).toBe(h(12));
    // Rosa precisa começar até 11:45 (6h depois das 05:45): fica com o mais perto de 12:00.
    expect(at(h(12)).rosa[1]).toBe(h(11, 45));
  });

  it('jornada da madrugada: a preferência não muda nada', () => {
    const config: StoreConfig = {
      ...baseConfig(),
      shifts: [{ id: 'noite', name: 'Noite', start: h(22), end: h(6), breakMinutes: 60 }],
      minimums: [],
    };
    const e = emp('n', 'caixa', 'noite');
    const plan = (lunchFrom: number) => planLunches({ config: { ...config, lunchFrom }, employees: [e], schedule: allWork([e]) });
    expect(plan(h(11, 30))).toEqual(plan(0));
    expect(plan(h(11, 30)).n[1]!).toBeGreaterThanOrEqual(24 * 60);
  });

  it('sem lunchFrom (dados antigos): vale 11:30', () => {
    const { lunchFrom: _drop, ...config } = baseConfig();
    void _drop;
    const e = emp('a', 'caixa', 'manha');
    expect(planLunches({ config, employees: [e], schedule: allWork([e]) }).a[1]).toBe(h(11, 30));
  });

  it('mercado do exemplo: com 11:30 os buracos de intervalo da manhã ficam a partir de 11:30', () => {
    const input = exampleInput();
    const gaps = findLunchGaps(input, planLunches(input));
    for (const g of gaps) expect(g.from).toBeGreaterThanOrEqual(h(11, 30));
  });
});
