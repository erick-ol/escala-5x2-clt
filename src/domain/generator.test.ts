import { describe, expect, it } from 'vitest';
import { computeCoverage, countGaps } from './coverage';
import { detailedMarketDocument as siteExample, referenceDocument as exampleDocument } from '../test/fixtures';
import { fitEmployee, generateSchedule } from './generator';
import { evaluateRules } from './rules';
import { dayOfWeekday, weekOf, weekdayOf } from './time';
import { CYCLE_DAYS, DAYS_PER_WEEK, SUNDAY, WEEKS, type Cell, type Employee, type OffPattern, type Schedule, type StoreConfig } from './types';
import { defaultRow } from '../state/store';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const FIXED_DATE = new Date('2026-12-20T12:00:00Z');

function example(offPattern: OffPattern = 'together') {
  const doc = exampleDocument(FIXED_DATE);
  return { config: { ...doc.config, offPattern }, employees: doc.employees };
}

/** Equipe sintética: `perGroup` pessoas por (função, turno), com `required` por dia. */
function team(
  perGroup: number,
  required: number,
  opts: { shifts?: number; roles?: number; womenPerGroup?: number; offPattern?: OffPattern } = {},
) {
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
    offPattern: opts.offPattern ?? 'together',
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
  for (let w = 0; w < WEEKS; w++) if (schedule[id][dayOfWeekday(w, SUNDAY)].status !== 'work') n++;
  return n;
}

const FORBIDDEN = new Set(['days-off', 'too-many-offs', 'sunday-rotation', 'work-streak']);

function forbiddenAlerts(config: StoreConfig, employees: Employee[], schedule: Schedule) {
  const reports = evaluateRules({ config, employees, schedule });
  return Object.values(reports).flatMap((r) => r.alerts.filter((a) => FORBIDDEN.has(a.kind)));
}

/**
 * Maior sequência circular de descanso que contém ao menos uma folga atribuída ('off'),
 * e maior sequência circular de trabalho. Dias de loja fechada sozinhos não contam contra a pessoa.
 */
function runs(row: Cell[]): { rest: number; work: number } {
  const n = row.length;
  const start = row.findIndex((c, d) => c.status === 'work' && row[(d + n - 1) % n].status !== 'work');
  if (start < 0) return row.every((c) => c.status === 'work') ? { rest: 0, work: n } : { rest: 0, work: 0 };
  let rest = 0;
  let work = 0;
  let len = 0;
  let kind: 'work' | 'rest' = 'work';
  let hasOff = false;
  const close = () => {
    if (kind === 'work') work = Math.max(work, len);
    else if (hasOff) rest = Math.max(rest, len);
  };
  for (let k = 0; k < n; k++) {
    const c = row[(start + k) % n];
    const k2 = c.status === 'work' ? 'work' : 'rest';
    if (k2 !== kind) {
      close();
      kind = k2;
      len = 0;
      hasOff = false;
    }
    len++;
    if (c.status === 'off') hasOff = true;
  }
  close();
  return { rest, work };
}

/** Folgas com outra folga (ou loja fechada) colada, no ciclo circular. */
function adjacentOffs(schedule: Schedule, ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    const row = schedule[id];
    for (let d = 0; d < CYCLE_DAYS; d++) {
      if (row[d].status !== 'off') continue;
      if (row[(d + CYCLE_DAYS - 1) % CYCLE_DAYS].status !== 'work' || row[(d + 1) % CYCLE_DAYS].status !== 'work') n++;
    }
  }
  return n;
}

