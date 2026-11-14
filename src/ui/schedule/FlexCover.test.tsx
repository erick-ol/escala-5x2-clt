import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeCoverage } from '../../domain/coverage';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { WEEKDAY_NAMES, type AppDocument } from '../../domain/types';
import { appStore } from '../../state/store';
import { buildExportModel } from '../export/exportModel';
import { weekdayOf } from '../../domain/time';
import { ScheduleView } from './ScheduleView';

const TODAY = new Date('2026-11-14T12:00:00');

/** Exemplo do mercado com a escala gerada (Andreza e João têm segunda área balconista). */
function seedExample(strip = false): AppDocument {
  const d = exampleDocument(TODAY);
  if (strip) for (const e of d.employees) delete e.secondaryRoleId;
  const schedule = generateSchedule({ config: d.config, employees: d.employees });
  const doc = { ...d, schedule };
  appStore.getState().replaceDocument(doc);
  return doc;
}

const flexOf = (doc: AppDocument) =>
  computeCoverage({ config: doc.config, employees: doc.employees, schedule: doc.schedule!, marks: doc.marks }).flex;

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
  appStore.setState({ storageAvailable: true });
});

describe('segunda área na escala (dados reais do exemplo)', () => {
  test('quem cobre balconista mostra "→ Balc." na célula, "cobrindo Balconista" no aria-label e "Neste dia cobre" no painel', async () => {
    const doc = seedExample();
    // Na semana 1 do exemplo, Andreza ou João cobrem balconista em algum dia.
    const flex = flexOf(doc).filter((f) => f.day < 7);
    expect(flex.length).toBeGreaterThan(0);
    expect(flex.every((f) => ['andreza', 'joao'].includes(f.employeeId) && f.roleId === 'balconista')).toBe(true);

    render(<ScheduleView onExport={() => {}} />);
    const user = userEvent.setup();

    for (const f of flex) {
      const name = doc.employees.find((e) => e.id === f.employeeId)!.name;
      const weekday = WEEKDAY_NAMES[weekdayOf(f.day)].toLowerCase();
      const btn = screen.getByRole('button', { name: new RegExp(`^${name}, ${weekday}, semana 1: trabalha .*cobrindo Balconista`) });
      expect(btn).toHaveTextContent('→ Balc.');
    }
    // Só as células em `flex` levam o marcador.
    expect(screen.getAllByRole('button', { name: /cobrindo Balconista/ })).toHaveLength(flex.length);
    expect(screen.getByLabelText('Legenda')).toHaveTextContent('cobrindo outra função');

    const first = flex[0];
    const name = doc.employees.find((e) => e.id === first.employeeId)!.name;
    await user.click(screen.getByRole('button', { name: new RegExp(`^${name}, ${WEEKDAY_NAMES[weekdayOf(first.day)].toLowerCase()}, semana 1:`) }));
    expect(screen.getByText('Neste dia cobre: Balconista')).toBeInTheDocument();
  });

  test('sem segunda área, nenhuma célula mostra o marcador', () => {
    const doc = seedExample(true);
    expect(flexOf(doc)).toEqual([]);
    render(<ScheduleView onExport={() => {}} />);
    expect(document.querySelector('.wg-flex')).toBeNull();
    expect(screen.queryByRole('button', { name: /cobrindo/ })).not.toBeInTheDocument();
  });

  test('exportação leva o marcador "→ Balc." exatamente nas células de quem cobre', () => {
    const doc = seedExample();
    const flex = flexOf(doc);
    expect(flex.length).toBeGreaterThan(0);
    const model = buildExportModel(doc);
    const marked = model.rows.flatMap((r) =>
      r.cells.flatMap((c, day) => (c.kind === 'work' && c.flex ? [{ employeeId: r.id, day, tag: c.flex }] : [])),
    );
    expect(marked).toEqual(
      expect.arrayContaining(flex.map((f) => ({ employeeId: f.employeeId, day: f.day, tag: '→ Balc.' }))),
    );
    expect(marked).toHaveLength(new Set(flex.map((f) => `${f.employeeId}|${f.day}`)).size);
  });
});
