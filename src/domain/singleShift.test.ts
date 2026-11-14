import { describe, expect, it } from 'vitest';
import { parseDocument } from '../state/schema';
import { computeCoverage } from './coverage';
import { referenceDocument as exampleDocument } from '../test/fixtures';
import { generateSchedule } from './generator';
import { LUNCH_MAX_OFFSET, LUNCH_MIN_OFFSET, planLunches } from './lunch';
import { reconcileDocument } from './reconcile';
import { evaluateRules } from './rules';
import { suggestFor } from './suggestions';
import {
  dayShifts,
  effectiveHours,
  effectiveShiftId,
  findShift,
  grossMinutes,
  isVirtualShiftId,
  requiredCount,
  workedMinutes,
} from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, SUNDAY, WEEKS, type Cell, type Employee, type Schedule, type StoreConfig } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const TODAY = new Date('2026-11-14');
/** Domingos do ciclo (a semana começa no domingo). */
const SUNDAYS = [0, 7, 14];

function example() {
  return exampleDocument(TODAY);
}

function allWork(employees: Employee[]): Schedule {
  const s: Schedule = {};
  for (const e of employees) s[e.id] = Array.from({ length: CYCLE_DAYS }, (): Cell => ({ status: 'work' }));
  return s;
}

describe('turno único: turno virtual', () => {
  it('o exemplo tem domingo 07:00–13:00 em turno único', () => {
    const { config } = example();
    expect(config.days[SUNDAY]).toEqual({ open: true, opensAt: h(7), closesAt: h(13), singleShift: true });
    expect(config.days.slice(0, 6).every((d) => d.singleShift === false)).toBe(true);
  });

  it('resolve o turno virtual pelo id, com o horário da loja e o intervalo padrão', () => {
    const { config } = example();
    const shift = findShift(config, '__dia6');
    expect(shift).toEqual({ id: '__dia6', name: 'Turno único', start: h(7), end: h(13), breakMinutes: 15 });
    expect(isVirtualShiftId('__dia6')).toBe(true);
    expect(isVirtualShiftId('manha')).toBe(false);
    expect(dayShifts(config, SUNDAY)).toEqual([shift]);
    expect(dayShifts(config, 0)).toBe(config.shifts);
    // Dia que não é de turno único não resolve o id virtual.
    expect(findShift(config, '__dia0')).toBeUndefined();
    expect(findShift(config, 'manha')?.name).toBe('Manhã');
  });

  it('dia fechado não tem turno virtual, mesmo marcado', () => {
    const { config } = example();
    config.days[SUNDAY] = { ...config.days[SUNDAY], open: false };
    expect(findShift(config, '__dia6')).toBeUndefined();
    expect(dayShifts(config, SUNDAY)).toBe(config.shifts);
  });

  it('no domingo todos estão no turno virtual, mesmo com ajuste de turno na célula', () => {
    const { config, employees } = example();
    const pedro = employees.find((e) => e.id === 'pedro')!;
    expect(effectiveShiftId(config, pedro, { status: 'work' }, 0)).toBe('__dia6');
    expect(effectiveShiftId(config, pedro, { status: 'work', shiftId: 'manha' }, 7)).toBe('__dia6');
    expect(effectiveShiftId(config, pedro, { status: 'work', shiftId: 'manha' }, 6)).toBe('manha');
    expect(effectiveShiftId(config, pedro, { status: 'work' }, 6)).toBe('tarde');
  });

  it('horário no domingo: ignora o horário do cadastro, mas o ajuste do dia vale', () => {
    const { config, employees } = example();
    const rosa = employees.find((e) => e.id === 'rosa')!; // cadastro 05:45–13:30
    expect(effectiveHours(config, rosa, { status: 'work' }, 0)).toEqual({ start: h(7), end: h(13), breakMinutes: 15 });
    expect(effectiveHours(config, rosa, { status: 'work' }, 6)?.start).toBe(h(5, 45));
    const adjusted = { start: h(8), end: h(12), breakMinutes: 0 };
    expect(effectiveHours(config, rosa, { status: 'work', hours: adjusted }, 0)).toEqual(adjusted);
  });

  it('mínimo no turno único = maior mínimo da função entre os turnos', () => {
    const { config } = example();
    config.minimums = [
      { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 2] },
      { roleId: 'caixa', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 3] },
      { roleId: 'balconista', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 0] },
    ];
    expect(requiredCount(config, 0, '__dia6', 'caixa')).toBe(3);
    expect(requiredCount(config, 0, '__dia6', 'balconista')).toBe(0);
    expect(requiredCount(config, 0, 'manha', 'caixa')).toBe(0);
    expect(requiredCount(config, 6, '__dia6', 'caixa')).toBe(0);
    expect(requiredCount(config, 6, 'tarde', 'caixa')).toBe(1);
  });
});

