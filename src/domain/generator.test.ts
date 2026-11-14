import { describe, expect, it } from 'vitest';
import { computeCoverage, countGaps } from './coverage';
import { exampleDocument } from './example';
import { fitEmployee, generateSchedule } from './generator';
import { evaluateRules } from './rules';
import { weekOf } from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, SUNDAY, WEEKS, type Employee, type Schedule, type StoreConfig } from './types';
import { defaultRow } from '../state/store';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const FIXED_DATE = new Date('2026-12-20T12:00:00Z');

function example() {
  const doc = exampleDocument(FIXED_DATE);
  return { config: doc.config, employees: doc.employees };
}

/** Equipe sintética: `perGroup` pessoas por (função, turno), com `required` por dia. */
function team(perGroup: number, required: number, opts: { shifts?: number; roles?: number; womenPerGroup?: number } = {}) {
  const nShifts = opts.shifts ?? 3;
  const nRoles = opts.roles ?? 2;
  const shifts = Array.from({ length: nShifts }, (_, i) => ({
    id: `s${i}`,
    name: `Turno ${i}`,
    start: h(6 + i * 5),
    end: h(6 + i * 5 + 5),
    breakMinutes: 15,
  }));
  const roles = Array.from({ length: nRoles }, (_, i) => ({ id: `r${i}`, name: `Função ${i}` }));
  const config: StoreConfig = {
    name: 'Loja',
    days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(6), closesAt: h(23) })),
    shifts,
    roles,
    minimums: shifts.flatMap((s) => roles.map((r) => ({ roleId: r.id, shiftId: s.id, perWeekday: Array(7).fill(required) }))),
    regime: '42h',
  };
  const employees: Employee[] = [];
  for (const s of shifts) {
    for (const r of roles) {
      for (let i = 0; i < perGroup; i++) {
        employees.push({
          id: `${s.id}-${r.id}-${i}`,
          name: `P ${s.id} ${r.id} ${i}`,
          roleId: r.id,
          shiftId: s.id,
          isWoman: i < (opts.womenPerGroup ?? 0),
        });
      }
    }
  }
  return { config, employees };
}

function offsInWeek(schedule: Schedule, id: string, week: number): number {
  return schedule[id].slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK).filter((c) => c.status === 'off').length;
}

function sundaysOff(schedule: Schedule, id: string): number {
  let n = 0;
  for (let w = 0; w < WEEKS; w++) if (schedule[id][w * DAYS_PER_WEEK + SUNDAY].status !== 'work') n++;
  return n;
}

const FORBIDDEN = new Set(['days-off', 'too-many-offs', 'sunday-rotation']);

function forbiddenAlerts(config: StoreConfig, employees: Employee[], schedule: Schedule) {
  const reports = evaluateRules({ config, employees, schedule });
  return Object.values(reports).flatMap((r) => r.alerts.filter((a) => FORBIDDEN.has(a.kind)));
}

const scenarios = {
  example: example(),
  'equipe média com mulheres': team(4, 2, { womenPerGroup: 2 }),
  'equipe apertada': team(3, 2, { shifts: 2, womenPerGroup: 1 }),
};

