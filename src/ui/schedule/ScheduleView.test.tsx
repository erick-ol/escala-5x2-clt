import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import type { AppDocument, Schedule } from '../../domain/types';
import { appStore } from '../../state/store';
import { ScheduleView } from './ScheduleView';

vi.mock('../../domain/generator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../domain/generator')>();
  return { ...mod, generateSchedule: vi.fn(mod.generateSchedule) };
});

const TODAY = new Date('2026-11-14T12:00:00');
const doc = () => appStore.getState().document;

/** Exemplo do mercado com a escala gerada; `tweak` ajusta o documento antes de gravar. */
function seed(tweak?: (d: AppDocument, s: Schedule) => void) {
  const d = exampleDocument(TODAY);
  const schedule = generateSchedule({ config: d.config, employees: d.employees });
  tweak?.(d, schedule);
  appStore.getState().replaceDocument({ ...d, schedule });
}

/**
 * Um único buraco: balconista à tarde no sábado da semana 2 (Pedro de folga).
 * João (caixa à tarde) está de folga nesse dia.
 */
function seedSingleGap() {
  seed((d, s) => {
    d.config.minimums = [
      { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
      { roleId: 'caixa', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
      { roleId: 'balconista', shiftId: 'tarde', perWeekday: [0, 0, 0, 0, 0, 1, 0] },
    ];
    s.pedro = s.pedro.map((c, day) => (day === 5 || day === 19 ? { status: 'work' } : day === 12 ? { status: 'off' } : c));
  });
}

function renderView() {
  const onExport = vi.fn();
  render(<ScheduleView onExport={onExport} />);
  return { onExport, user: userEvent.setup() };
}

const coverage = () => screen.getByRole('region', { name: 'Cobertura' });
const cell = (name: RegExp) => screen.getByRole('button', { name });
function hoursOf(name: string) {
  const row = screen.getByRole('rowheader', { name }).closest('[role="row"]') as HTMLElement;
  return row.querySelector('.wg-hours .mono')?.textContent;
}

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
  appStore.setState({ storageAvailable: true });
});

