import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { requiredCount, virtualShiftId } from '../../domain/time';
import type { StoreConfig } from '../../domain/types';
import { appStore } from '../../state/store';
import { FirstVisit } from './FirstVisit';
import { SetupWizard } from './SetupWizard';

const h = (hh: number, mm = 0) => hh * 60 + mm;

function setConfig(patch: Partial<StoreConfig>) {
  appStore.getState().updateConfig(patch);
}

/** Loja 6:30–20:30, 2 turnos e uma função com mínimo 1, sem equipe. */
function seedThroughRoles() {
  setConfig({
    days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(6, 30), closesAt: h(20, 30) })),
    shifts: [
      { id: 'manha', name: 'Manhã', start: h(6, 30), end: h(13, 30), breakMinutes: 60 },
      { id: 'tarde', name: 'Tarde', start: h(13, 30), end: h(20, 30), breakMinutes: 60 },
    ],
    roles: [{ id: 'balconista', name: 'Balconista' }],
    minimums: [
      { roleId: 'balconista', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
      { roleId: 'balconista', shiftId: 'tarde', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
    ],
  });
}

const doc = () => appStore.getState().document;

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
});

describe('SetupWizard', () => {
  test('loja 6:30–20:30 com 2 turnos no regime de 42h sugere 06:30–15:54 e 11:06–20:30 (8h24 + 1h), sobrepostos e editáveis', async () => {
    const user = userEvent.setup();
    setConfig({ days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(6, 30), closesAt: h(20, 30) })) });
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);

    await user.selectOptions(screen.getByLabelText('Quantos turnos?'), '2');
    await user.click(screen.getByRole('button', { name: 'Sugerir turnos' }));

    const shifts = doc().config.shifts;
    expect(shifts.map((s) => [s.name, s.start, s.end, s.breakMinutes])).toEqual([
      ['Manhã', h(6, 30), h(15, 54), 60],
      ['Tarde', h(11, 6), h(20, 30), 60],
    ]);
    expect(new Set(shifts.map((s) => s.id)).size).toBe(2);
    expect(screen.getByLabelText('Turno 1: entrada')).toHaveValue('06:30');
    expect(screen.getByLabelText('Turno 1: saída')).toHaveValue('15:54');
    expect(screen.getByLabelText('Turno 2: entrada')).toHaveValue('11:06');
    expect(screen.getByLabelText('Turno 2: saída')).toHaveValue('20:30');

    // Editável: mudar a saída da manhã grava no store.
    fireEvent.change(screen.getByLabelText('Turno 1: saída'), { target: { value: '14:00' } });
    expect(doc().config.shifts[0].end).toBe(h(14));

    // Sugerir de novo mantém os ids (funcionários continuam apontando para o turno certo).
    const ids = doc().config.shifts.map((s) => s.id);
    await user.click(screen.getByRole('button', { name: 'Sugerir turnos' }));
    expect(doc().config.shifts.map((s) => s.id)).toEqual(ids);

    // No regime de 40h (escolhido no passo 1), cada turno tem 8h + 1h.
    act(() => setConfig({ regime: '40h' }));
    expect(screen.getByText(/Regime de 40h \(escolhido no passo 1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sugerir turnos' }));
    expect(doc().config.shifts.map((s) => [s.start, s.end])).toEqual([
      [h(6, 30), h(15, 30)],
      [h(11, 30), h(20, 30)],
    ]);
  });

  test('horários são digitados em 24h, sem AM/PM', async () => {
    const user = userEvent.setup();
    setConfig({ days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(6, 30), closesAt: h(20, 30) })) });
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);
    await user.click(screen.getByRole('button', { name: 'Sugerir turnos' }));
    const field = screen.getByLabelText('Turno 1: saída');
    expect(field).toHaveAttribute('type', 'text');
    await user.clear(field);
    await user.type(field, '1745');
    expect(field).toHaveValue('17:45');
    expect(doc().config.shifts[0].end).toBe(h(17, 45));
  });

  test('fechamento antes da abertura bloqueia o avanço com o motivo visível', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} />);

    fireEvent.change(screen.getByLabelText('Segunda: abre'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Segunda: fecha'), { target: { value: '07:00' } });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Segunda: o fechamento precisa ser depois da abertura.');
    expect(screen.getByRole('heading', { name: 'Funcionamento da loja' })).toBeInTheDocument();

    // Corrigir o horário faz o erro sumir e libera o avanço.
    fireEvent.change(screen.getByLabelText('Segunda: fecha'), { target: { value: '18:00' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByRole('heading', { name: 'Turnos' })).toBeInTheDocument();
  });

  test('os dias aparecem de domingo a sábado', () => {
    render(<SetupWizard onFinish={() => {}} />);
    const names = within(screen.getByRole('group', { name: 'Horário por dia da semana' }))
      .getAllByRole('checkbox')
      .map((c) => c.closest('label')?.textContent)
      .filter((t) => t && !t.includes('Turno único') && !t.includes('Sem folga'));
    expect(names).toEqual(['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']);
    expect(screen.getByText(/Usa o horário de segunda/)).toBeInTheDocument();
  });

  test('"Copiar para todos os dias" replica o horário de segunda', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} />);
    fireEvent.change(screen.getByLabelText('Segunda: abre'), { target: { value: '06:30' } });
    fireEvent.change(screen.getByLabelText('Segunda: fecha'), { target: { value: '20:30' } });
    await user.click(screen.getByRole('button', { name: 'Copiar para todos os dias' }));
    expect(doc().config.days.every((d) => d.open && d.opensAt === h(6, 30) && d.closesAt === h(20, 30))).toBe(true);
    expect(screen.getByLabelText('Domingo: fecha')).toHaveValue('20:30');
  });

  test('"Turno único" por dia grava singleShift; "Copiar para todos os dias" não mexe nele', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} />);
    expect(screen.getByText(/todos trabalham no horário da loja nesse dia \(ex\.: domingo de manhã\)/)).toBeInTheDocument();
    const sunday = screen.getByRole('checkbox', { name: 'Domingo: turno único' });
    expect(sunday).not.toBeChecked();
    await user.click(sunday);
    expect(doc().config.days[6].singleShift).toBe(true);
    expect(doc().config.days.slice(0, 6).every((d) => !d.singleShift)).toBe(true);

    fireEvent.change(screen.getByLabelText('Segunda: abre'), { target: { value: '07:00' } });
    await user.click(screen.getByRole('button', { name: 'Copiar para todos os dias' }));
    expect(doc().config.days[6]).toMatchObject({ opensAt: h(7), singleShift: true });
    expect(doc().config.days[0].singleShift).toBeFalsy();

    // Dia fechado não mostra a opção.
    await user.click(screen.getByRole('checkbox', { name: 'Domingo' }));
    expect(screen.queryByRole('checkbox', { name: 'Domingo: turno único' })).not.toBeInTheDocument();
  });

  test('a etapa de turnos avisa quais dias têm turno único', () => {
    seedThroughRoles();
    setConfig({ days: doc().config.days.map((d, i) => ({ ...d, singleShift: i === 6 })) });
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);
    expect(screen.getByText(/O dia marcado com turno único \(domingo\) não usa estes turnos/)).toBeInTheDocument();
  });

  test('pular pelo indicador de etapas para a etapa com problema e mostra o motivo', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^Equipe.*etapa 4 de 4/ }));
    expect(screen.getByRole('heading', { name: 'Turnos' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Cadastre pelo menos um turno');
  });

  test('cada função precisa de mínimo em cada turno; "Ajustar por dia" altera só um dia', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={2} />);

    const manha = screen.getByLabelText('Mínimo de Balconista no turno Manhã');
    await user.clear(manha);
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Balconista: informe o mínimo de pessoas no turno Manhã');

    await user.type(manha, '2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mudar o mínimo num dia (ex.: domingo)' }));
    const perDay = screen.getAllByLabelText(/^Mínimo de Balconista no turno Manhã, /).map((i) => i.getAttribute('aria-label')!.slice(-3));
    expect(perDay).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    const domingo = screen.getByLabelText('Mínimo de Balconista no turno Manhã, Dom');
    await user.clear(domingo);
    await user.type(domingo, '3');
    const m = doc().config.minimums.find((x) => x.roleId === 'balconista' && x.shiftId === 'manha');
    expect(m?.perWeekday).toEqual([2, 2, 2, 2, 2, 2, 3]);
    // O número de todos os dias passa a mostrar "varia" e fica travado até a tabela ser igualada.
    expect(screen.getByLabelText('Mínimo de Balconista no turno Manhã')).toBeDisabled();
  });

  test('domingo de turno único: 2 no balcão vale para o dia inteiro e não mexe nos outros dias', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    const days = doc().config.days.map((d, w) => (w === 6 ? { ...d, opensAt: h(7, 0), closesAt: h(13, 0), singleShift: true } : d));
    setConfig({ days });
    render(<SetupWizard onFinish={() => {}} initialStep={2} />);

    await user.click(screen.getByRole('button', { name: 'Mudar o mínimo num dia (ex.: domingo)' }));
    expect(screen.queryByLabelText('Mínimo de Balconista no turno Manhã, Dom')).not.toBeInTheDocument();
    const domingo = screen.getByLabelText('Mínimo de Balconista em domingo (turno único)');
    await user.clear(domingo);
    await user.type(domingo, '2');

    const mins = doc().config.minimums.filter((x) => x.roleId === 'balconista');
    for (const m of mins) expect(m.perWeekday).toEqual([1, 1, 1, 1, 1, 1, 2]);
    expect(requiredCount(doc().config, 0, virtualShiftId(6), 'balconista')).toBe(2);
    expect(requiredCount(doc().config, 1, 'manha', 'balconista')).toBe(1);

    // O número "de todos os dias" continua editável e não desfaz o domingo.
    const manha = screen.getByLabelText('Mínimo de Balconista no turno Manhã');
    expect(manha).not.toBeDisabled();
    fireEvent.change(manha, { target: { value: '3' } });
    expect(doc().config.minimums.find((x) => x.roleId === 'balconista' && x.shiftId === 'manha')?.perWeekday).toEqual([3, 3, 3, 3, 3, 3, 2]);
  });

  test('"Sem folga" no sábado é salvo; domingo não tem a opção; dias demais sem folga dão erro', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={0} />);

    expect(screen.queryByLabelText('Domingo: sem folga')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Sábado: sem folga'));
    expect(doc().config.days[5].noOff).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Segunda a sábado sem folga: sobra só o domingo para 2 folgas por semana.
    for (const name of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']) await user.click(screen.getByLabelText(`${name}: sem folga`));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('deixe pelo menos 2 dias abertos sem a marca "Sem folga"');
  });

  test('"Sem turno fixo" no seletor de turno marca a pessoa e esconde o horário próprio', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    appStore.getState().addEmployee({ id: 'p1', name: 'Rosi', roleId: 'balconista', shiftId: 'manha', isWoman: true });
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);
    const select = screen.getByLabelText('Turno');
    await user.selectOptions(select, 'Sem turno fixo');
    expect(doc().employees[0]).toMatchObject({ floating: true, shiftId: 'manha' });
    expect(screen.getByText(/O site põe a pessoa na manhã ou na tarde, dia a dia/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Horário próprio/ })).not.toBeInTheDocument();
    await user.selectOptions(select, 'Tarde');
    expect(doc().employees[0].floating).toBeUndefined();
    expect(doc().employees[0].shiftId).toBe('tarde');
    expect(screen.getByRole('checkbox', { name: /Horário próprio/ })).toBeInTheDocument();
  });

  test('avançar sem nenhum funcionário mostra erro na etapa de equipe', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    seedThroughRoles();
    render(<SetupWizard onFinish={onFinish} initialStep={3} />);

    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Cadastre pelo menos uma pessoa na equipe.');
    expect(screen.getByRole('heading', { name: 'Equipe' })).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  test('nome da pessoa é obrigatório', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    seedThroughRoles();
    render(<SetupWizard onFinish={onFinish} initialStep={3} />);
    await user.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pessoa 1: o nome é obrigatório.');
    expect(onFinish).not.toHaveBeenCalled();
  });

  test('cadastrar a Rosa com 5:45–13:30 guarda o horário individual e "Gerar escala" chama onFinish', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    seedThroughRoles();
    render(<SetupWizard onFinish={onFinish} initialStep={3} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await user.type(screen.getByLabelText('Nome da pessoa 1'), 'Rosa');
    await user.click(screen.getByRole('checkbox', { name: /Horário próprio de Rosa/ }));
    fireEvent.change(screen.getByLabelText('Rosa: entrada'), { target: { value: '05:45' } });
    fireEvent.change(screen.getByLabelText('Rosa: saída'), { target: { value: '13:30' } });

    const rosa = doc().employees[0];
    expect(rosa.name).toBe('Rosa');
    expect(rosa.shiftId).toBe('manha');
    expect(rosa.roleId).toBe('balconista');
    expect(rosa.customHours).toEqual({ start: h(5, 45), end: h(13, 30), breakMinutes: 60 });

    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('"Funcionária mulher" é salvo e não aparece no nome nem no rótulo da pessoa', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await user.type(screen.getByLabelText('Nome da pessoa 1'), 'Rosa');
    await user.click(screen.getByRole('checkbox', { name: /Funcionária mulher/ }));

    expect(doc().employees[0].isWoman).toBe(true);
    expect(doc().employees[0].name).toBe('Rosa');
    expect(screen.getByText(/Só muda a regra de domingo/)).toBeInTheDocument();
    const item = screen.getByRole('listitem', { name: 'Rosa' });
    expect(within(item).getByRole('heading', { level: 3 })).toHaveTextContent(/^Rosa$/);
    expect(screen.getByLabelText('Nome da pessoa 1')).toHaveValue('Rosa');
  });

  test('regime fica no passo 1, começa no padrão do store e pode ser trocado', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={0} />);
    const rules = screen.getByRole('region', { name: 'Regras da escala' });
    expect(within(rules).getByText(/40h já cumpre a lei; 42h é o limite da transição \(até 15\/12\/2027\)/)).toBeInTheDocument();
    expect(within(rules).getByRole('radio', { name: /42h por semana/ })).toBeChecked();
    await user.click(within(rules).getByRole('radio', { name: /40h por semana/ }));
    expect(doc().config.regime).toBe('40h');
  });

  test('regime não aparece mais no passo de turnos', () => {
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);
    expect(screen.queryByRole('radio', { name: /42h por semana/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Regime de 42h \(escolhido no passo 1\)/)).toBeInTheDocument();
  });

  test('turnos: "Intervalo a partir de" começa em 11:30 e grava config.lunchFrom', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);
    const field = screen.getByLabelText('Intervalo a partir de');
    expect(field).toHaveValue('11:30');
    expect(
      screen.getByText(/O site planeja o intervalo de cada pessoa a partir desse horário\. Antecipa só quando isso evita ficar sem ninguém/),
    ).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '1200');
    expect(doc().config.lunchFrom).toBe(h(12));
  });

  test('folgas: começa em "Juntas" e "Podem ser separadas" grava offPattern flexible', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} initialStep={0} />);
    const together = screen.getByRole('radio', { name: /Juntas sempre que possível/ });
    expect(together).toBeChecked();
    expect(screen.getByText('Nunca mais de 2 folgas seguidas nem mais de 6 dias seguidos de trabalho.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Podem ser separadas/ }));
    expect(doc().config.offPattern).toBe('flexible');
    await user.click(together);
    expect(doc().config.offPattern).toBe('together');
  });

  test('segunda área: lista as outras funções, grava secondaryRoleId e limpa se virar a função principal', async () => {
    const user = userEvent.setup();
    seedThroughRoles();
    setConfig({
      roles: [
        { id: 'caixa', name: 'Caixa' },
        { id: 'balconista', name: 'Balconista' },
      ],
    });
    appStore.getState().addEmployee({ id: 'ana', name: 'Ana', roleId: 'caixa', shiftId: 'manha', isWoman: false });
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);

    const select = screen.getByLabelText('Segunda área (opcional)');
    expect(select).toHaveValue('');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Nenhuma', 'Balconista']);
    expect(screen.getByText('Cobre essa função quando a principal já estiver completa no turno.')).toBeInTheDocument();

    await user.selectOptions(select, 'balconista');
    expect(doc().employees[0].secondaryRoleId).toBe('balconista');

    // Função principal passa a ser Balconista: a segunda área igual é apagada e a lista troca.
    await user.selectOptions(screen.getByLabelText('Função'), 'balconista');
    expect(doc().employees[0].roleId).toBe('balconista');
    expect(doc().employees[0].secondaryRoleId).toBeUndefined();
    expect(within(screen.getByLabelText('Segunda área (opcional)')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Nenhuma',
      'Caixa',
    ]);

    await user.selectOptions(screen.getByLabelText('Segunda área (opcional)'), 'caixa');
    await user.selectOptions(screen.getByLabelText('Segunda área (opcional)'), '');
    expect(doc().employees[0].secondaryRoleId).toBeUndefined();
  });

  test('segunda área fica escondida com uma só função', () => {
    seedThroughRoles();
    appStore.getState().addEmployee({ id: 'ana', name: 'Ana', roleId: 'balconista', shiftId: 'manha', isWoman: false });
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);
    expect(screen.queryByLabelText('Segunda área (opcional)')).not.toBeInTheDocument();
  });

  test('primeira configuração não tem "Voltar à escala" e termina em "Gerar escala"', () => {
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);
    expect(screen.queryByRole('button', { name: /Voltar à escala/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/As mudanças são salvas na hora/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar escala' })).toBeInTheDocument();
  });

  test('modo de edição: "Voltar à escala" em qualquer etapa, "Salvar e voltar" no fim e "Gerar escala nova" à parte', async () => {
    const user = userEvent.setup();
    appStore.getState().loadExample();
    appStore.getState().setSchedule({});
    const onBack = vi.fn();
    const onRegen = vi.fn();
    const onFinish = vi.fn();
    render(<SetupWizard onFinish={onFinish} onBackToSchedule={onBack} onRegenerate={onRegen} initialStep={1} />);
    expect(screen.getByText(/As mudanças são salvas na hora/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Voltar à escala/ }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Equipe/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar e voltar' }));
    expect(onBack).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Gerar escala nova do zero' }));
    expect(onRegen).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  test('modo de edição: "Voltar à escala" com configuração inválida mostra o motivo e não sai', async () => {
    const user = userEvent.setup();
    appStore.getState().loadExample();
    appStore.getState().setSchedule({});
    for (const e of appStore.getState().document.employees) appStore.getState().removeEmployee(e.id);
    const onBack = vi.fn();
    render(<SetupWizard onFinish={() => {}} onBackToSchedule={onBack} onRegenerate={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Voltar à escala/ }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Cadastre pelo menos uma pessoa na equipe.');
  });

  test('"Começar do zero" pede confirmação; cancelar mantém e confirmar limpa tudo', async () => {
    const user = userEvent.setup();
    appStore.getState().loadExample();
    render(<SetupWizard onFinish={() => {}} initialStep={3} />);

    await user.click(screen.getByRole('button', { name: 'Começar do zero' }));
    const dialog = screen.getByRole('dialog', { name: 'Apagar tudo?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(doc().employees).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'Começar do zero' }));
    await user.click(screen.getByRole('button', { name: 'Apagar tudo e começar do zero' }));
    expect(doc().employees).toHaveLength(0);
    expect(doc().config.shifts).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Funcionamento da loja' })).toBeInTheDocument();
  });
});

describe('FirstVisit', () => {
  test('mostra os 5 exemplos; escolher um carrega aquele exemplo e chama onStart', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<FirstVisit onStart={onStart} />);
    expect(screen.getByRole('button', { name: 'Restaurar backup' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Ver um exemplo pronto' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent?.split(/\d/)[0])).toEqual([
      'Mercado',
      'Loja de roupas',
      'Padaria',
      'Farmácia',
      'Restaurante',
    ]);
    expect(screen.getByRole('button', { name: 'Padaria' })).toHaveAccessibleDescription(/padeiros de madrugada/);

    await user.click(screen.getByRole('button', { name: 'Padaria' }));
    expect(doc().config.name).toBe('Padaria do exemplo');
    expect(doc().employees).toHaveLength(7);
    expect(onStart).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Mercado' }));
    expect(doc().config.name).toBe('Mercado do exemplo');
    expect(doc().employees).toHaveLength(6);
  });

  test('"Começar do zero" inicia vazio e chama onStart', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<FirstVisit onStart={onStart} />);
    await user.click(screen.getByRole('button', { name: 'Começar do zero' }));
    expect(doc().employees).toHaveLength(0);
    expect(appStore.getState().hasSavedData).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