describe('generateSchedule', () => {
  for (const [name, input] of Object.entries(scenarios)) {
    describe(name, () => {
      const schedule = generateSchedule(input);

      it('gera 21 células por pessoa, sem horário nem turno do dia', () => {
        for (const e of input.employees) {
          expect(schedule[e.id]).toHaveLength(CYCLE_DAYS);
          for (const c of schedule[e.id]) {
            expect(['work', 'off']).toContain(c.status);
            expect(c.hours).toBeUndefined();
            expect(c.shiftId).toBeUndefined();
          }
        }
      });

      it('toda pessoa tem exatamente 2 folgas em cada semana', () => {
        for (const e of input.employees) {
          for (let w = 0; w < WEEKS; w++) expect(offsInWeek(schedule, e.id, w), `${e.id} semana ${w + 1}`).toBe(2);
        }
      });

      it('rodízio de domingo: 1 domingo (2 para mulheres)', () => {
        for (const e of input.employees) {
          expect(sundaysOff(schedule, e.id), e.id).toBeGreaterThanOrEqual(e.isWoman ? 2 : 1);
        }
      });

      it('não gera alertas de folgas nem de domingo', () => {
        expect(forbiddenAlerts(input.config, input.employees, schedule)).toEqual([]);
      });
    });
  }

  it('é determinístico', () => {
    const input = team(4, 2, { womenPerGroup: 1 });
    expect(generateSchedule(input)).toEqual(generateSchedule(structuredClone(input)));
    const ex = example();
    expect(generateSchedule(ex)).toEqual(generateSchedule(structuredClone(ex)));
  });

  it('exemplo do mercado: no máximo 2 buracos de balconista por turno por semana e nenhum de caixa', () => {
    const { config, employees } = example();
    const schedule = generateSchedule({ config, employees });
    const { gaps } = computeCoverage({ config, employees, schedule, marks: [] });
    expect(gaps.filter((g) => g.roleId === 'caixa')).toEqual([]);
    for (const shift of ['manha', 'tarde']) {
      for (let w = 0; w < WEEKS; w++) {
        const n = gaps.filter((g) => g.roleId === 'balconista' && g.shiftId === shift && weekOf(g.day) === w).length;
        expect(n, `${shift} semana ${w + 1}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('equipe grande o suficiente fica sem buracos', () => {
    const input = team(4, 2, { womenPerGroup: 2 });
    expect(countGaps(input.config, input.employees, generateSchedule(input))).toBe(0);
    const input2 = team(5, 3, { womenPerGroup: 1 });
    expect(countGaps(input2.config, input2.employees, generateSchedule(input2))).toBe(0);
  });

  it('loja fechada no domingo: domingo "closed" e só 1 folga por semana', () => {
    const { config, employees } = example();
    config.days[SUNDAY] = { ...config.days[SUNDAY], open: false };
    const schedule = generateSchedule({ config, employees });
    for (const e of employees) {
      for (let w = 0; w < WEEKS; w++) {
        expect(schedule[e.id][w * DAYS_PER_WEEK + SUNDAY].status).toBe('closed');
        expect(offsInWeek(schedule, e.id, w)).toBe(1);
      }
    }
    expect(forbiddenAlerts(config, employees, schedule)).toEqual([]);
  });

  it('loja fechada em 2 dias: nenhuma folga atribuída', () => {
    const { config, employees } = example();
    config.days[SUNDAY] = { ...config.days[SUNDAY], open: false };
    config.days[0] = { ...config.days[0], open: false };
    const schedule = generateSchedule({ config, employees });
    for (const e of employees) for (let w = 0; w < WEEKS; w++) expect(offsInWeek(schedule, e.id, w)).toBe(0);
    expect(forbiddenAlerts(config, employees, schedule)).toEqual([]);
  });

  it('prefere folgas consecutivas quando não custa cobertura', () => {
    // Função sem mínimo: nada a cobrir, então todas as folgas devem formar pares.
    const input = team(2, 0, { shifts: 1, roles: 1 });
    const schedule = generateSchedule(input);
    for (const e of input.employees) {
      const row = schedule[e.id];
      for (let d = 0; d < CYCLE_DAYS; d++) {
        if (row[d].status !== 'off') continue;
        const prev = row[(d + CYCLE_DAYS - 1) % CYCLE_DAYS].status;
        const next = row[(d + 1) % CYCLE_DAYS].status;
        expect(prev === 'off' || next === 'off', `${e.id} dia ${d}`).toBe(true);
      }
    }
  });

  it('distribui os domingos de folga entre as semanas na mesma função e turno', () => {
    const input = team(3, 1, { shifts: 1, roles: 1 });
    const schedule = generateSchedule(input);
    for (let w = 0; w < WEEKS; w++) {
      const off = input.employees.filter((e) => schedule[e.id][w * DAYS_PER_WEEK + SUNDAY].status === 'off').length;
      expect(off, `domingo da semana ${w + 1}`).toBeLessThan(3);
    }
    expect(countGaps(input.config, input.employees, schedule)).toBe(0);
  });

  it('30 pessoas, 3 turnos e 2 funções geram em menos de 1s', () => {
    const input = team(5, 3, { womenPerGroup: 2 });
    expect(input.employees).toHaveLength(30);
    const t0 = performance.now();
    const schedule = generateSchedule(input);
    const elapsed = performance.now() - t0;
    console.info(`generateSchedule 30 pessoas: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(forbiddenAlerts(input.config, input.employees, schedule)).toEqual([]);
  });
});

describe('fitEmployee', () => {
  it('encaixa uma balconista nova à tarde sem mexer nas outras linhas', () => {
    const { config, employees } = example();
    const schedule = generateSchedule({ config, employees });
    const before = structuredClone(schedule);
    const novo: Employee = { id: 'nova', name: 'Nova', roleId: 'balconista', shiftId: 'tarde', isWoman: true };
    const all = [...employees, novo];
    const withDefault = { ...schedule, nova: defaultRow(config) };

    const row = fitEmployee({ config, employees: all, schedule: withDefault }, 'nova');
    expect(schedule).toEqual(before);
    expect(row).toHaveLength(CYCLE_DAYS);

    const fitted = { ...schedule, nova: row };
    for (let w = 0; w < WEEKS; w++) expect(offsInWeek(fitted, 'nova', w)).toBe(2);
    expect(sundaysOff(fitted, 'nova')).toBeGreaterThanOrEqual(2);
    expect(forbiddenAlerts(config, all, fitted)).toEqual([]);

    const gapsWithout = countGaps(config, employees, schedule);
    const gapsDefault = countGaps(config, all, withDefault);
    const gapsFitted = countGaps(config, all, fitted);
    expect(gapsFitted).toBeLessThan(gapsWithout);
    expect(gapsFitted).toBeLessThanOrEqual(gapsDefault);
    // Com Pedro e a nova pessoa, o balcão da tarde fica coberto.
    const { gaps } = computeCoverage({ config, employees: all, schedule: fitted, marks: [] });
    expect(gaps.filter((g) => g.roleId === 'balconista' && g.shiftId === 'tarde')).toEqual([]);
  });

  it('funciona mesmo sem linha prévia da pessoa na escala', () => {
    const { config, employees } = example();
    const schedule = generateSchedule({ config, employees });
    const novo: Employee = { id: 'x', name: 'X', roleId: 'caixa', shiftId: 'manha', isWoman: false };
    const row = fitEmployee({ config, employees: [...employees, novo], schedule }, 'x');
    const fitted = { ...schedule, x: row };
    for (let w = 0; w < WEEKS; w++) expect(offsInWeek(fitted, 'x', w)).toBe(2);
    expect(forbiddenAlerts(config, [...employees, novo], fitted)).toEqual([]);
  });
});
