import { computeCoverage, countGaps, gapKey, type CoverageInput } from './coverage';
import { exampleDocument } from './example';
import type { Cell, CoverageMark, Employee, Schedule, StoreConfig } from './types';
import { CYCLE_DAYS } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

// Dias do ciclo: 0 = segunda da semana 1. Terça = 1, quarta = 2, quinta = 3, domingo = 6.
const TER = [1, 8, 15];
const QUI = [3, 10, 17];

function baseConfig(): StoreConfig {
  return exampleDocument(new Date('2026-12-01')).config;
}

function emp(id: string, roleId: string, shiftId: string): Employee {
  return { id, name: id[0].toUpperCase() + id.slice(1), roleId, shiftId, isWoman: false };
}

/** Todos trabalhando todos os dias, exceto os dias em `off`. */
function scheduleFor(employees: Employee[], off: Record<string, number[]> = {}): Schedule {
  const s: Schedule = {};
  for (const e of employees) {
    s[e.id] = Array.from({ length: CYCLE_DAYS }, (_, d): Cell => ({
      status: off[e.id]?.includes(d) ? 'off' : 'work',
    }));
  }
  return s;
}

/** Equipe mínima: 1 de cada função em cada turno. */
function fullTeam(): Employee[] {
  return [
    emp('andreza', 'caixa', 'manha'),
    emp('rosa', 'balconista', 'manha'),
    emp('joao', 'caixa', 'tarde'),
    emp('pedro', 'balconista', 'tarde'),
  ];
}

function input(partial: Partial<CoverageInput> & { employees: Employee[] }): CoverageInput {
  return {
    config: partial.config ?? baseConfig(),
    employees: partial.employees,
    schedule: partial.schedule ?? scheduleFor(partial.employees),
    marks: partial.marks ?? [],
  };
}

const ownerMark = (day: number, shiftId: string, roleId: string, slot = 0): CoverageMark => ({
  day,
  shiftId,
  roleId,
  slot,
  coveredBy: { kind: 'owner' },
});

const empMark = (employeeId: string, day: number, shiftId: string, roleId: string, slot = 0): CoverageMark => ({
  day,
  shiftId,
  roleId,
  slot,
  coveredBy: { kind: 'employee', employeeId },
});

