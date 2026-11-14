import { computeCoverage } from './coverage';
import { exampleDocument } from './example';
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
import { effectiveHours, grossMinutes } from './time';
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

function exampleInput(): LunchInput {
  const doc = exampleDocument(new Date('2026-11-14'));
  const schedule = generateSchedule({ config: doc.config, employees: doc.employees });
  const { flex, extraShifts } = computeCoverage({ config: doc.config, employees: doc.employees, schedule, marks: [] });
  return { config: doc.config, employees: doc.employees, schedule, flex, extraShifts };
}

describe('planLunches', () => {
  it('planeja o almoço entre 2h e 6h depois da entrada, terminando antes da saída, em grade de 15min', () => {
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

  it('sem intervalo, sem almoço', () => {
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

  it('respeita o início de almoço informado', () => {
    const config = baseConfig();
    const e = emp('a', 'caixa', 'manha', { customHours: { start: h(6, 30), end: h(14), breakMinutes: 60, breakStart: h(9) } });
    const input: LunchInput = { config, employees: [e], schedule: allWork([e]) };
    const plan = planLunches(input);
    expect(plan.a[0]).toBe(h(9));
    const [block] = presenceForDay(input, plan, 0);
    expect(block).toMatchObject({ breakStart: h(9), breakEnd: h(10), breakPlanned: false });
  });

  it('turno da madrugada: almoço depois da meia-noite em minutos absolutos', () => {
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
    // Sozinho: o almoço vira buraco exatamente no intervalo do almoço.
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
    // Pior caso: todo mundo com segunda área (cobertura de almoço minuto a minuto).
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
  it('um balconista sozinho com mínimo 1: o buraco é exatamente o almoço', () => {
    const config = baseConfig();
    const e = emp('rosa', 'balconista', 'manha');
    const input: LunchInput = { config, employees: [e], schedule: allWork([e]) };
    const plan = planLunches(input);
    const gaps = findLunchGaps(input, plan).filter((g) => g.day === 2);
    const lunch = plan.rosa[2]!;
    expect(gaps).toEqual([{ day: 2, roleId: 'balconista', from: lunch, to: lunch + 60, missing: 1 }]);
  });

  it('não acusa buraco que não foi causado por almoço', () => {
    const config = baseConfig();
    // Ninguém de balconista: falta o dia todo, mas não por almoço.
    const e = emp('a', 'caixa', 'manha');
    const f = emp('b', 'caixa', 'manha');
    const input: LunchInput = { config, employees: [e, f], schedule: allWork([e, f]) };
    expect(findLunchGaps(input, planLunches(input))).toEqual([]);
  });

  it('mercado do exemplo: sem buraco de caixa de manhã quando os dois caixas da manhã trabalham', () => {
    const input = exampleInput();
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
    const f = input.flex![0];
    expect(f).toBeDefined();
    const blocks = presenceForDay(input, plan, f.day);
    const block = blocks.find((b) => b.employeeId === f.employeeId)!;
    expect(block.roleId).toBe(f.roleId);
    expect(block.shiftId).toBe(f.shiftId);
    expect(block.breakPlanned).toBe(true);
    expect(block.breakEnd! - block.breakStart!).toBe(60);
    // Quem não está na segunda área conta na principal.
    for (const b of blocks) {
      const e = input.employees.find((x) => x.id === b.employeeId)!;
      if (b.employeeId !== f.employeeId) expect(b.roleId).toBe(e.roleId);
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

  it('almoço às 6h15 de trabalho: alerta', () => {
    const list = run(at(h(13, 15)));
    expect(list).toHaveLength(15);
    expect(list[0].message).toBe('Almoço começa depois de 6h de trabalho (máximo 6h antes da pausa)');
  });

  it('almoço às 6h de trabalho: sem alerta', () => {
    expect(run(at(h(13)))).toEqual([]);
  });

  it('jornada de até 6h: sem alerta', () => {
    expect(run({ status: 'work', hours: { start: h(7), end: h(13, 15), breakMinutes: 15, breakStart: h(13) } })).toEqual([]);
  });

  it('sem início informado e sem plano: não confere', () => {
    expect(run(at(undefined))).toEqual([]);
  });

  it('usa o almoço planejado quando há plano', () => {
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

describe('cobertura de almoço pela segunda área', () => {
  const morningTeam = () => [
    emp('andreza', 'caixa', 'manha', { secondaryRoleId: 'balconista' }),
    emp('richard', 'caixa', 'manha'),
    emp('rosa', 'balconista', 'manha', { customHours: { start: h(5, 45), end: h(13, 30), breakMinutes: 60 } }),
  ];
  const onlyMorning = (): StoreConfig => ({
    ...baseConfig(),
    minimums: baseConfig().minimums.filter((m) => m.shiftId === 'manha'),
  });

  it('mercado do exemplo: Andreza cobre o almoço da Rosa quando Andreza e Richard trabalham de manhã', () => {
    const input = exampleInput();
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

  it('o planejador não põe o almoço de quem cobre (nem do colega que garante a sobra) junto com o da Rosa', () => {
    const employees = morningTeam();
    const input: LunchInput = { config: onlyMorning(), employees, schedule: allWork(employees) };
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

  it('quem já está na segunda área no turno não cobre almoço', () => {
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