const scenarios = {
  example: example(),
  'example (folgas flexíveis)': example('flexible'),
  'equipe média com mulheres': team(4, 2, { womenPerGroup: 2 }),
  'equipe média com mulheres (flexível)': team(4, 2, { womenPerGroup: 2, offPattern: 'flexible' }),
  'equipe apertada': team(3, 2, { shifts: 2, womenPerGroup: 1 }),
  'equipe apertada (flexível)': team(3, 2, { shifts: 2, womenPerGroup: 1, offPattern: 'flexible' }),
  'sem mínimo': team(2, 0, { shifts: 1, roles: 1, womenPerGroup: 1 }),
  'sem mínimo (flexível)': team(2, 0, { shifts: 1, roles: 1, womenPerGroup: 1, offPattern: 'flexible' }),
  'equipe grande': team(5, 3, { womenPerGroup: 2 }),
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

      it('não gera alertas de folgas, de domingo nem de dias seguidos', () => {
        expect(forbiddenAlerts(input.config, input.employees, schedule)).toEqual([]);
      });

      it('nunca mais de 2 dias seguidos de descanso nem mais de 6 de trabalho (circular)', () => {
        for (const e of input.employees) {
          const r = runs(schedule[e.id]);
          expect(r.rest, `${e.id} descanso`).toBeLessThanOrEqual(2);
          expect(r.work, `${e.id} trabalho`).toBeLessThanOrEqual(6);
        }
      });
    });
  }

  it('é determinístico', () => {
    const input = team(4, 2, { womenPerGroup: 1 });
    expect(generateSchedule(input)).toEqual(generateSchedule(structuredClone(input)));
    const ex = example();
    expect(generateSchedule(ex)).toEqual(generateSchedule(structuredClone(ex)));
    const flex = example('flexible');
    expect(generateSchedule(flex)).toEqual(generateSchedule(structuredClone(flex)));
  });

  it('exemplo do mercado: Andreza e Pedro sem 3 ou 4 descansos seguidos na virada da semana', () => {
    for (const mode of ['together', 'flexible'] as const) {
      const { config, employees } = example(mode);
      const schedule = generateSchedule({ config, employees });
      for (const id of ['andreza', 'pedro']) expect(runs(schedule[id]).rest, `${mode} ${id}`).toBeLessThanOrEqual(2);
    }
  });

  it('exemplo do mercado: a segunda área (caixa que cobre balcão) reduz os buracos', () => {
    for (const mode of ['together', 'flexible'] as const) {
      const { config, employees } = example(mode);
      const plain = employees.map((e) => ({ ...e, secondaryRoleId: undefined }));
      const withFlex = countGaps(config, employees, generateSchedule({ config, employees }));
      const without = countGaps(config, plain, generateSchedule({ config, employees: plain }));
      expect(withFlex, mode).toBeLessThan(without);
    }
  });

  it("'together' forma pares de folga; 'flexible' separa mais as folgas", () => {
    const together = team(3, 0, { shifts: 1, roles: 1, womenPerGroup: 1 });
    const flexible = team(3, 0, { shifts: 1, roles: 1, womenPerGroup: 1, offPattern: 'flexible' });
    const ids = together.employees.map((e) => e.id);
    const totalOffs = ids.length * WEEKS * 2;
    const adjTogether = adjacentOffs(generateSchedule(together), ids);
    const adjFlexible = adjacentOffs(generateSchedule(flexible), ids);
    expect(adjTogether).toBe(totalOffs);
    expect(adjFlexible).toBeLessThan(adjTogether);
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
        expect(schedule[e.id][dayOfWeekday(w, SUNDAY)].status).toBe('closed');
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
      const off = input.employees.filter((e) => schedule[e.id][dayOfWeekday(w, SUNDAY)].status === 'off').length;
      expect(off, `domingo da semana ${w + 1}`).toBeLessThan(3);
    }
    expect(countGaps(input.config, input.employees, schedule)).toBe(0);
  });

  for (const offPattern of ['together', 'flexible'] as const) {
    it(`30 pessoas, 3 turnos e 2 funções geram em menos de 1s (${offPattern})`, () => {
      const input = team(5, 3, { womenPerGroup: 2, offPattern });
      // Metade de cada grupo cobre a outra função como segunda área.
      input.employees.forEach((e, i) => {
        if (i % 2 === 0) e.secondaryRoleId = e.roleId === 'r0' ? 'r1' : 'r0';
      });
      expect(input.employees).toHaveLength(30);
      const t0 = performance.now();
      const schedule = generateSchedule(input);
      const elapsed = performance.now() - t0;
      console.info(`generateSchedule 30 pessoas (${offPattern}): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(1000);
      expect(forbiddenAlerts(input.config, input.employees, schedule)).toEqual([]);
    });
  }

  it('loja fechada no domingo: folga colada ao domingo fechado não vira 3 descansos seguidos', () => {
    for (const mode of ['together', 'flexible'] as const) {
      const { config, employees } = example(mode);
      config.days[SUNDAY] = { ...config.days[SUNDAY], open: false };
      const schedule = generateSchedule({ config, employees });
      for (const e of employees) {
        const r = runs(schedule[e.id]);
        expect(r.rest, `${mode} ${e.id}`).toBeLessThanOrEqual(2);
        expect(r.work, `${mode} ${e.id}`).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('fitEmployee', () => {
  it('encaixa uma balconista nova à tarde sem mexer nas outras linhas', () => {
    // Sem segunda área: com ela o João já cobre o balcão à tarde e não sobra buraco para a nova pessoa fechar.
    const { config, employees: withSecondary } = example();
    const employees = withSecondary.map((e) => ({ ...e, secondaryRoleId: undefined }));
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
    const gapsFitted = countGaps(config, all, fitted);
    expect(gapsFitted).toBeLessThan(gapsWithout);
    const tarde = (s: Schedule, list: Employee[]) =>
      computeCoverage({ config, employees: list, schedule: s, marks: [] }).gaps.filter(
        (g) => g.roleId === 'balconista' && g.shiftId === 'tarde',
      );
    const after = tarde(fitted, all);
    expect(after.length).toBeLessThan(tarde(schedule, employees).length);
    // Só sobra falta no fim de semana: quem fecha o sábado à noite não tem 11h até o domingo de manhã, e
    // ninguém fica com todos os domingos de folga, então quem trabalha um domingo folga no sábado antes.
    expect(after.every((g) => weekdayOf(g.day) === SUNDAY || weekdayOf(g.day) === 5)).toBe(true);
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

describe('dia sem folga', () => {
  const SATURDAY = 5;
  for (const offPattern of ['together', 'flexible'] as const) {
    it(`sábado sem folga (${offPattern}): ninguém folga no sábado, 2 descansos por semana e nenhum alerta legal`, () => {
      const base = example(offPattern);
      const config: StoreConfig = {
        ...base.config,
        days: base.config.days.map((d, w) => (w === SATURDAY ? { ...d, noOff: true } : d)),
      };
      const schedule = generateSchedule({ config, employees: base.employees });
      for (const e of base.employees) {
        const row = schedule[e.id];
        for (let w = 0; w < WEEKS; w++) {
          expect(row[dayOfWeekday(w, SATURDAY)].status).toBe('work');
          const rest = row.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK).filter((c) => c.status !== 'work').length;
          expect(rest).toBe(2);
        }
      }
      const alerts = Object.values(evaluateRules({ config, employees: base.employees, schedule })).flatMap((r) => r.alerts);
      expect(alerts.map((a) => a.message)).toEqual([]);
    });
  }

  it('"sem folga" no domingo é ignorado: o rodízio de domingo continua', () => {
    const base = example();
    const config: StoreConfig = { ...base.config, days: base.config.days.map((d, w) => (w === SUNDAY ? { ...d, noOff: true } : d)) };
    const schedule = generateSchedule({ config, employees: base.employees });
    for (const e of base.employees) {
      const sundaysOff = Array.from({ length: WEEKS }, (_, w) => schedule[e.id][dayOfWeekday(w, SUNDAY)].status === 'off');
      expect(sundaysOff.some(Boolean)).toBe(true);
    }
  });

  it('pessoa nova encaixada também não folga no dia sem folga', () => {
    const base = example();
    const config: StoreConfig = { ...base.config, days: base.config.days.map((d, w) => (w === SATURDAY ? { ...d, noOff: true } : d)) };
    const schedule = generateSchedule({ config, employees: base.employees });
    const novo: Employee = { id: 'novo', name: 'Novo', roleId: 'caixa', shiftId: 'tarde', isWoman: false };
    const row = fitEmployee({ config, employees: [...base.employees, novo], schedule }, 'novo');
    for (let w = 0; w < WEEKS; w++) expect(row[dayOfWeekday(w, SATURDAY)].status).toBe('work');
  });
});

describe('domingos divididos', () => {
  for (const offPattern of ['together', 'flexible'] as const) {
    it(`ninguém fica com os 3 domingos do ciclo de folga (${offPattern}) e a cobertura não piora`, () => {
      const { config, employees } = example(offPattern);
      const schedule = generateSchedule({ config, employees });
      for (const e of employees) {
        const worked = Array.from({ length: WEEKS }, (_, w) => schedule[e.id][dayOfWeekday(w, SUNDAY)].status === 'work');
        expect(worked.some(Boolean), e.name).toBe(true);
      }
      expect(countGaps(config, employees, schedule)).toBe(0);
    });
  }
});


describe('folgas estáveis', () => {
  /** Dias da semana diferentes (fora o domingo) em que a pessoa folga no ciclo. */
  const spread = (row: Cell[]) => new Set(row.flatMap((c, d) => (c.status === 'off' && weekdayOf(d) !== SUNDAY ? [weekdayOf(d)] : []))).size;

  const cases = [
    ['mercado detalhado', () => { const d = siteExample(FIXED_DATE); return { config: d.config, employees: d.employees }; }],
    ['exemplo antigo, folgas separadas', () => example('flexible')],
    ['exemplo antigo, folgas juntas', () => example('together')],
  ] as const;
  for (const [name, input] of cases) {
    it(`cada pessoa repete os mesmos dias e, na semana do domingo, só troca um deles (${name})`, () => {
      const { config, employees } = input();
      const schedule = generateSchedule({ config, employees });
      // Quase todos ficam com 2 dias; no máximo uma pessoa usa um 3º (ex.: folga no sábado antes do domingo
      // trabalhado, para não fechar às 20:45 e abrir às 06:45).
      const spreads = employees.map((e) => spread(schedule[e.id]));
      for (const [i, e] of employees.entries()) expect(spreads[i], e.name).toBeLessThanOrEqual(3);
      expect(spreads.filter((n) => n > 2).length).toBeLessThanOrEqual(1);
      expect(countGaps(config, employees, schedule)).toBe(0);
    });
  }
});

describe('sem turno fixo', () => {
  it('quem não tem turno fixo vai para o turno onde falta gente e diminui os buracos', () => {
    // Mercado de referência sem segunda área e uma balconista a mais: fixa na manhã ela não ajuda a tarde.
    const { config, employees: base } = example();
    const employees = base.map((e) => ({ ...e, secondaryRoleId: undefined }));
    const extra = (floating: boolean): Employee => ({ id: 'nova', name: 'Nova', roleId: 'balconista', shiftId: 'manha', isWoman: false, floating });
    const fixedTeam = [...employees, extra(false)];
    const floatTeam = [...employees, extra(true)];
    const fixed = generateSchedule({ config, employees: fixedTeam });
    const floating = generateSchedule({ config, employees: floatTeam });
    expect(fixed.nova.some((c) => c.shiftId === 'tarde')).toBe(false);
    expect(floating.nova.some((c) => c.status === 'work' && c.shiftId === 'tarde')).toBe(true);
    expect(countGaps(config, floatTeam, floating)).toBeLessThan(countGaps(config, fixedTeam, fixed));
    // Só os dias de trabalho em turno cadastrado levam o turno na célula; folgas e turno único não.
    for (const [d, c] of floating.nova.entries()) {
      if (c.shiftId) {
        expect(c.status).toBe('work');
        expect(weekdayOf(d)).not.toBe(SUNDAY);
      }
    }
    expect(forbiddenAlerts(config, floatTeam, floating)).toEqual([]);
  });

  it('no exemplo, a Rosi cobre o balcão da tarde em folgas do Pedro sem ficar com menos de 11h de descanso', () => {
    const real = siteExample(new Date('2026-11-14'));
    const schedule = generateSchedule(real);
    // Ela vai para a tarde numa folga do Pedro quando o dia seguinte não a obriga a abrir às 06:15;
    // nas outras, o Lucas cobre o balcão da tarde pela segunda área.
    const pedroOff = schedule.pedro.flatMap((c, d) => (c.status === 'off' && weekdayOf(d) !== SUNDAY ? [d] : []));
    expect(pedroOff.some((d) => schedule.rosi[d].shiftId === 'tarde')).toBe(true);
    expect(countGaps(real.config, real.employees, schedule)).toBe(0);
    const reports = evaluateRules({ ...real, schedule });
    expect(Object.values(reports).flatMap((r) => r.alerts)).toEqual([]);
    expect(reports.rosi.warnings.filter((w) => w.kind === 'intershift-rest')).toEqual([]);
  });
});
