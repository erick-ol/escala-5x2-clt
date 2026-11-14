import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../domain/coverage';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { planLunches } from '../../domain/lunch';
import { projectMonth } from '../../domain/month';
import { evaluateRules } from '../../domain/rules';
import { formatDuration, formatTime } from '../../domain/time';
import { CYCLE_DAYS, type AppDocument } from '../../domain/types';
import { buildPersonalModel, buildPersonalModels, personalDayText, type PersonalModel } from './personalModel';

const TODAY = new Date('2026-11-14T12:00:00Z');
const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Exemplo completo (com segunda área), ciclo começando em 30/11, feriado no Natal e dois ajustes de data. */
function doc(): AppDocument {
  const base = exampleDocument(TODAY);
  const schedule = generateSchedule({ config: base.config, employees: base.employees });
  return {
    ...base,
    schedule,
    calendar: {
      cycleStart: '2026-11-30',
      closedDates: ['2026-12-25'],
      dateOverrides: [
        { date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } },
        {
          date: '2026-12-03',
          employeeId: 'andreza',
          cell: { status: 'work', hours: { start: h(8), end: h(16), breakMinutes: 60, breakStart: h(12) } },
        },
      ],
    },
  };
}

const days = (m: PersonalModel) => m.weeks.flatMap((w) => w.days);
const cycle = { kind: 'cycle' } as const;
const december = { kind: 'month', year: 2026, month: 12 } as const;

describe('escala por funcionário — ciclo', () => {
  it('cabeçalho com loja, pessoa, função, segunda área, turno do cadastro e período', () => {
    const andreza = buildPersonalModel(doc(), 'andreza', cycle)!;
    expect(andreza.storeName).toBe('Mercado do exemplo');
    expect(andreza.name).toBe('Andreza');
    expect(andreza.roleLine).toBe('Caixa · cobre balconista quando preciso');
    expect(andreza.shiftLine).toBe('Manhã · 06:30–14:00 · 1h de almoço');
    expect(andreza.periodLabel).toBe('Ciclo de 3 semanas a partir de 30/11/2026');
    expect(andreza.fileName).toBe('escala-andreza-ciclo.png');
    expect(andreza.shareTitle).toBe('Escala de Andreza — Ciclo de 3 semanas a partir de 30/11/2026');

    const rosa = buildPersonalModel(doc(), 'rosa', cycle)!;
    expect(rosa.roleLine).toBe('Balconista');
    expect(rosa.shiftLine).toBe('Manhã · 05:45–13:30 · 1h de almoço');
  });

  it('uma linha por dia com horário e almoço do plano, folgas e turno único no domingo', () => {
    const d = doc();
    const { config, employees, schedule, marks } = d;
    const coverage = computeCoverage({ config, employees, schedule: schedule!, marks });
    const plan = planLunches({ config, employees, schedule: schedule!, flex: coverage.flex, extraShifts: coverage.extraShifts });

    for (const model of buildPersonalModels(d, cycle)) {
      expect(model.weeks.map((w) => w.label)).toEqual(['Semana 1', 'Semana 2', 'Semana 3']);
      const list = days(model);
      expect(list).toHaveLength(CYCLE_DAYS);
      expect(list[0].label).toBe('Semana 1 · Seg');
      expect(list[20].label).toBe('Semana 3 · Dom');
      const e = employees.find((x) => x.id === model.employeeId)!;
      list.forEach((day, i) => {
        const cell = schedule![e.id][i];
        if (cell.status === 'off') {
          expect(day.text).toBe('Folga');
          return;
        }
        expect(cell.status).toBe('work');
        const lunch = plan[e.id][i]!;
        const lunchText = `almoço ${formatTime(lunch)}–${formatTime(lunch + 60)}`;
        if (i % 7 === 6) {
          // Domingo do exemplo: turno único no horário da loja, 15 min de intervalo.
          expect(day.text).toBe(`Turno único 07:00–13:00 · almoço ${formatTime(lunch)}–${formatTime(lunch + 15)}`);
        } else {
          expect(day.text).toContain(lunchText);
        }
      });
    }
    // Alguém trabalha num domingo do ciclo (turno único).
    const sundays = buildPersonalModels(d, cycle).flatMap((m) => [6, 13, 20].map((i) => days(m)[i].text));
    expect(sundays.some((t) => t.startsWith('Turno único 07:00–13:00 · almoço'))).toBe(true);
  });

  it('marca "cobre balconista" nos dias em que a pessoa vai para a segunda área', () => {
    const d = doc();
    const coverage = computeCoverage({ config: d.config, employees: d.employees, schedule: d.schedule!, marks: [] });
    expect(coverage.flex.length).toBeGreaterThan(0);
    for (const model of buildPersonalModels(d, cycle)) {
      const flexDays = new Set(coverage.flex.filter((f) => f.employeeId === model.employeeId).map((f) => f.day));
      days(model).forEach((day, i) => expect(day.note).toBe(flexDays.has(i) ? 'cobre balconista' : undefined));
    }
  });

  it('almoço com horário escolhido (breakStart) sai como informado', () => {
    const d = doc();
    const row = d.schedule!.richard;
    const day = row.findIndex((c, i) => c.status === 'work' && i % 7 !== 6);
    row[day] = { status: 'work', hours: { start: h(7), end: h(15), breakMinutes: 60, breakStart: h(11, 30) } };
    expect(days(buildPersonalModel(d, 'richard', cycle)!)[day].text).toBe('07:00–15:00 · almoço 11:30–12:30');
  });

  it('total da semana bate com as horas trabalhadas das regras', () => {
    const d = doc();
    const reports = evaluateRules({ config: d.config, employees: d.employees, schedule: d.schedule! });
    for (const model of buildPersonalModels(d, cycle)) {
      model.weeks.forEach((w, i) => {
        expect(w.minutes).toBe(reports[model.employeeId].weeklyMinutes[i]);
        expect(w.total).toBe(formatDuration(w.minutes));
      });
    }
    expect(buildPersonalModel(d, 'andreza', cycle)!.weeks[0].total).toBe('32h30');
  });

  it('jornada extra de quem cobre uma vaga aparece no dia e entra no total', () => {
    const d = doc();
    const employees = d.employees.filter((e) => e.id !== 'pedro').map((e) => ({ ...e, secondaryRoleId: undefined }));
    const schedule = generateSchedule({ config: d.config, employees });
    const richardDay = schedule.richard.findIndex((c, i) => c.status === 'work' && i % 7 !== 6);
    const withExtra: AppDocument = {
      ...d,
      employees,
      schedule,
      marks: [{ day: richardDay, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'richard' } }],
    };
    const richard = buildPersonalModel(withExtra, 'richard', cycle)!;
    const day = days(richard)[richardDay];
    expect(day.extras).toHaveLength(1);
    expect(day.extras[0]).toMatch(/^Cobre balconista · Tarde 13:00–20:30 · almoço \d{2}:\d{2}–\d{2}:\d{2}$/);
    const without = buildPersonalModel({ ...withExtra, marks: [] }, 'richard', cycle)!;
    const week = Math.floor(richardDay / 7);
    expect(richard.weeks[week].minutes - without.weeks[week].minutes).toBe(6.5 * 60);
  });

  it('nunca mostra alertas, buracos de outras pessoas nem "Funcionária mulher"', () => {
    const d = doc();
    d.schedule!.andreza = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'work' as const }));
    d.marks = [{ day: 0, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } }];
    const reports = evaluateRules({ config: d.config, employees: d.employees, schedule: d.schedule! });
    const messages = reports.andreza.alerts.map((a) => a.message);
    expect(messages.length).toBeGreaterThan(0);
    for (const scope of [cycle, december]) {
      const text = JSON.stringify(buildPersonalModels(d, scope));
      expect(text).not.toMatch(/mulher|isWoman|alerta|Falta|Dono\/família/i);
      for (const m of messages) expect(text).not.toContain(m);
    }
  });
});