describe('cobertura', () => {
  test('equipe que cobre tudo gera "Tudo coberto"', () => {
    const employees = fullTeam();
    const r = computeCoverage(input({ employees }));
    expect(r.gaps).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.headline).toBe('Tudo coberto');
    expect(countGaps(baseConfig(), employees, scheduleFor(employees))).toBe(0);
  });

  test('mínimo 1 balconista à tarde com o único balconista de folga gera 1 buraco naquele dia', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.gaps).toEqual([{ day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0 }]);
    expect(countGaps(baseConfig(), employees, schedule)).toBe(1);
  });

  test('conta pelo turno atribuído no dia, não pelo cadastro (KTD8)', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees);
    schedule.pedro[4] = { status: 'work', shiftId: 'manha', hours: { start: h(13), end: h(20), breakMinutes: 60 } };
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.gaps).toEqual([{ day: 4, shiftId: 'tarde', roleId: 'balconista', slot: 0 }]);
  });

  test('AE3: buraco marcado "coberto por mim/família" sai do resumo e não gera horas', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { andreza: [6] });
    const mark = ownerMark(6, 'manha', 'caixa');
    const r = computeCoverage(input({ employees, schedule, marks: [mark] }));
    expect(r.gaps).toEqual([]);
    expect(r.covered).toEqual([{ day: 6, shiftId: 'manha', roleId: 'caixa', slot: 0, mark }]);
    expect(r.extraShifts).toEqual([]);
    expect(r.orphanMarks).toEqual([]);
    expect(r.headline).toBe('Tudo coberto');
  });

  test('AE3b: buraco marcado "coberto por João" (de folga) vira jornada extra do João com horário padrão do turno', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2], joao: [2] });
    // João de folga deixa também buraco de caixa; marcamos só o balcão.
    const mark = empMark('joao', 2, 'tarde', 'balconista');
    const r = computeCoverage(input({ employees, schedule, marks: [mark] }));
    expect(r.covered.map(gapKey)).toEqual([gapKey(mark)]);
    expect(r.gaps).toEqual([{ day: 2, shiftId: 'tarde', roleId: 'caixa', slot: 0 }]);
    expect(r.extraShifts).toEqual([
      { employeeId: 'joao', day: 2, shiftId: 'tarde', hours: { start: h(13), end: h(20, 30), breakMinutes: 60 } },
    ]);
  });

  test('coberto por quem trabalha em outro turno soma jornada extra (KTD16)', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2] });
    const mark = empMark('rosa', 2, 'tarde', 'balconista');
    const r = computeCoverage(input({ employees, schedule, marks: [mark] }));
    expect(r.gaps).toEqual([]);
    expect(r.extraShifts).toEqual([
      { employeeId: 'rosa', day: 2, shiftId: 'tarde', hours: { start: h(13), end: h(20, 30), breakMinutes: 60 } },
    ]);
  });

  test('João, já caixa à tarde, cobrindo o balcão à tarde deixa de contar como caixa e abre buraco de caixa', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2] });
    const mark = empMark('joao', 2, 'tarde', 'balconista');
    const r = computeCoverage(input({ employees, schedule, marks: [mark] }));
    expect(r.covered.map(gapKey)).toEqual([gapKey(mark)]);
    expect(r.gaps).toEqual([{ day: 2, shiftId: 'tarde', roleId: 'caixa', slot: 0 }]);
    expect(r.extraShifts).toEqual([]);
    expect(r.orphanMarks).toEqual([]);
  });

  test('marcação num buraco que deixou de existir vira órfã; se o buraco reaparecer, volta sem marcação', () => {
    const employees = fullTeam();
    const mark = ownerMark(2, 'tarde', 'balconista');
    // Edição: Pedro passa a trabalhar na quarta, o buraco some.
    const afterEdit = computeCoverage(input({ employees, schedule: scheduleFor(employees), marks: [mark] }));
    expect(afterEdit.orphanMarks).toEqual([mark]);
    expect(afterEdit.covered).toEqual([]);
    // O store remove as órfãs; o buraco reaparece numa edição seguinte.
    const remaining = [mark].filter((m) => !afterEdit.orphanMarks.includes(m));
    const again = computeCoverage(
      input({ employees, schedule: scheduleFor(employees, { pedro: [2] }), marks: remaining }),
    );
    expect(again.gaps).toEqual([{ day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0 }]);
    expect(again.covered).toEqual([]);
  });

  test('mínimo 2 com 2 faltando no mesmo turno: cada vaga pode ser marcada separadamente', () => {
    const config = baseConfig();
    config.minimums = [{ roleId: 'caixa', shiftId: 'manha', perWeekday: [2, 2, 2, 2, 2, 2, 2] }];
    const employees = [emp('andreza', 'caixa', 'manha'), emp('richard', 'caixa', 'manha')];
    const schedule = scheduleFor(employees, { andreza: [0], richard: [0] });

    const none = computeCoverage(input({ config, employees, schedule }));
    expect(none.gaps.map(gapKey)).toEqual([
      gapKey({ day: 0, shiftId: 'manha', roleId: 'caixa', slot: 0 }),
      gapKey({ day: 0, shiftId: 'manha', roleId: 'caixa', slot: 1 }),
    ]);

    const one = computeCoverage(input({ config, employees, schedule, marks: [ownerMark(0, 'manha', 'caixa', 1)] }));
    expect(one.gaps).toEqual([{ day: 0, shiftId: 'manha', roleId: 'caixa', slot: 0 }]);
    expect(one.covered.map((c) => c.slot)).toEqual([1]);

    const both = computeCoverage(
      input({
        config,
        employees,
        schedule,
        marks: [ownerMark(0, 'manha', 'caixa', 0), ownerMark(0, 'manha', 'caixa', 1)],
      }),
    );
    expect(both.gaps).toEqual([]);
    expect(both.covered).toHaveLength(2);
  });

  test('duas marcações na mesma vaga: a primeira vale, a segunda é órfã', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2] });
    const a = ownerMark(2, 'tarde', 'balconista');
    const b = empMark('rosa', 2, 'tarde', 'balconista');
    const r = computeCoverage(input({ employees, schedule, marks: [a, b] }));
    expect(r.covered.map((c) => c.mark)).toEqual([a]);
    expect(r.orphanMarks).toEqual([b]);
    expect(r.extraShifts).toEqual([]);
  });

  test('buracos de balconista à tarde em terça e quinta nas 3 semanas viram um único item no resumo', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [...TER, ...QUI] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.gaps).toHaveLength(6);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ roleId: 'balconista', shiftId: 'tarde', weekdays: [1, 3], perWeek: 2 });
    expect(r.summary[0].text).toBe('Balconista à tarde: terça e quinta');
    expect(r.headline).toBe('2 buracos por semana: balconista à tarde, terça e quinta');
  });

  test('um buraco por semana usa o singular', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { andreza: [6, 13, 20] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.summary[0].perWeek).toBe(1);
    expect(r.headline).toBe('1 buraco por semana: caixa de manhã, domingo');
  });

  test('mínimo diferente no domingo é respeitado', () => {
    const config = baseConfig();
    config.minimums = [{ roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 2] }];
    const employees = [emp('andreza', 'caixa', 'manha')];
    const r = computeCoverage(input({ config, employees }));
    expect(r.gaps.map((g) => g.day)).toEqual([6, 13, 20]);
    expect(countGaps(config, employees, scheduleFor(employees))).toBe(3);
  });

  test('dia com loja fechada não exige mínimo e marcações nele são órfãs', () => {
    const config = baseConfig();
    config.days[6] = { ...config.days[6], open: false };
    const employees = fullTeam();
    const schedule = scheduleFor(employees);
    for (const e of employees) for (const d of [6, 13, 20]) schedule[e.id][d] = { status: 'closed' };
    const mark = ownerMark(6, 'manha', 'caixa');
    const r = computeCoverage(input({ config, employees, schedule, marks: [mark] }));
    expect(r.gaps).toEqual([]);
    expect(r.orphanMarks).toEqual([mark]);
    expect(countGaps(config, employees, schedule)).toBe(0);
  });

  test('marcação de funcionário inexistente é órfã e o buraco continua', () => {
    const employees = fullTeam();
    const schedule = scheduleFor(employees, { pedro: [2] });
    const mark = empMark('fantasma', 2, 'tarde', 'balconista');
    const r = computeCoverage(input({ employees, schedule, marks: [mark] }));
    expect(r.orphanMarks).toEqual([mark]);
    expect(r.gaps).toHaveLength(1);
    expect(r.extraShifts).toEqual([]);
  });

  test('marcação em turno ou função que não existe mais é órfã', () => {
    const employees = fullTeam();
    const marks = [ownerMark(2, 'noite', 'caixa'), ownerMark(2, 'tarde', 'repositor')];
    const r = computeCoverage(input({ employees, marks }));
    expect(r.orphanMarks).toEqual(marks);
  });

  test('exemplo do mercado com todos trabalhando cobre tudo', () => {
    const doc = exampleDocument(new Date('2026-12-01'));
    const r = computeCoverage({
      config: doc.config,
      employees: doc.employees,
      schedule: scheduleFor(doc.employees),
      marks: [],
    });
    expect(r.headline).toBe('Tudo coberto');
  });

  test('gapKey é estável e distingue vagas', () => {
    const a = gapKey({ day: 1, shiftId: 'tarde', roleId: 'caixa', slot: 0 });
    expect(a).toBe(gapKey({ day: 1, shiftId: 'tarde', roleId: 'caixa', slot: 0 }));
    expect(a).not.toBe(gapKey({ day: 1, shiftId: 'tarde', roleId: 'caixa', slot: 1 }));
  });
});

