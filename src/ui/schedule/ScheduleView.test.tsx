import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { referenceDocument as exampleDocument } from '../../test/fixtures';
import { generateSchedule } from '../../domain/generator';
import { computeCoverage } from '../../domain/coverage';
import { WEEKDAY_NAMES, type AppDocument, type Cell, type Schedule } from '../../domain/types';
import { appStore } from '../../state/store';
import { deriveAll } from '../../state/useDerived';
import { formatTime, weekdayOf } from '../../domain/time';
import { ScheduleView } from './ScheduleView';

vi.mock('../../domain/generator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../domain/generator')>();
  return { ...mod, generateSchedule: vi.fn(mod.generateSchedule) };
});

const TODAY = new Date('2026-11-14T12:00:00');
const doc = () => appStore.getState().document;

/**
 * Exemplo do mercado com a escala gerada; `tweak` ajusta o documento antes de gravar.
 * `singleShift`: mantém o domingo de turno único do exemplo (senão, domingo 06:30–20:30 em dois turnos).
 * Sem segunda área: estes testes verificam buracos e alertas, e a cobertura flexível
 * (Andreza/João como balconistas) taparia os buracos que eles precisam ver.
 */
function seed(tweak?: (d: AppDocument, s: Schedule) => void, { secondary = true, singleShift = false } = {}) {
  const d = exampleDocument(TODAY);
  if (!secondary) for (const e of d.employees) delete e.secondaryRoleId;
  // Por padrão, domingo igual aos outros dias (estes testes contam com os buracos do domingo em dois turnos).
  if (!singleShift) d.config.days = d.config.days.map(() => ({ open: true, opensAt: 390, closesAt: 1230, singleShift: false }));
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

/** Nome do dia da semana de um dia do ciclo (o dia 0 é domingo). */
const nameOf = (day: number) => WEEKDAY_NAMES[weekdayOf(day)];

/**
 * Primeiro dia da semana `week` em que a pessoa trabalha na escala gravada (sem fixar o dia da semana,
 * que depende do gerador).
 */
function workday(id: string, week = 0, skip = 0): { day: number; weekday: string; Weekday: string } {
  const s = doc().schedule!;
  let left = skip;
  for (let day = week * 7; day < week * 7 + 7; day++) {
    if (s[id][day].status !== 'work') continue;
    if (left-- > 0) continue;
    return { day, weekday: nameOf(day).toLowerCase(), Weekday: nameOf(day) };
  }
  throw new Error(`${id} não trabalha na semana ${week + 1}`);
}

/**
 * Um único buraco: balconista à tarde no sábado da semana 2 (dia 13, Pedro de folga).
 * A equipe da tarde é montada à mão (não depende do gerador), com semanas de domingo a sábado: João
 * (caixa à tarde) folga dom e sáb todas as semanas, Lucas cobre o caixa nesses dias e Pedro trabalha nos
 * sábados das semanas 1 e 3.
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
      s.pedro = row('.WWWW.W .WWWWW. .WWWW.W');
      s.joao = row('.WWWWW. .WWWWW. .WWWWW.');
      s.lucas = row('WW..WWW WW..WWW WW..WWW');
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
    const weekday = nameOf(day).toLowerCase();
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
    const rosaDay = workday('rosa');
    const rosaOther = workday('rosa', 0, 1);
    const andrezaDay = workday('andreza');
    const { user } = renderView();
    expect(hoursOf('Rosa')).toBe('32h30');
    expect(hoursOf('Andreza')).toBe('32h30');

    await user.click(cell(new RegExp(`^Rosa, ${rosaDay.weekday}, semana 1: trabalha manhã 06:30–14:00`)));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    fireEvent.change(within(sheet).getByLabelText('Entrada'), { target: { value: '05:45' } });
    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '13:30' } });
    await user.click(within(sheet).getByRole('button', { name: 'Todos os dias' }));

    expect(doc().employees.find((e) => e.id === 'rosa')!.customHours).toEqual({ start: 345, end: 810, breakMinutes: 60 });
    expect(hoursOf('Rosa')).toBe('33h45');
    expect(hoursOf('Andreza')).toBe('32h30');
    expect(hoursOf('Richard')).toBe('32h30');
    expect(cell(new RegExp(`^Rosa, ${rosaOther.weekday}, semana 1: trabalha manhã 05:45–13:30$`))).toBeInTheDocument();
    expect(cell(new RegExp(`^Andreza, ${andrezaDay.weekday}, semana 1: trabalha manhã 06:30–14:00`))).toBeInTheDocument();
  });

  test('"Só este dia" grava o ajuste na célula; horário inválido mostra o motivo e não é aplicado', async () => {
    seed();
    const { day, weekday } = workday('andreza');
    const { user } = renderView();
    await user.click(cell(new RegExp(`^Andreza, ${weekday}, semana 1:`)));
    const sheet = screen.getByRole('dialog', { name: 'Andreza' });
    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '06:30' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Entrada e saída não podem ser iguais.');
    expect(within(sheet).queryByRole('button', { name: 'Só este dia' })).not.toBeInTheDocument();

    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '12:30' } });
    await user.click(within(sheet).getByRole('button', { name: 'Só este dia' }));
    expect(doc().schedule!.andreza[day].hours).toEqual({ start: 390, end: 750, breakMinutes: 60 });
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

  test('descanso menor que 11h vira aviso de descanso, não alerta legal', async () => {
    seed((_, s) => {
      const row = s.lucas;
      const d = [...Array(6).keys()].find((x) => row[x].status === 'work' && row[x + 1].status === 'work')!;
      row[d] = { status: 'work', hours: { start: 13 * 60, end: 22 * 60, breakMinutes: 60 } };
      row[d + 1] = { status: 'work', hours: { start: 6 * 60, end: 14 * 60, breakMinutes: 60 } };
    });
    const { user } = renderView();
    expect(screen.queryByRole('button', { name: /alertas? lega/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^1 aviso de descanso/ }));
    const sheet = screen.getByRole('dialog', { name: /aviso no ciclo/ });
    expect(sheet).toHaveTextContent('Avisos de descanso');
    expect(sheet).toHaveTextContent('Descanso de 8h entre jornadas (mínimo 11h)');
    expect(sheet).toHaveTextContent('A CLT pede 11h de descanso');
  });

  test('aviso de 11h mostra ajustes e aplicar um deles tira o aviso', async () => {
    seed((d, s) => {
      const [first, last] = [d.config.shifts[0].id, d.config.shifts[d.config.shifts.length - 1].id];
      const row = s.andreza;
      const day = [...Array(6).keys()].find((x) => x > 0 && row[x].status === 'work' && row[x + 1].status === 'work')!;
      row[day] = { status: 'work', shiftId: last };
      row[day + 1] = { status: 'work', shiftId: first };
    });
    const { user } = renderView();
    const before = appStore.getState().document.schedule;
    await user.click(screen.getByRole('button', { name: /aviso(s)? de descanso/ }));
    const sheet = screen.getByRole('dialog', { name: /avisos? no ciclo/ });
    expect(sheet).toHaveTextContent(/Ajustes? possíve(l|is)/);
    const apply = within(sheet).getAllByRole('button', { name: /^Aplicar: / })[0];
    await user.click(apply);
    expect(appStore.getState().document.schedule).not.toBe(before);
    expect(screen.queryByRole('button', { name: /aviso(s)? de descanso/ })).not.toBeInTheDocument();
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
    expect(doc().marks).toEqual([{ day: 13, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } }]);
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
    const { day, weekday } = workday('rosa');
    const { user } = renderView();
    await user.click(cell(new RegExp(`^Rosa, ${weekday}, semana 1:`)));
    await user.click(screen.getByRole('button', { name: 'Folga' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    await user.click(screen.getByRole('button', { name: 'Regerar' }));
    const dialog = screen.getByRole('dialog', { name: 'Regerar a escala?' });
    expect(dialog).toHaveTextContent('marcações de cobertura');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(doc().schedule!.rosa[day].status).toBe('off');

    await user.click(screen.getByRole('button', { name: 'Regerar' }));
    await user.click(screen.getByRole('button', { name: 'Regerar e perder ajustes' }));
    expect(doc().schedule!.rosa[day].status).toBe('work');
    expect(doc().marks).toEqual([]);
  });

  test('a semana vai de domingo a sábado: cabeçalhos Dom … Sáb e o dia 1 do ciclo é domingo', () => {
    seed(undefined, { singleShift: true });
    renderView();
    const grid = screen.getByRole('grid', { name: 'Escala da semana 1' });
    const heads = within(grid)
      .getAllByRole('columnheader')
      .slice(1)
      .map((h) => h.querySelector('.wg-dayhead-name')?.textContent);
    expect(heads).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    expect(within(grid).getByRole('button', { name: 'Domingo, dia 1 do ciclo, turno único: ver o dia' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: 'Sábado, dia 7 do ciclo: ver o dia' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /^\d+ alertas legais/ })).toBeInTheDocument();
    const exportar = screen.getByRole('button', { name: 'Exportar' });
    expect(exportar).toBeEnabled();
    await user.click(exportar);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  test('tocar no indicador de alerta lista a regra e o dia e destaca a célula', async () => {
    let day = -1;
    seed((_, s) => {
      day = s.rosa.findIndex((c, i) => i < 7 && c.status === 'work');
      s.rosa[day] = { status: 'work', hours: { start: 360, end: 960, breakMinutes: 60 } }; // 9h no dia
    });
    const weekday = nameOf(day);
    const { user } = renderView();
    expect(
      cell(new RegExp(`^Rosa, ${weekday.toLowerCase()}, semana 1: trabalha manhã 06:00–16:00, horário ajustado neste dia, 1 alerta legal$`)),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 alerta de Rosa na semana 1' }));
    const list = screen.getByRole('dialog', { name: 'Rosa · semana 1' });
    const item = within(list).getByRole('button', { name: /limite de 8h/ });
    expect(item).toHaveTextContent(`Rosa · ${weekday}, semana 1`);

    await user.click(item);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const target = cell(new RegExp(`^Rosa, ${weekday.toLowerCase()}, semana 1:`));
    expect(target).toHaveFocus();
    expect(target).toHaveClass('is-highlighted');
  });

  test('o contador geral abre a lista completa e leva à semana do alerta', async () => {
    let weekday = '';
    seed((_, s) => {
      // Primeiro dia da semana 3 em que o Pedro (tarde) trabalha: 13:00–23:00 com 1h = 9h, acima do limite diário.
      // Começa no horário da tarde, então o descanso entre jornadas não muda.
      const day = s.pedro.findIndex((c, i) => i >= 14 && c.status === 'work');
      weekday = nameOf(day);
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
    appStore.getState().setMarks([{ day: 13, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } }]);
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Semana 2' }));
    await user.click(cell(/^Pedro, sábado, semana 2: folga/));
    await user.click(screen.getByRole('button', { name: 'Trabalha' }));
    expect(doc().marks).toEqual([]);
  });

  test('turno único no domingo do exemplo: célula "U" com o horário da loja e o dia marcado no cabeçalho', () => {
    seed(undefined, { singleShift: true });
    renderView();
    const s = doc().schedule!;
    const worker = doc().employees.find((e) => s[e.id][0].status === 'work')!;
    const btn = cell(new RegExp(`^${worker.name}, domingo, semana 1: trabalha turno único 07:00–13:00`));
    expect(btn.querySelector('.wg-shift')).toHaveTextContent('U');
    expect(btn.querySelector('.wg-time')).toHaveTextContent('07:00');
    expect(btn).not.toHaveClass('is-moved');
    expect(screen.getByRole('button', { name: /^Domingo, dia 1 do ciclo, turno único: ver o dia$/ })).toBeInTheDocument();
    // Sábado (último dia da semana) continua com os turnos do cadastro.
    const saturday = doc().employees.find((e) => e.shiftId === 'manha' && s[e.id][6].status === 'work')!;
    expect(cell(new RegExp(`^${saturday.name}, sábado, semana 1: trabalha manhã`)).querySelector('.wg-shift')).toHaveTextContent('M');
  });

  test('no domingo de turno único o painel mostra o turno só para leitura e "Todos os dias" desabilitado', async () => {
    seed(undefined, { singleShift: true });
    const { user } = renderView();
    const s = doc().schedule!;
    const rosaSunday = [0, 7, 14].find((d) => s.rosa[d].status === 'work')!;
    if (rosaSunday >= 7) await user.click(screen.getByRole('button', { name: `Semana ${Math.floor(rosaSunday / 7) + 1}` }));
    await user.click(cell(/^Rosa, domingo, semana \d: trabalha turno único 07:00–13:00/));
    const sheet = screen.getByRole('dialog', { name: 'Rosa' });
    expect(within(sheet).queryByLabelText('Turno')).not.toBeInTheDocument();
    expect(within(sheet).getByText(/^Turno único/)).toHaveTextContent('Turno único (07:00–13:00)');
    // O horário do cadastro da Rosa (05:45–13:30) não vale no turno único.
    expect(within(sheet).getByLabelText('Entrada')).toHaveValue('07:00');
    fireEvent.change(within(sheet).getByLabelText('Saída'), { target: { value: '12:00' } });
    expect(within(sheet).getByRole('button', { name: 'Todos os dias' })).toBeDisabled();
    expect(within(sheet).getByText(/Neste dia vale o turno único/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Só este dia' }));
    expect(doc().schedule!.rosa[rosaSunday].hours).toEqual({ start: 420, end: 720, breakMinutes: 15 });
    expect(doc().employees.find((e) => e.id === 'rosa')!.customHours).toEqual({ start: 345, end: 810, breakMinutes: 60 });
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

  test('o cabeçalho do dia abre a visão do dia com barras e intervalo; "Voltar" devolve o foco ao dia', async () => {
    seed();
    const d = doc();
    const derived = deriveAll(d, d.schedule!);
    const blocks = derived.presence(2);
    expect(blocks.length).toBeGreaterThan(0);
    const { user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Terça, dia 3 do ciclo: ver o dia' }));
    expect(screen.getByRole('heading', { name: 'Terça, dia 3 — Semana 1' })).toHaveFocus();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    for (const b of blocks) {
      const name = d.employees.find((e) => e.id === b.employeeId)!.name;
      const bar = screen.getByRole('button', { name: new RegExp(`^${name}: ${formatTime(b.start)}–${formatTime(b.end)}`) });
      const group = bar.closest('[role="group"]') as HTMLElement;
      expect(group).toHaveAccessibleName(d.config.roles.find((r) => r.id === b.roleId)!.name);
      if (b.breakStart !== null && b.breakEnd !== null) {
        const lunch = `Intervalo ${formatTime(b.breakStart)}–${formatTime(b.breakEnd)}`;
        expect(bar).toHaveAccessibleName(new RegExp(lunch.toLowerCase()));
        expect(bar.querySelector('.dt-lunch')).not.toBeNull();
        expect(bar.closest('li')).toHaveTextContent(lunch);
        if (b.breakPlanned) expect(bar.closest('li')).toHaveTextContent('(sugerido)');
      }
    }
    const offToday = d.employees.filter((e) => d.schedule![e.id][2].status === 'off').map((e) => e.name);
    if (offToday.length > 0) expect(screen.getByText('De folga:').parentElement).toHaveTextContent(offToday.join(', '));

    await user.click(screen.getByRole('button', { name: /^Próximo dia: Quarta, dia 4/ }));
    expect(screen.getByRole('heading', { name: 'Quarta, dia 4 — Semana 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Voltar para a semana/ }));
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarta, dia 4 do ciclo: ver o dia' })).toHaveFocus();
  });

  test('tocar numa barra da visão do dia abre o painel de edição da pessoa', async () => {
    seed();
    const { day, Weekday } = workday('andreza');
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: `${Weekday}, dia ${day + 1} do ciclo: ver o dia` }));
    await user.click(screen.getByRole('button', { name: /^Andreza: 06:30–14:00/ }));
    expect(screen.getByRole('dialog', { name: 'Andreza' })).toHaveTextContent(`Semana 1 · ${Weekday}`);
  });

  test('falta de cobertura no intervalo aparece em laranja na faixa da função, com o texto', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    expect(lunchGaps.length).toBeGreaterThan(0);
    const gap = lunchGaps[0];
    const role = d.config.roles.find((r) => r.id === gap.roleId)!.name;
    const { user } = renderView();
    if (gap.day >= 7) await user.click(screen.getByRole('button', { name: `Semana ${Math.floor(gap.day / 7) + 1}` }));
    await user.click(screen.getByRole('button', { name: new RegExp(`^${nameOf(gap.day)}, dia ${gap.day + 1} do ciclo`) }));

    const group = screen.getByRole('group', { name: role });
    const text = `Falta${gap.missing > 1 ? 'm' : ''} ${gap.missing} ${role.toLowerCase()}${gap.missing > 1 ? 's' : ''} no intervalo ${formatTime(gap.from)}–${formatTime(gap.to)}`;
    expect(within(group).getByText(text)).toBeInTheDocument();
    const sameDayRole = lunchGaps.filter((g) => g.day === gap.day && g.roleId === gap.roleId).length;
    const segments = group.querySelectorAll<HTMLElement>('.dt-strip-gap');
    expect(segments.length).toBeGreaterThanOrEqual(sameDayRole);
    expect(segments[0].style.left).toMatch(/%$/);
  });

  test('intervalo sem cobertura pode ser assumido pelo dono/família, sai do resumo e pode ser desfeito', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    const gap = lunchGaps.find((g) => g.day < 7)!;
    const week1Before = lunchGaps.filter((g) => g.day < 7).length;
    const role = d.config.roles.find((r) => r.id === gap.roleId)!.name;
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${nameOf(gap.day)}, dia ${gap.day + 1} do ciclo`) }));
    const group = screen.getByRole('group', { name: role });
    const line = within(group).getByText(`Falta${gap.missing > 1 ? 'm' : ''} ${gap.missing} ${role.toLowerCase()}${gap.missing > 1 ? 's' : ''} no intervalo ${formatTime(gap.from)}–${formatTime(gap.to)}`);
    await user.click(within(line.closest('li')!).getByRole('button', { name: 'Coberto por mim/família' }));

    expect(doc().lunchMarks).toEqual([{ day: gap.day, roleId: gap.roleId, from: gap.from, to: gap.to }]);
    const covered = within(group).getByText(`Dono/família cobre ${role.toLowerCase()} no intervalo ${formatTime(gap.from)}–${formatTime(gap.to)}`);
    expect(covered).toBeInTheDocument();
    const after = deriveAll(doc(), doc().schedule!);
    expect(after.lunchGaps.filter((g) => g.day < 7)).toHaveLength(week1Before - 1);
    expect(after.coveredLunchGaps).toHaveLength(1);

    await user.click(within(covered.closest('li')!).getByRole('button', { name: 'Desfazer' }));
    expect(doc().lunchMarks).toEqual([]);
  });

  test('marcação de intervalo que não bate mais com nenhum buraco é removida', async () => {
    seed();
    appStore.getState().setLunchMarks([{ day: 0, roleId: 'balconista', from: 1, to: 2 }]);
    renderView();
    await waitFor(() => expect(doc().lunchMarks).toEqual([]));
  });

  test('o resumo mostra o intervalo sem cobertura numa segunda linha que abre o dia', async () => {
    seed();
    const d = doc();
    const { lunchGaps } = deriveAll(d, d.schedule!);
    const week1 = lunchGaps.filter((g) => g.day < 7);
    expect(week1.length).toBeGreaterThan(0);
    const { user } = renderView();
    const line = within(coverage()).getByRole('button', { name: /Intervalo sem cobertura/ });
    expect(line).toHaveTextContent(`Intervalo sem cobertura: ${week1.length} ${week1.length === 1 ? 'vez' : 'vezes'} na semana 1`);
    await user.click(line);
    const first = Math.min(...week1.map((g) => g.day));
    expect(screen.getByRole('heading', { name: `${nameOf(first)}, dia ${first + 1} — Semana 1` })).toBeInTheDocument();
  });

  test('"Intervalo (início)" vem com o horário planejado e "Só este dia" grava breakStart na célula', async () => {
    seed();
    const d = doc();
    const { day, weekday } = workday('andreza');
    const planned = deriveAll(d, d.schedule!).lunchPlan.andreza[day];
    expect(planned).not.toBeNull();
    const { user } = renderView();
    await user.click(cell(new RegExp(`^Andreza, ${weekday}, semana 1:`)));
    const sheet = screen.getByRole('dialog', { name: 'Andreza' });
    const field = within(sheet).getByLabelText('Intervalo (início)');
    expect(field).toHaveValue(formatTime(planned!));

    fireEvent.change(field, { target: { value: '13:00' } });
    expect(sheet).toHaveTextContent('O intervalo começa mais de 6h depois da entrada');
    fireEvent.change(field, { target: { value: '10:00' } });
    expect(sheet).not.toHaveTextContent('mais de 6h depois da entrada');
    await user.click(within(sheet).getByRole('button', { name: 'Só este dia' }));
    expect(doc().schedule!.andreza[day].hours).toEqual({ start: 390, end: 840, breakMinutes: 60, breakStart: 600 });
    expect(doc().employees.find((e) => e.id === 'andreza')!.customHours).toBeUndefined();
    expect(within(sheet).getByLabelText('Intervalo (início)')).toHaveValue('10:00');
  });

  test('"Todos os dias" grava o início do intervalo no cadastro', async () => {
    seed();
    const { weekday } = workday('richard');
    const { user } = renderView();
    await user.click(cell(new RegExp(`^Richard, ${weekday}, semana 1:`)));
    const sheet = screen.getByRole('dialog', { name: 'Richard' });
    fireEvent.change(within(sheet).getByLabelText('Intervalo (início)'), { target: { value: '11:15' } });
    await user.click(within(sheet).getByRole('button', { name: 'Todos os dias' }));
    expect(doc().employees.find((e) => e.id === 'richard')!.customHours).toEqual({
      start: 390,
      end: 840,
      breakMinutes: 60,
      breakStart: 675,
    });
  });
});
