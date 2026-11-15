import { countGaps } from './coverage';
import { generateSchedule } from './generator';
import { applyRestFix, restFixes } from './restFixes';
import { evaluateRules } from './rules';
import type { Schedule } from './types';
import { detailedMarketDocument } from '../test/fixtures';

const doc = detailedMarketDocument(new Date('2026-11-14'));
const { config, employees } = doc;
const base = generateSchedule({ config, employees });

const restWarnings = (schedule: Schedule) =>
  Object.values(evaluateRules({ config, employees, schedule })).flatMap((r) => r.warnings.filter((w) => w.kind === 'intershift-rest'));
const alerts = (schedule: Schedule) => Object.values(evaluateRules({ config, employees, schedule })).flatMap((r) => r.alerts);

describe('ajustes para aviso de 11h', () => {
  test('cada ajuste diminui os avisos sem abrir buraco nem criar alerta legal', () => {
    const warnings = restWarnings(base);
    expect(warnings.length).toBeGreaterThan(0);
    let offered = 0;
    for (const w of warnings) {
      for (const fix of restFixes({ config, employees, schedule: base }, w)) {
        offered++;
        const next = applyRestFix(base, fix.changes);
        expect(fix.warningsAfter).toBeLessThan(fix.warningsBefore);
        expect(restWarnings(next).length, fix.text).toBeLessThan(warnings.length);
        expect(countGaps(config, employees, next), fix.text).toBeLessThanOrEqual(countGaps(config, employees, base));
        expect(alerts(next), fix.text).toEqual([]);
      }
    }
    expect(offered).toBeGreaterThan(0);
  });

  test('quem fecha e abre no dia seguinte: sugere mudar de turno ou trocar com um colega', () => {
    // Rosi na tarde (até 20:45) num dia e na manhã (06:15) no seguinte.
    const day = base.rosi.findIndex((c, d) => c.status === 'work' && base.rosi[d + 1]?.status === 'work' && d % 7 !== 6 && d % 7 !== 0);
    const schedule = applyRestFix(base, [{ employeeId: 'rosi', day, cell: { status: 'work', shiftId: 'tarde' } }, { employeeId: 'rosi', day: day + 1, cell: { status: 'work', shiftId: 'manha' } }]);
    const warning = restWarnings(schedule).find((w) => w.employeeId === 'rosi' && w.day === day + 1);
    expect(warning).toBeDefined();
    const fixes = restFixes({ config, employees, schedule }, warning!);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].warningsAfter).toBe(0);
    expect(fixes.length).toBeLessThanOrEqual(3);
  });

  test('aviso que não é de 11h não tem ajuste', () => {
    expect(restFixes({ config, employees, schedule: base }, { kind: 'weekly-rest', employeeId: 'joao', day: null, week: 0, message: '' })).toEqual([]);
  });
});
