import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { cellOnDate, monthDates, projectMonth } from '../../domain/month';
import { CYCLE_DAYS, type AppDocument } from '../../domain/types';
import { TEAM_CALENDAR_ONE_PAGE_MAX, buildTeamCalendar, personalCalendarWeeks, shortNames } from './calendarModel';
import { buildMonthExportModel } from './exportModel';
import { buildPersonalModel, buildPersonalModels } from './personalModel';

const TODAY = new Date('2026-11-14T12:00:00Z');
const h = (hh: number, mm = 0) => hh * 60 + mm;
const december = { kind: 'month', year: 2026, month: 12 } as const;

/** Exemplo com ciclo a partir de 29/11, feriado no Natal e dois ajustes de data. */
function doc(): AppDocument {
  const base = exampleDocument(TODAY);
  return {
    ...base,
    schedule: generateSchedule({ config: base.config, employees: base.employees }),
    calendar: {
      cycleStart: '2026-11-29',
      closedDates: ['2026-12-25'],
      dateOverrides: [
        { date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } },
        {
          date: '2026-12-02',
          employeeId: 'andreza',
          cell: { status: 'work', hours: { start: h(8), end: h(16), breakMinutes: 60, breakStart: h(12) } },
        },
      ],
    },
  };
}

/** Sem o único balconista da tarde e sem segunda área: sobra vaga todo dia nesse turno. */
function withGaps(): AppDocument {
  const d = doc();
  const employees = d.employees.filter((e) => e.id !== 'pedro').map((e) => ({ ...e, secondaryRoleId: undefined }));
  return { ...d, employees, schedule: generateSchedule({ config: d.config, employees }) };
}

const team = (d: AppDocument) => buildTeamCalendar(buildMonthExportModel(d, 2026, 12)!);

describe('calendário da equipe (mês)', () => {
  it('semanas de domingo a sábado com cada data do mês uma vez; fora do mês fica vazio', () => {
    const cal = team(doc());
    expect(cal.monthLabel).toBe('Dezembro de 2026');
    expect(cal.weeks.map((w) => w.sunday)).toEqual(['2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']);
    for (const w of cal.weeks) expect(w.days).toHaveLength(7);
    const days = cal.weeks.flatMap((w) => w.days);
    const inside = days.filter((d) => d.kind !== 'outside');
    expect(inside.map((d) => d.date)).toEqual(monthDates(2026, 12));
    expect(inside.map((d) => d.day)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    const outside = days.filter((d) => d.kind === 'outside');
    expect(outside.map((d) => d.date)).toEqual(['2026-11-29', '2026-11-30', '2027-01-01', '2027-01-02']);
    for (const d of outside) expect(d).toMatchObject({ groups: [], off: [], missing: [] });
    expect(cal.fileName).toBe('escala-mercado-do-exemplo-dezembro-2026.png');
    expect(cal.shareTitle).toBe('Mercado do exemplo — Dezembro de 2026');
  });

  it('cada dia lista quem trabalha por turno e quem folga, com feriado e ajuste da data', () => {
    const d = doc();
    const cal = team(d);
    const byDate = new Map(cal.weeks.flatMap((w) => w.days).map((x) => [x.date, x]));
    for (const date of monthDates(2026, 12)) {
      const day = byDate.get(date)!;
      if (date === '2026-12-25') {
        expect(day).toMatchObject({ kind: 'holiday', groups: [], off: [] });
        continue;
      }
      expect(day.kind).toBe('open');
      const working = day.groups.flatMap((g) => g.entries.map((e) => e.name));
      for (const e of d.employees) {
        const { cell } = cellOnDate(d, e.id, date);
        if (cell?.status === 'work') {
          expect(working).toContain(e.name);
          expect(day.off).not.toContain(e.name);
        } else if (cell?.status === 'off') {
          expect(day.off).toContain(e.name);
          expect(working).not.toContain(e.name);
        }
      }
    }
    // Terça 01/12: manhã antes da tarde, cada pessoa no turno do cadastro.
    const tuesday = byDate.get('2026-12-01')!;
    expect(tuesday.groups.map((g) => g.initial)).toEqual(['M', 'T']);
    for (const g of tuesday.groups) {
      for (const entry of g.entries) {
        const e = d.employees.find((x) => x.name === entry.name)!;
        expect(g.initial).toBe(e.shiftId === 'manha' ? 'M' : 'T');
      }
    }
    // Domingos do exemplo: turno único.
    for (const sunday of ['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']) {
      expect(byDate.get(sunday)!.groups.map((g) => g.initial)).toEqual(['U']);
    }
    // Ajuste da data: Rosa de folga na quarta 02/12.
    expect(byDate.get('2026-12-02')!.off).toContain('Rosa');
    // Segunda área: "→ Balc." ao lado do nome.
    expect(cal.hasFlex).toBe(true);
    expect(cal.weeks.flatMap((w) => w.days).some((x) => x.groups.some((g) => g.entries.some((e) => e.tag === '→ Balc.')))).toBe(
      true,
    );
  });

  it('vagas sem ninguém viram "Falta 1 balconista (T)"; coberturas entram no turno', () => {
    const d = withGaps();
    d.marks = [
      { day: 1, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
      { day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'richard' } },
    ];
    const cal = team(d);
    const byDate = new Map(cal.weeks.flatMap((w) => w.days).map((x) => [x.date, x]));
    expect(cal.hasMissing).toBe(true);
    // 30/11 e 01/12 caem nos dias 1 e 2 do ciclo; 01/12 (dia 2) coberto pelo Richard, 08/12 (dia 9) sem ninguém.
    const tarde = (date: string) => byDate.get(date)!.groups.find((g) => g.initial === 'T')!;
    expect(tarde('2026-12-01').entries).toContainEqual({ name: 'Richard', cover: 'employee' });
    expect(byDate.get('2026-12-01')!.missing).toEqual([]);
    expect(byDate.get('2026-12-08')!.missing).toEqual(['Falta 1 balconista (T)']);
    // 21/12 cai no dia 22 → dia 1 do ciclo (segunda da semana 1): dono/família.
    expect(tarde('2026-12-21').entries).toContainEqual({ name: 'Dono/família', cover: 'owner' });
    expect(cal.hasCoverer).toBe(true);
  });

  it('não leva alertas nem a marcação "Funcionária mulher"', () => {
    const d = withGaps();
    d.schedule!.andreza = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'work' as const }));
    const messages = projectMonth(d, 2026, 12)!.alerts.map((a) => a.message);
    expect(messages.length).toBeGreaterThan(0);
    const text = JSON.stringify(team(d));
    expect(text).not.toMatch(/mulher|isWoman|alerta/i);
    for (const m of messages) expect(text).not.toContain(m);
  });

  it('equipe pequena cabe numa página; equipe grande vai para duas, com as semanas divididas', () => {
    expect(team(doc()).printPages).toHaveLength(1);
    const d = doc();
    const extra = Array.from({ length: TEAM_CALENDAR_ONE_PAGE_MAX }, (_, i) => ({
      ...d.employees[i % d.employees.length],
      id: `extra${i}`,
      name: `Extra ${i + 1}`,
    }));
    const big: AppDocument = { ...d, employees: [...d.employees, ...extra] };
    big.schedule = generateSchedule({ config: big.config, employees: big.employees });
    const pages = team(big).printPages;
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.length)).toEqual([3, 2]);
  });

  it('nomes curtos: primeiro nome, inteiro quando repete', () => {
    const short = shortNames(['Ana Paula', 'Ana Clara', 'José da Silva', '  ']);
    expect(short.get('Ana Paula')).toBe('Ana Paula');
    expect(short.get('Ana Clara')).toBe('Ana Clara');
    expect(short.get('José da Silva')).toBe('José');
    expect(short.get('  ')).toBe('Sem nome');
  });
});

