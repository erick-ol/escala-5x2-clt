import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { computeCoverage } from '../../domain/coverage';
import { WEEKDAY_NAMES, type AppDocument, type Cell, type Schedule } from '../../domain/types';
import { appStore } from '../../state/store';
import { deriveAll } from '../../state/useDerived';
import { formatTime } from '../../domain/time';
import { ScheduleView } from './ScheduleView';

vi.mock('../../domain/generator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../domain/generator')>();
  return { ...mod, generateSchedule: vi.fn(mod.generateSchedule) };
});

const TODAY = new Date('2026-11-14T12:00:00');
const doc = () => appStore.getState().document;

/**
 * Exemplo do mercado com a escala gerada; `tweak` ajusta o documento antes de gravar.
 * Sem segunda área: estes testes verificam buracos e alertas, e a cobertura flexível
 * (Andreza/João como balconistas) taparia os buracos que eles precisam ver.
 */
function seed(tweak?: (d: AppDocument, s: Schedule) => void, { secondary = true } = {}) {
  const d = exampleDocument(TODAY);
  if (!secondary) for (const e of d.employees) delete e.secondaryRoleId;
  const schedule = generateSchedule({ config: d.config, employees: d.employees });
  tweak?.(d, schedule);
  appStore.getState().replaceDocument({ ...d, schedule });
}

/** Linha de 21 células a partir de um desenho como "WWWW.W." × 3 (W = trabalha, . = folga). */
function row(pattern: string): Cell[] {
  const days = pattern.replace(/\s/g, '');
  expect(days).toHaveLength(21);
  return [...days].map((ch) => ({ status: ch === 'W' ? 'work' : 'off' }));
}

/**
 * Um único buraco: balconista à tarde no sábado da semana 2 (dia 12, Pedro de folga).
 * A equipe da tarde é montada à mão (não depende do gerador): João (caixa à tarde) folga sáb+dom
 * todas as semanas, Lucas cobre o caixa nesses dias e Pedro trabalha nos sábados das semanas 1 e 3.
 * Sem segunda área, para ninguém tapar o buraco por conta própria.
 */
function seedSingleGap() {
  seed(
    (d, s) => {
      d.config.minimums = [
        { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'caixa', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'balconista', shiftId: 'tarde', perWeekday: [0, 0, 0, 0, 0, 1, 0] },
      ];
      s.pedro = row('WWWW.W. WWWWW.. WWWW.W.');
      s.joao = row('WWWWW.. WWWWW.. WWWWW..');
      s.lucas = row('W..WWWW W..WWWW W..WWWW');
    },
    { secondary: false },
  );
}

/**
 * Dia da semana 1 em que a Rosa trabalha e cuja folga abre um buraco novo no resumo
 * (lido da escala gerada, sem fixar o dia da semana).
 */