describe('escala por funcionário — mês', () => {
  it('semanas reais do mês com datas, totais e período', () => {
    const d = doc();
    const andreza = buildPersonalModel(d, 'andreza', december)!;
    expect(andreza.periodLabel).toBe('Dezembro de 2026');
    expect(andreza.fileName).toBe('escala-andreza-dezembro-2026.png');
    expect(andreza.shareTitle).toBe('Escala de Andreza — Dezembro de 2026');
    expect(andreza.weeks.map((w) => w.label)).toEqual([
      'Semana de 30/11',
      'Semana de 07/12',
      'Semana de 14/12',
      'Semana de 21/12',
      'Semana de 28/12',
    ]);
    const list = days(andreza);
    expect(list[0].label).toBe('Seg 30/11');
    expect(list[0].outside).toBe(true);
    expect(list[1].label).toBe('Ter 01/12');
    expect(list[1].outside).toBeUndefined();
    expect(list[list.length - 1]).toMatchObject({ label: 'Dom 03/01', outside: true });

    // Totais iguais aos da projeção do mês (mesmas regras da visão Mês).
    const projection = projectMonth(d, 2026, 12)!;
    for (const model of buildPersonalModels(d, december)) {
      model.weeks.forEach((w, i) => expect(w.minutes).toBe(projection.reports[model.employeeId].weeklyMinutes[i]));
    }
  });

  it('feriado, ajustes da data e almoço informado no ajuste', () => {
    const d = doc();
    const models = buildPersonalModels(d, december);
    for (const m of models) {
      const christmas = days(m).find((x) => x.label === 'Sex 25/12')!;
      expect(christmas).toMatchObject({ kind: 'holiday', text: 'Feriado' });
    }
    const rosa = models.find((m) => m.employeeId === 'rosa')!;
    expect(days(rosa).find((x) => x.label === 'Qua 02/12')).toMatchObject({ kind: 'off', text: 'Folga' });
    const andreza = models.find((m) => m.employeeId === 'andreza')!;
    expect(days(andreza).find((x) => x.label === 'Qui 03/12')!.text).toBe('08:00–16:00 · almoço 12:00–13:00');
    // O mesmo dia do ciclo em outra semana segue o horário do cadastro.
    const cycleText = days(buildPersonalModel(d, 'andreza', cycle)!)[3].text;
    expect(cycleText).toMatch(/^06:30–14:00 · almoço/);
    // Total da semana do Natal: um dia a menos para quem trabalharia na sexta.
    expect(andreza.weeks[3].minutes).toBeLessThan(andreza.weeks[2].minutes);
  });

  it('turno único no domingo e "cobre" na segunda área também nas datas', () => {
    const models = buildPersonalModels(doc(), december);
    const texts = models.flatMap((m) => days(m).filter((x) => x.label.startsWith('Dom')).map((x) => x.text));
    expect(texts.some((t) => /^Turno único 07:00–13:00 · almoço \d{2}:\d{2}–\d{2}:\d{2}$/.test(t))).toBe(true);
    expect(models.flatMap(days).some((x) => personalDayText(x).includes('cobre balconista'))).toBe(true);
  });

  it('sem escala, não há escalas individuais', () => {
    const base = exampleDocument(TODAY);
    expect(buildPersonalModels(base, cycle)).toEqual([]);
    expect(buildPersonalModel(base, 'andreza', december)).toBeNull();
  });
});