describe('calendário por funcionário (mês)', () => {
  it('semanas do modelo da pessoa com número do dia, partes do horário e total igual ao do modelo', () => {
    const d = doc();
    for (const model of buildPersonalModels(d, december)) {
      expect(model.month).toEqual({ year: 2026, month: 12 });
      const weeks = personalCalendarWeeks(model);
      expect(weeks).toHaveLength(5);
      weeks.forEach((w, i) => {
        expect(w.days).toHaveLength(7);
        expect(w.total).toBe(model.weeks[i].total);
        expect(w.minutes).toBe(model.weeks[i].minutes);
      });
      const inside = weeks.flatMap((w) => w.days).filter((x) => !x.outside);
      expect(inside.map((x) => x.day)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
      for (const x of inside) {
        if (x.info.kind !== 'work') continue;
        expect(x.info.range).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
        expect(x.info.lunch).toMatch(/^intervalo \d{2}:\d{2}–\d{2}:\d{2}$/);
        expect(x.info.text).toContain(x.info.range!);
        expect(x.info.text).toContain(x.info.lunch!);
      }
    }
    // Turno único marcado com a sigla da legenda da equipe; ajuste da data com o horário informado.
    const sundays = buildPersonalModels(d, december).flatMap((m) => m.weeks.map((w) => w.days[0]));
    expect(sundays.some((x) => x.kind === 'work' && x.shiftTag === 'U' && x.range === '07:00–13:00')).toBe(true);
    const andreza = buildPersonalModel(d, 'andreza', december)!;
    const dec2 = andreza.weeks.flatMap((w) => w.days).find((x) => x.date === '2026-12-02')!;
    expect(dec2).toMatchObject({ range: '08:00–16:00', lunch: 'intervalo 12:00–13:00' });
    expect(dec2.shiftTag).toBeUndefined();
  });
});