function rosaDayThatOpensGap(): { day: number; weekday: string } {
  const { config, employees, schedule, marks } = doc();
  const headline = (s: Schedule) => computeCoverage({ config, employees, schedule: s, marks }).headline;
  const before = headline(schedule!);
  for (let day = 0; day < 7; day++) {
    if (schedule!.rosa[day].status !== 'work') continue;
    const weekday = WEEKDAY_NAMES[day].toLowerCase();
    if (before.includes(weekday)) continue;
    const after = headline({ ...schedule!, rosa: schedule!.rosa.map((c, i) => (i === day ? { status: 'off' } : c)) });
    if (after.includes(weekday)) return { day, weekday };
  }
  throw new Error('Nenhum dia da Rosa abre buraco novo na semana 1');
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
    const { day, weekday } = rosaDayThatOpensGap();
    const { user } = renderView();
    expect(within(coverage()).getByText(/buracos? por semana/)).not.toHaveTextContent(weekday);
    expect(screen.getByText('Nenhum alerta legal')).toBeInTheDocument();

    await user.click(cell(new RegExp(`^Rosa, ${weekday}, semana 1: trabalha`)));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    await user.click(within(sheet).getByRole('button', { name: 'Folga' }));

    expect(doc().schedule!.rosa[day].status).toBe('off');
    expect(within(coverage()).getByText(/buracos? por semana/)).toHaveTextContent(weekday);
    expect(screen.getByRole('button', { name: /^\d+ alertas? lega/ })).toBeInTheDocument();
    expect(cell(new RegExp(`^Rosa, ${weekday}, semana 1: folga`))).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Desfazer' }));
    expect(doc().schedule!.rosa[day].status).toBe('work');
    expect(within(coverage()).getByText(/buracos? por semana/)).not.toHaveTextContent(weekday);
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
    let weekday = '';
    seed((_, s) => {
      // Primeiro dia da semana 3 em que o Pedro (tarde) trabalha: 13:00–23:00 com 1h = 9h, acima do limite diário.
      // Começa no horário da tarde, então o descanso entre jornadas não muda.
      const day = s.pedro.findIndex((c, i) => i >= 14 && c.status === 'work');
      weekday = WEEKDAY_NAMES[day - 14];
      s.pedro[day] = { status: 'work', hours: { start: 780, end: 1380, breakMinutes: 60 } };
    });
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: /^1 alerta legal/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: new RegExp(`Pedro · ${weekday}, semana 3`) }));
    expect(screen.getByRole('button', { name: 'Semana 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(cell(new RegExp(`^Pedro, ${weekday.toLowerCase()}, semana 3:`))).toHaveFocus();
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
    const { day, weekday } = rosaDayThatOpensGap();
    renderView();
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toMatch(/buracos? por semana.*Nenhum alerta legal\./);
    act(() => appStore.getState().setCell('rosa', day, { status: 'off' }));
    expect(live.textContent).toMatch(new RegExp(`${weekday}.*alertas? lega`));
  });
});