describe('segunda área (secondaryRoleId)', () => {
  /** Manhã: 2 caixas (Andreza cobre balcão), 1 balconista. */
  function flexTeam(): Employee[] {
    return [
      { ...emp('andreza', 'caixa', 'manha'), secondaryRoleId: 'balconista' },
      emp('richard', 'caixa', 'manha'),
      emp('rosa', 'balconista', 'manha'),
      emp('joao', 'caixa', 'tarde'),
      emp('pedro', 'balconista', 'tarde'),
    ];
  }

  test('caixa com sobra cobre o balcão quando a balconista folga', () => {
    const employees = flexTeam();
    const schedule = scheduleFor(employees, { rosa: [2] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.gaps).toEqual([]);
    expect(r.flex).toEqual([{ day: 2, shiftId: 'manha', roleId: 'balconista', employeeId: 'andreza' }]);
    expect(countGaps(baseConfig(), employees, schedule)).toBe(0);
  });

  test('sem flex quando a função principal ficaria descoberta', () => {
    const employees = flexTeam();
    const schedule = scheduleFor(employees, { rosa: [2], richard: [2] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.flex).toEqual([]);
    expect(r.gaps).toEqual([{ day: 2, shiftId: 'manha', roleId: 'balconista', slot: 0 }]);
    expect(countGaps(baseConfig(), employees, schedule)).toBe(1);
  });

  test('só no mesmo turno e dia; quem está de folga não cobre', () => {
    const employees = flexTeam();
    const schedule = scheduleFor(employees, { pedro: [3], andreza: [4], rosa: [4] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.flex).toEqual([]);
    expect(r.gaps.map(gapKey).sort()).toEqual(
      [
        gapKey({ day: 3, shiftId: 'tarde', roleId: 'balconista', slot: 0 }),
        gapKey({ day: 4, shiftId: 'manha', roleId: 'balconista', slot: 0 }),
      ].sort(),
    );
    expect(countGaps(baseConfig(), employees, schedule)).toBe(2);
  });

  test('segunda área igual à principal ou função inexistente é ignorada', () => {
    const employees = [
      { ...emp('andreza', 'caixa', 'manha'), secondaryRoleId: 'caixa' },
      { ...emp('richard', 'caixa', 'manha'), secondaryRoleId: 'repositor' },
      emp('rosa', 'balconista', 'manha'),
    ];
    const schedule = scheduleFor(employees, { rosa: [2] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.flex).toEqual([]);
    expect(r.gaps.filter((g) => g.shiftId === 'manha')).toEqual([{ day: 2, shiftId: 'manha', roleId: 'balconista', slot: 0 }]);
  });

  test('determinístico pela ordem da equipe: o primeiro elegível cobre', () => {
    const employees = [
      emp('richard', 'caixa', 'manha'),
      { ...emp('andreza', 'caixa', 'manha'), secondaryRoleId: 'balconista' },
      { ...emp('bia', 'caixa', 'manha'), secondaryRoleId: 'balconista' },
      emp('rosa', 'balconista', 'manha'),
    ];
    const schedule = scheduleFor(employees, { rosa: [5] });
    const r = computeCoverage(input({ employees, schedule }));
    expect(r.flex).toEqual([{ day: 5, shiftId: 'manha', roleId: 'balconista', employeeId: 'andreza' }]);
  });

  test('countGaps concorda com computeCoverage em escalas variadas', () => {
    const employees = flexTeam();
    const config = baseConfig();
    for (let seed = 0; seed < 30; seed++) {
      const off: Record<string, number[]> = {};
      employees.forEach((e, i) => {
        off[e.id] = Array.from({ length: CYCLE_DAYS }, (_, d) => d).filter((d) => (d * 7 + i * 3 + seed) % 5 === 0);
      });
      const schedule = scheduleFor(employees, off);
      const r = computeCoverage({ config, employees, schedule, marks: [] });
      expect(countGaps(config, employees, schedule), `seed ${seed}`).toBe(r.gaps.length);
    }
  });
});