describe('turno único: cobertura', () => {
  it('conta todo mundo que trabalha no domingo contra o maior mínimo', () => {
    const { config, employees } = example();
    config.minimums = [
      { roleId: 'caixa', shiftId: 'manha', perWeekday: [0, 0, 0, 0, 0, 0, 2] },
      { roleId: 'caixa', shiftId: 'tarde', perWeekday: [0, 0, 0, 0, 0, 0, 3] },
    ];
    // Caixas: Andreza (manhã), Richard (manhã), Lucas (tarde), João (tarde) = 4 >= 3.
    const schedule = allWork(employees);
    expect(computeCoverage({ config, employees, schedule, marks: [] }).gaps).toEqual([]);
    // Dois de folga no domingo da semana 1: sobram 2 caixas, falta 1 no turno único.
    schedule.andreza[0] = { status: 'off' };
    schedule.lucas[0] = { status: 'off' };
    const r = computeCoverage({ config, employees, schedule, marks: [] });
    expect(r.gaps).toEqual([{ day: 0, shiftId: '__dia6', roleId: 'caixa', slot: 0 }]);
    expect(r.summary).toEqual([
      { roleId: 'caixa', shiftId: '__dia6', weekdays: [6], perWeek: 1, text: 'Caixa no turno único: domingo' },
    ]);
    expect(r.headline).toBe('1 buraco por semana: caixa no turno único, domingo');
  });

  it('marcação "coberto por" vale no turno único; a de um turno cadastrado no domingo vira órfã', () => {
    const { config, employees } = example();
    const schedule = allWork(employees);
    for (const id of ['andreza', 'richard', 'lucas', 'joao']) schedule[id][0] = { status: 'off' };
    const owner = { day: 0, shiftId: '__dia6', roleId: 'caixa', slot: 0, coveredBy: { kind: 'owner' as const } };
    const stale = { day: 0, shiftId: 'manha', roleId: 'caixa', slot: 0, coveredBy: { kind: 'owner' as const } };
    const viaRichard = { day: 0, shiftId: '__dia6', roleId: 'caixa', slot: 0, coveredBy: { kind: 'employee' as const, employeeId: 'richard' } };
    const a = computeCoverage({ config, employees, schedule, marks: [owner, stale] });
    expect(a.covered.map((g) => g.mark)).toEqual([owner]);
    expect(a.orphanMarks).toEqual([stale]);
    // Richard de folga cobrindo: jornada extra com o horário do turno único.
    const b = computeCoverage({ config, employees, schedule, marks: [viaRichard] });
    expect(b.extraShifts).toEqual([
      { employeeId: 'richard', day: 0, shiftId: '__dia6', roleId: 'caixa', hours: { start: h(7), end: h(13), breakMinutes: 15 } },
    ]);
  });
});


describe('turno único: gerador', () => {
  function runs(row: Cell[]): { rest: number; work: number } {
    let rest = 0;
    let work = 0;
    for (let start = 0; start < CYCLE_DAYS; start++) {
      let r = 0;
      while (r < CYCLE_DAYS && row[(start + r) % CYCLE_DAYS].status !== 'work') r++;
      let w = 0;
      while (w < CYCLE_DAYS && row[(start + w) % CYCLE_DAYS].status === 'work') w++;
      rest = Math.max(rest, r);
      work = Math.max(work, w);
    }
    return { rest, work };
  }

  for (const offPattern of ['together', 'flexible'] as const) {
    it(`gera escala válida com domingo de turno único (${offPattern})`, () => {
      const doc = example();
      const config = { ...doc.config, offPattern };
      const schedule = generateSchedule({ config, employees: doc.employees });
      for (const e of doc.employees) {
        const row = schedule[e.id];
        for (let w = 0; w < WEEKS; w++) {
          const week = row.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK);
          expect(week.filter((c) => c.status === 'off')).toHaveLength(2);
        }
        const sundaysOff = SUNDAYS.filter((d) => row[d].status === 'off').length;
        expect(sundaysOff).toBeGreaterThanOrEqual(e.isWoman ? 2 : 1);
        const { rest, work } = runs(row);
        expect(rest).toBeLessThanOrEqual(2);
        expect(work).toBeLessThanOrEqual(6);
      }
      const reports = evaluateRules({ config, employees: doc.employees, schedule });
      // O descanso de 11h (sábado 20:30 → domingo 07:00) não restringe o gerador: vira aviso, não alerta legal.
      const forbidden = new Set(['days-off', 'too-many-offs', 'sunday-rotation', 'work-streak', 'intershift-rest']);
      expect(Object.values(reports).flatMap((r) => r.alerts.filter((a) => forbidden.has(a.kind)))).toEqual([]);
    });
  }

  it('o domingo de turno único fica coberto (4 por domingo bastam para 1 caixa + 1 balconista)', () => {
    const doc = example();
    const schedule = generateSchedule({ config: doc.config, employees: doc.employees });
    const gaps = computeCoverage({ config: doc.config, employees: doc.employees, schedule, marks: [] }).gaps;
    expect(gaps.filter((g) => SUNDAYS.includes(g.day))).toEqual([]);
    // Sem o turno único, o domingo teria buracos com o mesmo time (2 turnos × 2 funções).
    for (const d of SUNDAYS) {
      const working = doc.employees.filter((e) => schedule[e.id][d].status === 'work');
      expect(working.some((e) => e.roleId === 'caixa' || e.secondaryRoleId === 'caixa')).toBe(true);
      expect(working.some((e) => e.roleId === 'balconista' || e.secondaryRoleId === 'balconista')).toBe(true);
    }
  });
});