describe('ScheduleView', () => {
  test('AE1: mudar a Rosa para 05:45–13:30 em "Todos os dias" atualiza só as horas dela', async () => {
    seed((d) => {
      const rosa = d.employees.find((e) => e.id === 'rosa')!;
      delete rosa.customHours; // começa no padrão do turno (06:30–14:00, 1h)
    });
    const { user } = renderView();
    expect(hoursOf('Rosa')).toBe('32h30');
    expect(hoursOf('Andreza')).toBe('32h30');

    await user.click(cell(/^Rosa, segunda, semana 1: trabalha manhã 06:30–14:00/));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    fireEvent.change(within(sheet).getByLabelText('Entrada'), { target: { value: '05:45' } });
    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '13:30' } });
    await user.click(within(sheet).getByRole('button', { name: 'Todos os dias' }));

    expect(doc().employees.find((e) => e.id === 'rosa')!.customHours).toEqual({ start: 345, end: 810, breakMinutes: 60 });
    expect(hoursOf('Rosa')).toBe('33h45');
    expect(hoursOf('Andreza')).toBe('32h30');
    expect(hoursOf('Richard')).toBe('32h30');
    expect(cell(/^Rosa, terça, semana 1: trabalha manhã 05:45–13:30$/)).toBeInTheDocument();
    expect(cell(/^Andreza, segunda, semana 1: trabalha manhã 06:30–14:00$/)).toBeInTheDocument();
  });

  test('"Só este dia" grava o ajuste na célula; horário inválido mostra o motivo e não é aplicado', async () => {
    seed();
    const { user } = renderView();
    await user.click(cell(/^Andreza, segunda, semana 1:/));
    const sheet = screen.getByRole('dialog', { name: 'Andreza' });
    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '06:30' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Entrada e saída não podem ser iguais.');
    expect(within(sheet).queryByRole('button', { name: 'Só este dia' })).not.toBeInTheDocument();

    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '12:30' } });
    await user.click(within(sheet).getByRole('button', { name: 'Só este dia' }));
    expect(doc().schedule!.andreza[0].hours).toEqual({ start: 390, end: 750, breakMinutes: 60 });
    expect(doc().employees.find((e) => e.id === 'andreza')!.customHours).toBeUndefined();
  });

  test('trocar uma folga recalcula na hora o resumo e o contador; "Desfazer" reverte', async () => {
    seed();
    const { user } = renderView();
    expect(within(coverage()).getByText(/buracos por semana/)).not.toHaveTextContent('quarta');
    expect(screen.getByText('Nenhum alerta legal')).toBeInTheDocument();

    await user.click(cell(/^Rosa, quarta, semana 1: trabalha/));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    await user.click(within(sheet).getByRole('button', { name: 'Folga' }));

    expect(doc().schedule!.rosa[2].status).toBe('off');
    expect(within(coverage()).getByText(/buracos por semana/)).toHaveTextContent('quarta');
    expect(screen.getByRole('button', { name: /^\d+ alertas? lega/ })).toBeInTheDocument();
    expect(cell(/^Rosa, quarta, semana 1: folga/)).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Desfazer' }));
    expect(doc().schedule!.rosa[2].status).toBe('work');
    expect(within(coverage()).getByText(/buracos por semana/)).not.toHaveTextContent('quarta');
    expect(screen.getByText('Nenhum alerta legal')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Desfazer' })).toBeDisabled();
  });

  test('o painel fecha com Esc e devolve o foco à célula', async () => {
    seed();
    const { user } = renderView();
    const target = cell(/^Rosa, quarta, semana 1:/);
    await user.click(target);
    expect(screen.getByRole('dialog', { name: 'Rosa' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(target).toHaveFocus();
  });

  test('setas movem o foco entre as células da grade', async () => {
    seed();
    const { user } = renderView();
    const start = cell(/^Andreza, segunda, semana 1:/);
    start.focus();
    await user.keyboard('{ArrowRight}');
    expect(cell(/^Andreza, terça, semana 1:/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(cell(/^Richard, terça, semana 1:/)).toHaveFocus();
  });

  test('F3: "coberto por mim/família" tira o item do resumo e "Desfazer marcação" devolve', async () => {
    seedSingleGap();
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    expect(within(coverage()).getByText('1 buraco por semana: balconista à tarde, sábado')).toBeInTheDocument();

    await user.click(cell(/^Balconista, tarde, sábado, semana 2: falta 1 pessoa$/));
    await user.click(screen.getByRole('button', { name: 'Coberto por mim/família' }));
    expect(within(coverage()).getByText('Tudo coberto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sugestões/ })).not.toBeInTheDocument();
    expect(doc().marks).toEqual([{ day: 12, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } }]);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    await user.click(cell(/^Balconista, tarde, sábado, semana 2: coberto por Dono\/família$/));
    await user.click(screen.getByRole('button', { name: 'Desfazer marcação' }));
    expect(doc().marks).toEqual([]);
    expect(within(coverage()).getByText('1 buraco por semana: balconista à tarde, sábado')).toBeInTheDocument();
  });

  test('AE3b: "Coberto por João" pela folha do buraco atualiza o resumo e as horas do João', async () => {
    seedSingleGap();
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    expect(hoursOf('João')).toBe('32h30');

    await user.click(cell(/^Balconista, tarde, sábado, semana 2: falta/));
    const sheet = screen.getByRole('dialog');
    const options = within(sheet).getAllByRole('button', { name: /, (de folga|trabalha)/ });
    expect(options[0]).toHaveAccessibleName(/de folga$/); // quem está de folga aparece primeiro
    await user.click(within(sheet).getByRole('button', { name: 'João, de folga' }));

    expect(within(coverage()).getByText('Tudo coberto')).toBeInTheDocument();
    expect(hoursOf('João')).toBe('39h');
    expect(cell(/^Balconista, tarde, sábado, semana 2: coberto por João$/)).toBeInTheDocument();
    expect(cell(/^João, sábado, semana 2: folga, cobre Balconista tarde/)).toBeInTheDocument();
  });

  test('"Regerar" com ajustes pede confirmação; cancelar mantém e confirmar apaga ajustes e marcações', async () => {
    seed();
    const { user } = renderView();
    await user.click(cell(/^Rosa, quarta, semana 1:/));
    await user.click(screen.getByRole('button', { name: 'Folga' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('button', { name: 'Regerar' }));
    const dialog = screen.getByRole('dialog', { name: 'Regerar a escala?' });
    expect(dialog).toHaveTextContent('marcações de cobertura');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(doc().schedule!.rosa[2].status).toBe('off');

    await user.click(screen.getByRole('button', { name: 'Regerar' }));
    await user.click(screen.getByRole('button', { name: 'Regerar e perder ajustes' }));
    expect(doc().schedule!.rosa[2].status).toBe('work');
    expect(doc().marks).toEqual([]);
  });

  test('o seletor alterna entre as semanas 1, 2 e 3', async () => {
    seed();
    const { user } = renderView();
    expect(screen.getByRole('button', { name: 'Semana 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(cell(/^Rosa, segunda, semana 1:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    expect(screen.getByRole('grid', { name: 'Escala da semana 2' })).toBeInTheDocument();
    expect(cell(/^Rosa, segunda, semana 2:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Rosa, segunda, semana 1:/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Semana 3' }));
    expect(cell(/^Rosa, domingo, semana 3:/)).toBeInTheDocument();
  });

  test('alertas não bloqueiam a exportação', async () => {
    seed((_, s) => {
      s.rosa = s.rosa.map(() => ({ status: 'work' }));
    });
    const { user, onExport } = renderView();
    expect(screen.getByRole('button', { name: /alertas legais/ })).toBeInTheDocument();
    const exportar = screen.getByRole('button', { name: 'Exportar' });
    expect(exportar).toBeEnabled();
    await user.click(exportar);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  test('tocar no indicador de alerta lista a regra e o dia e destaca a célula', async () => {
    seed((_, s) => {
      s.rosa[0] = { status: 'work', hours: { start: 360, end: 960, breakMinutes: 60 } }; // 9h no dia
    });
    const { user } = renderView();
    expect(cell(/^Rosa, segunda, semana 1: trabalha manhã 06:00–16:00, horário ajustado neste dia, 1 alerta legal$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 alerta de Rosa na semana 1' }));
    const list = screen.getByRole('dialog', { name: 'Rosa · semana 1' });
    const item = within(list).getByRole('button', { name: /limite de 8h/ });
    expect(item).toHaveTextContent('Rosa · Segunda, semana 1');

    await user.click(item);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const target = cell(/^Rosa, segunda, semana 1:/);
    expect(target).toHaveFocus();
    expect(target).toHaveClass('is-highlighted');
  });

  test('o contador geral abre a lista completa e leva à semana do alerta', async () => {
    seed((_, s) => {
      s.pedro[16] = { status: 'work', hours: { start: 360, end: 1020, breakMinutes: 60 } }; // quarta, semana 3
    });
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: /^1 alerta legal/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Pedro · Quarta, semana 3/ }));
    expect(screen.getByRole('button', { name: 'Semana 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(cell(/^Pedro, quarta, semana 3:/)).toHaveFocus();
  });

  test('marcação sem buraco correspondente é removida depois de uma edição (KTD15)', async () => {
    seedSingleGap();
    appStore.getState().setMarks([{ day: 12, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } }]);
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    await user.click(cell(/^Pedro, sábado, semana 2: folga/));
    await user.click(screen.getByRole('button', { name: 'Trabalha' }));
    expect(doc().marks).toEqual([]);
  });

  test('sem escala mostra "Gerar escala"; se o gerador falhar, mostra o erro e "Tentar de novo"', async () => {
    const d = exampleDocument(TODAY);
    appStore.getState().replaceDocument(d);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(generateSchedule).mockImplementationOnce(() => {
      throw new Error('falhou');
    });
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível gerar a escala');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    spy.mockRestore();
  });

  test('o resumo abre as sugestões com "buracos: X → Y no ciclo"', async () => {
    seed();
    const { user } = renderView();
    const toggle = within(coverage()).getByRole('button', { expanded: false });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(coverage()).getAllByText(/Contratar 1 balconista/).length).toBeGreaterThan(0);
    expect(within(coverage()).getAllByText(/buracos: \d+ → \d+ no ciclo/).length).toBeGreaterThan(0);
  });

  test('a região aria-live anuncia o resumo e o total de alertas', () => {
    seed();
    renderView();
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toMatch(/buracos por semana.*Nenhum alerta legal\./);
    act(() => appStore.getState().setCell('rosa', 2, { status: 'off' }));
    expect(live.textContent).toMatch(/quarta.*alertas? lega/);
  });
});
