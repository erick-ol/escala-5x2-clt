import { computeCoverage } from './coverage';
import { exampleDocument } from './example';
import { generateSchedule } from './generator';
import { evaluateRules } from './rules';
import { dayOfWeekday, effectiveHours, requiredCount, virtualShiftId, workedMinutes } from './time';
import { SUNDAY, WEEKS } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('exemplo do site', () => {
  const doc = exampleDocument(new Date('2026-11-14'));
  const { config, employees } = doc;

  test('loja: 40h, folgas separadas, seg–sáb 06:15–20:45 e domingo 06:45–13:45 em turno único', () => {
    expect(config.regime).toBe('40h');
    expect(config.offPattern).toBe('flexible');
    for (let w = 0; w < 6; w++) expect(config.days[w]).toMatchObject({ open: true, opensAt: h(6, 15), closesAt: h(20, 45), singleShift: false });
    expect(config.days[6]).toMatchObject({ open: true, opensAt: h(6, 45), closesAt: h(13, 45), singleShift: true });
    expect(config.shifts).toEqual([
      { id: 'manha', name: 'Manhã', start: h(6, 15), end: h(15, 15), breakMinutes: 60 },
      { id: 'tarde', name: 'Tarde', start: h(11, 45), end: h(20, 45), breakMinutes: 60 },
    ]);
  });

  test('mínimos: 1 caixa e 1 balconista por turno, 2 balconistas no domingo, repositor sem mínimo', () => {
    const monday = 1;
    const sunday = 0;
    expect(requiredCount(config, monday, 'manha', 'caixa')).toBe(1);
    expect(requiredCount(config, monday, 'tarde', 'caixa')).toBe(1);
    expect(requiredCount(config, monday, 'manha', 'balconista')).toBe(1);
    expect(requiredCount(config, monday, 'tarde', 'balconista')).toBe(1);
    expect(requiredCount(config, monday, 'manha', 'repositor')).toBe(0);
    expect(requiredCount(config, sunday, virtualShiftId(6), 'balconista')).toBe(2);
    expect(requiredCount(config, sunday, virtualShiftId(6), 'caixa')).toBe(1);
    expect(requiredCount(config, sunday, virtualShiftId(6), 'repositor')).toBe(0);
  });

  test('equipe: 7 pessoas com função, turno, segunda área, horário próprio e marcação de mulher', () => {
    const by = Object.fromEntries(employees.map((e) => [e.name, e]));
    expect(Object.keys(by)).toEqual(['Andreza', 'Richard', 'Rosa', 'Pedro', 'Lucas', 'João', 'Rosi']);
    expect(by.Andreza).toMatchObject({ roleId: 'caixa', shiftId: 'manha', isWoman: true });
    expect(by.Andreza.secondaryRoleId).toBeUndefined();
    expect(by.Richard).toMatchObject({ roleId: 'repositor', shiftId: 'manha', secondaryRoleId: 'caixa', isWoman: false });
    expect(by.Rosa).toMatchObject({ roleId: 'balconista', shiftId: 'manha', isWoman: true, customHours: { start: h(5, 45), end: h(14, 45), breakMinutes: 60 } });
    expect(by.Rosa.secondaryRoleId).toBeUndefined();
    expect(by.Pedro).toMatchObject({ roleId: 'balconista', shiftId: 'tarde', isWoman: false });
    expect(by.Lucas).toMatchObject({ roleId: 'caixa', shiftId: 'tarde', secondaryRoleId: 'balconista', isWoman: false });
    expect(by.João).toMatchObject({ roleId: 'caixa', shiftId: 'tarde', isWoman: false });
    expect(by.João.secondaryRoleId).toBeUndefined();
    expect(by.Rosi).toMatchObject({ roleId: 'balconista', shiftId: 'manha', floating: true, isWoman: true });
  });

  test('turnos de 8h trabalhadas cabem nas 40h; o domingo de turno único tem 6h', () => {
    const rosa = employees.find((e) => e.id === 'rosa')!;
    expect(workedMinutes(effectiveHours(config, rosa, { status: 'work' }, 1)!)).toBe(8 * 60);
    expect(workedMinutes(effectiveHours(config, rosa, { status: 'work' }, 0)!)).toBe(6 * 60);
  });

  test('a escala gerada não tem alerta legal e ninguém fica com todos os domingos de folga', () => {
    const schedule = generateSchedule({ config, employees });
    const alerts = Object.values(evaluateRules({ config, employees, schedule })).flatMap((r) => r.alerts);
    expect(alerts.map((a) => `${a.employeeId}: ${a.message}`)).toEqual([]);
    for (const e of employees) {
      const worked = Array.from({ length: WEEKS }, (_, w) => schedule[e.id][dayOfWeekday(w, SUNDAY)].status === 'work');
      expect(worked.some(Boolean), e.name).toBe(true);
    }
    // O gerador não evita as 11h (viram aviso): quem fecha no sábado pode abrir o domingo, tudo coberto.
    expect(computeCoverage({ config, employees, schedule, marks: [] }).gaps).toEqual([]);
  });
});