describe('turno único: intervalo, regras, reconciliação, sugestões e backup', () => {
  it('intervalo planejado dentro do horário do turno único', () => {
    const doc = example();
    const schedule = generateSchedule({ config: doc.config, employees: doc.employees });
    const plan = planLunches({ config: doc.config, employees: doc.employees, schedule });
    let checked = 0;
    for (const e of doc.employees) {
      for (const d of SUNDAYS) {
        if (schedule[e.id][d].status !== 'work') continue;
        const lunch = plan[e.id][d]!;
        expect(lunch).toBeGreaterThanOrEqual(h(7) + LUNCH_MIN_OFFSET);
        expect(lunch).toBeLessThanOrEqual(h(7) + LUNCH_MAX_OFFSET);
        expect(lunch + 15).toBeLessThanOrEqual(h(13));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('as horas da semana usam o domingo mais curto', () => {
    const { config, employees } = example();
    const rosa = employees.find((e) => e.id === 'rosa')!;
    const schedule = allWork([rosa]);
    const report = evaluateRules({ config, employees: [rosa], schedule }).rosa;
    const weekday = workedMinutes(rosa.customHours!);
    const sunday = grossMinutes({ start: h(7), end: h(13) }) - 15;
    expect(report.weeklyMinutes).toEqual([6 * weekday + sunday, 6 * weekday + sunday, 6 * weekday + sunday]);
  });

  it('reconciliação descarta o ajuste de turno no domingo de turno único (o de horário fica)', () => {
    const doc = example();
    const schedule = allWork(doc.employees);
    const hours = { start: h(8), end: h(12), breakMinutes: 0 };
    schedule.pedro[0] = { status: 'work', shiftId: 'manha', hours };
    schedule.pedro[6] = { status: 'work', shiftId: 'manha' };
    const mark = { day: 0, shiftId: '__dia6', roleId: 'caixa', slot: 0, coveredBy: { kind: 'owner' as const } };
    const next = reconcileDocument({ ...doc, schedule, marks: [mark] });
    expect(next.schedule!.pedro[0]).toEqual({ status: 'work', hours });
    expect(next.schedule!.pedro[6]).toEqual({ status: 'work', shiftId: 'manha' });
    expect(next.marks).toEqual([mark]);
  });

  it('sugestões para buraco no turno único: contratar ou reduzir, nunca "passar para o turno único"', () => {
    const doc = example();
    const config: StoreConfig = {
      ...doc.config,
      minimums: [...doc.config.minimums.filter((m) => m.roleId !== 'caixa'), { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 5] }],
    };
    const schedule = generateSchedule({ config, employees: doc.employees });
    const { summary } = computeCoverage({ config, employees: doc.employees, schedule, marks: [] });
    const item = summary.find((s) => s.shiftId === '__dia6' && s.roleId === 'caixa');
    expect(item).toBeDefined();
    const list = suggestFor({ config, employees: doc.employees, schedule }, item!);
    expect(list.some((s) => s.kind === 'move-shift')).toBe(false);
    const hire = list.find((s) => s.kind === 'hire');
    expect(hire?.text).toBe('Contratar 1 caixa no turno único');
    expect(hire!.gapsAfter).toBeLessThan(hire!.gapsBefore);
    const reduce = list.find((s) => s.kind === 'reduce-minimum');
    expect(reduce?.text).toBe('Reduzir para 4 caixa no turno único em domingo');
  });

  it('documento antigo sem "singleShift" é lido com false', () => {
    const doc = example();
    const old = JSON.parse(JSON.stringify(doc));
    for (const d of old.config.days) delete d.singleShift;
    const result = parseDocument(old);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.config.days.every((d) => d.singleShift === false)).toBe(true);
  });
});