describe('ScheduleView: semana por função e visão do dia', () => {
  /** Nomes das linhas (grupos e pessoas) na ordem da grade. */
  const rowHeaders = () => screen.getAllByRole('rowheader').map((h) => h.getAttribute('aria-label') ?? h.textContent);

  test('uma semana por vez, agrupada pela função principal, com turno e horas de cada pessoa', () => {
    seed();
    renderView();
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Semana 1' })).toHaveAttribute('aria-pressed', 'true');
    const order = rowHeaders().filter((n) => !n?.startsWith('Vagas faltantes'));
    expect(order).toEqual(['Caixa', 'Andreza', 'Richard', 'Lucas', 'João', 'Balconista', 'Rosa', 'Pedro']);
    const rosa = screen.getByRole('rowheader', { name: 'Rosa' }).closest('[role="row"]') as HTMLElement;
    expect(rosa).toHaveTextContent('Manhã 05:45–13:30');
    expect(rosa).toHaveTextContent('33h45');
    expect(screen.getByText(/Toque no dia/)).toBeInTheDocument();
  });

  test('as faltas ficam sob a função, uma linha por turno', async () => {
    seedSingleGap();
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    const order = rowHeaders();
    const gapRow = order.indexOf('Vagas faltantes: Balconista, tarde');
    expect(gapRow).toBeGreaterThan(order.indexOf('Pedro'));
    expect(gapRow).toBeGreaterThan(order.indexOf('Balconista'));
    expect(screen.getByRole('rowheader', { name: 'Vagas faltantes: Balconista, tarde' })).toHaveTextContent('Tarde');
  });

  test('o cabeçalho do dia abre a visão do dia com barras e almoço; "Voltar" devolve o foco ao dia', async () => {
    seed();
    const d = doc();
    const derived = deriveAll(d, d.schedule!);
    const blocks = derived.presence(1);
    expect(blocks.length).toBeGreaterThan(0);
    const { user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Terça, dia 2 do ciclo: ver o dia' }));
    expect(screen.getByRole('heading', { name: 'Terça, dia 2 — Semana 1' })).toHaveFocus();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    for (const b of blocks) {
      const name = d.employees.find((e) => e.id === b.employeeId)!.name;
      const bar = screen.getByRole('button', { name: new RegExp(`^${name}: ${formatTime(b.start)}–${formatTime(b.end)}`) });
      const group = bar.closest('[role="group"]') as HTMLElement;
      expect(group).toHaveAccessibleName(d.config.roles.find((r) => r.id === b.roleId)!.name);
      if (b.breakStart !== null && b.breakEnd !== null) {
        const lunch = `Almoço ${formatTime(b.breakStart)}–${formatTime(b.breakEnd)}`;
        expect(bar).toHaveAccessibleName(new RegExp(lunch.toLowerCase()));
        expect(bar.querySelector('.dt-lunch')).not.toBeNull();
        expect(bar.closest('li')).toHaveTextContent(lunch);
        if (b.breakPlanned) expect(bar.closest('li')).toHaveTextContent('(sugerido)');
      }
    }
    const offToday = d.employees.filter((e) => d.schedule![e.id][1].status === 'off').map((e) => e.name);
    if (offToday.length > 0) expect(screen.getByText('De folga:').parentElement).toHaveTextContent(offToday.join(', '));

    await user.click(screen.getByRole('button', { name: /^Próximo dia: Quarta, dia 3/ }));
    expect(screen.getByRole('heading', { name: 'Quarta, dia 3 — Semana 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Voltar para a semana/ }));
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarta, dia 3 do ciclo: ver o dia' })).toHaveFocus();
  });

  test('tocar numa barra da visão do dia abre o painel de edição da pessoa', async () => {
    seed();
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Segunda, dia 1 do ciclo: ver o dia' }));
    await user.click(screen.getByRole('button', { name: /^Andreza: 06:30–14:00/ }));
    expect(screen.getByRole('dialog', { name: 'Andreza' })).toHaveTextContent('Semana 1 · Segunda');
  });

  test('falta de cobertura no almoço aparece em laranja na faixa da função, com o texto', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    expect(lunchGaps.length).toBeGreaterThan(0);
    const gap = lunchGaps[0];
    const role = d.config.roles.find((r) => r.id === gap.roleId)!.name;
    const { user } = renderView();
    if (gap.day >= 7) await user.click(screen.getByRole('button', { name: `Semana ${Math.floor(gap.day / 7) + 1}` }));
    await user.click(screen.getByRole('button', { name: new RegExp(`^${WEEKDAY_NAMES[gap.day % 7]}, dia ${gap.day + 1} do ciclo`) }));

    const group = screen.getByRole('group', { name: role });
    const text = `Falta${gap.missing > 1 ? 'm' : ''} ${gap.missing} ${role.toLowerCase()}${gap.missing > 1 ? 's' : ''} no almoço ${formatTime(gap.from)}–${formatTime(gap.to)}`;
    expect(within(group).getByText(text)).toBeInTheDocument();
    const sameDayRole = lunchGaps.filter((g) => g.day === gap.day && g.roleId === gap.roleId).length;
    const segments = group.querySelectorAll<HTMLElement>('.dt-strip-gap');
    expect(segments.length).toBeGreaterThanOrEqual(sameDayRole);
    expect(segments[0].style.left).toMatch(/%$/);
  });

  test('almoço sem cobertura pode ser assumido pelo dono/família, sai do resumo e pode ser desfeito', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    const gap = lunchGaps.find((g) => g.day < 7)!;
    const week1Before = lunchGaps.filter((g) => g.day < 7).length;
    const role = d.config.roles.find((r) => r.id === gap.roleId)!.name;
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${WEEKDAY_NAMES[gap.day % 7]}, dia ${gap.day + 1} do ciclo`) }));
    const group = screen.getByRole('group', { name: role });
    const line = within(group).getByText(`Falta${gap.missing > 1 ? 'm' : ''} ${gap.missing} ${role.toLowerCase()}${gap.missing > 1 ? 's' : ''} no almoço ${formatTime(gap.from)}–${formatTime(gap.to)}`);
    await user.click(within(line.closest('li')!).getByRole('button', { name: 'Coberto por mim/família' }));

    expect(doc().lunchMarks).toEqual([{ day: gap.day, roleId: gap.roleId, from: gap.from, to: gap.to }]);
    const covered = within(group).getByText(`Dono/família cobre ${role.toLowerCase()} no almoço ${formatTime(gap.from)}–${formatTime(gap.to)}`);
    expect(covered).toBeInTheDocument();
    const after = deriveAll(doc(), doc().schedule!);
    expect(after.lunchGaps.filter((g) => g.day < 7)).toHaveLength(week1Before - 1);
    expect(after.coveredLunchGaps).toHaveLength(1);

    await user.click(within(covered.closest('li')!).getByRole('button', { name: 'Desfazer' }));
    expect(doc().lunchMarks).toEqual([]);
  });

  test('marcação de almoço que não bate mais com nenhum buraco é removida', async () => {
    seed();
    appStore.getState().setLunchMarks([{ day: 0, roleId: 'balconista', from: 1, to: 2 }]);
    renderView();
    await waitFor(() => expect(doc().lunchMarks).toEqual([]));
  });

  test('o resumo mostra o almoço sem cobertura numa segunda linha que abre o dia', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    const week1 = lunchGaps.filter((g) => g.day < 7);
    expect(week1.length).toBeGreaterThan(0);
    const { user } = renderView();
    const line = within(coverage()).getByRole('button', { name: /Almoço sem cobertura/ });
    expect(line).toHaveTextContent(`Almoço sem cobertura: ${week1.length} ${week1.length === 1 ? 'vez' : 'vezes'} na semana 1`);
    await user.click(line);
    const first = Math.min(...week1.map((g) => g.day));
    expect(screen.getByRole('heading', { name: `${WEEKDAY_NAMES[first]}, dia ${first + 1} — Semana 1` })).toBeInTheDocument();
  });

  test('"Almoço (início)" vem com o horário planejado e "Só este dia" grava breakStart na célula', async () => {
    seed();
    const d = doc();
    const planned = deriveAll(d, d.schedule!).lunchPlan.andreza[0];
    expect(planned).not.toBeNull();
    const { user } = renderView();
    await user.click(cell(/^Andreza, segunda, semana 1:/));
    const sheet = screen.getByRole('dialog', { name: 'Andreza' });
    const field = within(sheet).getByLabelText('Almoço (início)');
    expect(field).toHaveValue(formatTime(planned!));

    fireEvent.change(field, { target: { value: '13:00' } });
    expect(sheet).toHaveTextContent('O almoço começa mais de 6h depois da entrada');
    fireEvent.change(field, { target: { value: '10:00' } });
    expect(sheet).not.toHaveTextContent('mais de 6h depois da entrada');
    await user.click(within(sheet).getByRole('button', { name: 'Só este dia' }));
    expect(doc().schedule!.andreza[0].hours).toEqual({ start: 390, end: 840, breakMinutes: 60, breakStart: 600 });
    expect(doc().employees.find((e) => e.id === 'andreza')!.customHours).toBeUndefined();
    expect(within(sheet).getByLabelText('Almoço (início)')).toHaveValue('10:00');
  });

  test('"Todos os dias" grava o início do almoço no cadastro', async () => {
    seed();
    const { user } = renderView();
    await user.click(cell(/^Richard, terça, semana 1:/));
    const sheet = screen.getByRole('dialog', { name: 'Richard' });
    fireEvent.change(within(sheet).getByLabelText('Almoço (início)'), { target: { value: '11:15' } });
    await user.click(within(sheet).getByRole('button', { name: 'Todos os dias' }));
    expect(doc().employees.find((e) => e.id === 'richard')!.customHours).toEqual({
      start: 390,
      end: 840,
      breakMinutes: 60,
      breakStart: 675,
    });
  });
});
