import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDays } from '../../domain/dates';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { WEEKDAY_NAMES, type AppDocument } from '../../domain/types';
import { appStore } from '../../state/store';
import { weekdayOf } from '../../domain/time';
import { ScheduleView } from './ScheduleView';

const START = '2026-11-29';
const doc = () => appStore.getState().document;

/** Exemplo com escala gerada e o ciclo começando no domingo 29/11/2026. */
function seed(tweak?: (d: AppDocument) => void) {
  const base = exampleDocument(new Date('2026-11-14T12:00:00'));
  const d: AppDocument = {
    ...base,
    schedule: generateSchedule({ config: base.config, employees: base.employees }),
    calendar: { cycleStart: START, closedDates: [], dateOverrides: [] },
  };
  tweak?.(d);
  appStore.getState().replaceDocument(d);
}

async function openMonth() {
  const onExport = vi.fn();
  const user = userEvent.setup();
  render(<ScheduleView onExport={onExport} />);
  await user.click(screen.getByRole('button', { name: 'Mês' }));
  return { user, onExport };
}

/** Primeiro dia da semana 1 do ciclo (0 = domingo 29/11) em que a Rosa trabalha, com a data em dezembro. */
function rosaWorkDay() {
  const i = doc().schedule!.rosa.findIndex((c, day) => day >= 2 && day < 7 && c.status === 'work');
  const date = addDays(START, i);
  return { i, date, dm: `${date.slice(8, 10)}/${date.slice(5, 7)}`, weekday: WEEKDAY_NAMES[weekdayOf(i)].toLowerCase() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-10T12:00:00') });
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
  appStore.setState({ storageAvailable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Visão Mês', () => {
  test('"Mês" mostra o mês de hoje com as semanas em datas reais e a semana do ciclo', async () => {
    seed();
    await openMonth();
    expect(screen.getByRole('button', { name: 'Mês' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Dezembro de 2026' })).toBeInTheDocument();
    expect(screen.getByText(/O ciclo começa em:/)).toHaveTextContent('O ciclo começa em: domingo, 29/11/2026');
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      '29/11 – 05/12 · Semana 1 do ciclo',
      '06/12 – 12/12 · Semana 2 do ciclo',
      '13/12 – 19/12 · Semana 3 do ciclo',
      '20/12 – 26/12 · Semana 1 do ciclo',
      '27/12 – 02/01 · Semana 2 do ciclo',
    ]);
    const first = screen.getByRole('grid', { name: 'Escala de 29/11 a 05/12' });
    // Colunas de domingo a sábado, com as datas reais.
    const heads = within(first)
      .getAllByRole('columnheader')
      .slice(1)
      .map((h) => h.querySelector('.wg-dayhead-name')?.textContent);
    expect(heads).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    expect(within(first).getByRole('button', { name: /^Domingo, 29\/11, turno único, fora do mês: opções da data$/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /^Segunda, 30\/11, fora do mês: opções da data$/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /^Sábado, 05\/12: opções da data$/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /^Terça, 01\/12: opções da data$/ })).toBeInTheDocument();
    // A visão Ciclo continua igual.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ciclo' }));
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
  });

  test('trocar de mês recalcula as semanas', async () => {
    seed();
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(screen.getByRole('heading', { name: 'Janeiro de 2027' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Escala de 27/12 a 02/01' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('27/12 – 02/01 · Semana 2 do ciclo');
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(screen.getByRole('heading', { name: 'Novembro de 2026' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Escala de 01/11 a 07/11' })).toBeInTheDocument();
  });

  test('editar uma célula no mês grava um ajuste só da data, sem mudar o ciclo; "Voltar ao ciclo" desfaz', async () => {
    seed();
    const cycleBefore = doc().schedule;
    const { date, dm, weekday } = rosaWorkDay();
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: new RegExp(`^Rosa, ${weekday} ${dm}: trabalha`) }));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    expect(sheet).toHaveTextContent(`Só nesta data (${dm}); o ciclo não muda.`);
    expect(within(sheet).queryByRole('button', { name: 'Todos os dias' })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Folga' }));
    expect(doc().calendar.dateOverrides).toEqual([{ date, employeeId: 'rosa', cell: { status: 'off' } }]);
    expect(doc().schedule).toBe(cycleBefore);
    expect(sheet).toHaveTextContent('Ajustado nesta data.');

    await user.click(within(sheet).getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('button', { name: new RegExp(`^Rosa, ${weekday} ${dm}: folga, ajustado nesta data`) })).toBeInTheDocument();
    // 21 dias depois (mesmo dia do ciclo), continua trabalhando.
    const later = addDays(date, 21);
    expect(
      screen.getByRole('button', { name: new RegExp(`^Rosa, ${weekday} ${later.slice(8, 10)}/12: trabalha`) }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: new RegExp(`^Rosa, ${weekday} ${dm}: folga`) }));
    await user.click(screen.getByRole('button', { name: 'Voltar ao ciclo' }));
    expect(doc().calendar.dateOverrides).toEqual([]);
    expect(doc().schedule).toBe(cycleBefore);
  });

  test('ajustar o horário no mês vale só nesta data', async () => {
    seed();
    const { date, dm, weekday } = rosaWorkDay();
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: new RegExp(`^Rosa, ${weekday} ${dm}: trabalha`) }));
    const entrada = screen.getByLabelText('Entrada');
    await user.clear(entrada);
    await user.type(entrada, '0700');
    await user.click(screen.getByRole('button', { name: 'Só nesta data' }));
    expect(doc().calendar.dateOverrides).toEqual([
      { date, employeeId: 'rosa', cell: expect.objectContaining({ status: 'work', hours: expect.objectContaining({ start: 7 * 60 }) }) },
    ]);
    expect(doc().employees.find((e) => e.id === 'rosa')!.customHours?.start).toBe(5 * 60 + 45);
  });

  test('marcar a data como feriado fecha a loja para todos só nela', async () => {
    seed();
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: /^Terça, 08\/12: opções da data$/ }));
    const sheet = screen.getByRole('dialog', { name: 'Terça, 08/12/2026' });
    await user.click(within(sheet).getByRole('checkbox', { name: 'Loja fechada nesta data (feriado)' }));
    expect(doc().calendar.closedDates).toEqual(['2026-12-08']);
    await user.click(within(sheet).getByRole('button', { name: 'Fechar' }));

    expect(screen.getByRole('button', { name: /^Terça, 08\/12, fechado \(feriado\): opções da data$/ })).toBeInTheDocument();
    for (const name of doc().employees.map((e) => e.name)) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}, terça 08/12: fechado \\(feriado\\)`) })).toBeInTheDocument();
    }
    // Outras terças continuam abertas.
    expect(screen.queryByRole('button', { name: /^Rosa, terça 15\/12: fechado/ })).not.toBeInTheDocument();
    // "Ver o dia" na data mostra a visão do dia com a data real.
    await user.click(screen.getByRole('button', { name: /^Terça, 08\/12, fechado/ }));
    await user.click(screen.getByRole('button', { name: 'Ver o dia' }));
    expect(screen.getByRole('heading', { name: 'Terça, 08/12/2026 — Semana 2 do ciclo' })).toBeInTheDocument();
    expect(screen.getByText('Loja fechada nesta data (feriado).')).toBeInTheDocument();
  });

  test('mudar o início do ciclo leva para o domingo e muda a projeção', async () => {
    seed();
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: 'alterar' }));
    fireEvent.change(screen.getByLabelText('Início do ciclo (domingo)'), { target: { value: '2026-12-09' } });
    expect(doc().calendar.cycleStart).toBe('2026-12-06');
    expect(screen.getByText(/O ciclo começa em:/)).toHaveTextContent('O ciclo começa em: domingo, 06/12/2026');
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('29/11 – 05/12 · Semana 3 do ciclo');
    expect(screen.getAllByRole('heading', { level: 3 })[1]).toHaveTextContent('06/12 – 12/12 · Semana 1 do ciclo');
  });

  test('alertas do mês usam datas e o resumo conta só o mês', async () => {
    seed((d) => {
      // Rosa trabalha de domingo 06/12 a sábado 12/12 sem folga: semana sem os 2 dias de descanso.
      d.calendar.dateOverrides = Array.from({ length: 7 }, (_, i) => ({
        date: addDays('2026-12-06', i),
        employeeId: 'rosa',
        cell: { status: 'work' as const },
      }));
    });
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: /^\d+ alertas? legais?/ }));
    const list = screen.getByRole('dialog', { name: /alertas? no mês/ });
    expect(list).toHaveTextContent('Rosa · Semana de 06/12');
    expect(list).toHaveTextContent('Semana de 06/12 com 0 dias sem trabalho (mínimo 2)');
  });

  test('regerar apaga os ajustes de data e mantém início do ciclo e feriados', async () => {
    seed((d) => {
      d.calendar.closedDates = ['2026-12-25'];
      d.calendar.dateOverrides = [{ date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } }];
    });
    const { user } = await openMonth();
    await user.click(screen.getByRole('button', { name: 'Regerar' }));
    const dialog = screen.getByRole('dialog', { name: 'Regerar a escala?' });
    expect(dialog).toHaveTextContent('ajustes de datas do mês');
    expect(dialog).toHaveTextContent('o início do ciclo no calendário e os feriados');
    await user.click(within(dialog).getByRole('button', { name: 'Regerar e perder ajustes' }));
    expect(doc().calendar).toEqual({ cycleStart: START, closedDates: ['2026-12-25'], dateOverrides: [] });
  });

  test('"Exportar" na visão Mês envia o mês mostrado', async () => {
    seed();
    const { user, onExport } = await openMonth();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(onExport).toHaveBeenCalledWith({ year: 2026, month: 12 });
  });
});
