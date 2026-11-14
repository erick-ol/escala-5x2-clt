import { exampleDocument } from './example';
import { generateSchedule } from './generator';
import { reconcileDocument } from './reconcile';
import { evaluateRules } from './rules';
import type { AppDocument } from './types';

function generated(): AppDocument {
  const doc = exampleDocument(new Date('2026-11-14'));
  return { ...doc, schedule: generateSchedule({ config: doc.config, employees: doc.employees }) };
}

describe('reconcileDocument', () => {
  test('documento coerente volta inalterado (mesma referência)', () => {
    const doc = generated();
    expect(reconcileDocument(doc)).toBe(doc);
  });

  test('domingo passou a fechado: células de domingo viram "loja fechada" e sem alerta de rodízio', () => {
    const doc = generated();
    doc.schedule!.richard = doc.schedule!.richard.map((c, day) => (day % 7 === 6 ? { status: 'work' } : c));
    const closed: AppDocument = {
      ...doc,
      config: { ...doc.config, days: doc.config.days.map((d, w) => (w === 6 ? { ...d, open: false } : d)) },
    };
    const out = reconcileDocument(closed);
    for (const row of Object.values(out.schedule!)) {
      expect([6, 13, 20].map((d) => row[d].status)).toEqual(['closed', 'closed', 'closed']);
    }
    const reports = evaluateRules({ config: out.config, employees: out.employees, schedule: out.schedule! });
    expect(reports.richard.alerts.filter((a) => a.kind === 'sunday-rotation')).toHaveLength(0);
  });

  test('dia que reabriu deixa de ser "loja fechada" e a pessoa é reencaixada com 2 folgas por semana', () => {
    const base = exampleDocument(new Date('2026-11-14'));
    const closedSunday = { ...base.config, days: base.config.days.map((d, w) => (w === 6 ? { ...d, open: false } : d)) };
    const doc: AppDocument = {
      ...base,
      config: closedSunday,
      schedule: generateSchedule({ config: closedSunday, employees: base.employees }),
    };
    const reopened = reconcileDocument({ ...doc, config: base.config });
    const reports = evaluateRules({ config: base.config, employees: base.employees, schedule: reopened.schedule! });
    for (const row of Object.values(reopened.schedule!)) {
      expect(row.some((c) => c.status === 'closed')).toBe(false);
    }
    for (const r of Object.values(reports)) {
      expect(r.alerts.filter((a) => a.kind === 'days-off' || a.kind === 'too-many-offs')).toHaveLength(0);
    }
  });

  test('ajuste de turno que aponta para turno removido é descartado', () => {
    const doc = generated();
    const day = doc.schedule!.andreza.findIndex((c) => c.status === 'work');
    doc.schedule!.andreza[day] = { status: 'work', shiftId: 'noite', hours: { start: 1200, end: 1380, breakMinutes: 15 } };
    const out = reconcileDocument(doc);
    expect(out.schedule!.andreza[day]).toEqual({ status: 'work' });
  });

  test('funcionário sem linha ganha uma; linha de quem saiu é removida', () => {
    const doc = generated();
    delete doc.schedule!.pedro;
    doc.schedule!.fantasma = doc.schedule!.rosa;
    const out = reconcileDocument(doc);
    expect(out.schedule!.pedro).toHaveLength(21);
    expect(out.schedule!.fantasma).toBeUndefined();
  });

  test('marcações de quem saiu ou de turno removido são descartadas', () => {
    const doc = generated();
    doc.marks = [
      { day: 1, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'ninguem' } },
      { day: 1, shiftId: 'noite', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
      { day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
    ];
    expect(reconcileDocument(doc).marks).toHaveLength(1);
  });
});
