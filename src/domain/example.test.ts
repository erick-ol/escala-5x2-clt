import { computeCoverage } from './coverage';
import { EXAMPLES, exampleDocument } from './example';
import { generateSchedule } from './generator';
import { findLunchGaps, planLunches } from './lunch';
import { evaluateRules } from './rules';
import { dayOfWeekday } from './time';
import { SUNDAY, WEEKS } from './types';
import { validateRoles, validateShifts, validateStoreHours, validateTeam } from '../ui/setup/setupLogic';

describe('exemplos do site', () => {
  test('o padrão é o mercado; id desconhecido também cai no mercado', () => {
    expect(exampleDocument(new Date('2026-11-14')).config.name).toBe('Mercado do exemplo');
    expect(exampleDocument(new Date('2026-11-14'), 'nao-existe').config.name).toBe('Mercado do exemplo');
    expect(EXAMPLES.map((e) => e.id)).toEqual(['mercado', 'loja-de-roupas', 'padaria', 'farmacia', 'restaurante']);
  });

  // 2026: regime de 42h (transição); 2028: regime de 40h.
  for (const today of [new Date('2026-11-14T12:00:00'), new Date('2028-03-10T12:00:00')]) {
    for (const example of EXAMPLES) {
      test(`${example.label} (${today.getFullYear()}): configuração válida, escala sem buraco, sem alerta legal, sem aviso de 11h e sem intervalo descoberto`, () => {
        const doc = example.build(today);
        const { config, employees } = doc;
        expect(validateStoreHours(config)).toBeNull();
        expect(validateShifts(config)).toBeNull();
        expect(validateRoles(config)).toBeNull();
        expect(validateTeam(doc)).toBeNull();
        expect(example.summary).toContain(`${employees.length} pessoas`);

        const schedule = generateSchedule({ config, employees });
        const reports = Object.values(evaluateRules({ config, employees, schedule }));
        expect(reports.flatMap((r) => r.alerts).map((a) => `${a.employeeId}: ${a.message}`)).toEqual([]);
        expect(reports.flatMap((r) => r.warnings).map((w) => `${w.employeeId}: ${w.message}`)).toEqual([]);
        expect(computeCoverage({ config, employees, schedule, marks: [] }).gaps).toEqual([]);
        const lunchInput = { config, employees, schedule };
        expect(findLunchGaps(lunchInput, planLunches(lunchInput))).toEqual([]);
        if (config.days[SUNDAY].open) {
          for (const e of employees) {
            const worked = Array.from({ length: WEEKS }, (_, w) => schedule[e.id][dayOfWeekday(w, SUNDAY)].status === 'work');
            expect(worked.some(Boolean), e.name).toBe(true);
          }
        }
      });
    }
  }
});
