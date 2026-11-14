import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  test('"Copiar para todos os dias" replica o horário de segunda', async () => {
    const user = userEvent.setup();
    render(<SetupWizard onFinish={() => {}} />);
    fireEvent.change(screen.getByLabelText('Segunda: abre'), { target: { value: '06:30' } });
    fireEvent.change(screen.getByLabelText('Segunda: fecha'), { target: { value: '20:30' } });
    await user.click(screen.getByRole('button', { name: 'Copiar para todos os dias' }));
    expect(doc().config.days.every((d) => d.open && d.opensAt === h(6, 30) && d.closesAt === h(20, 30))).toBe(true);
    expect(screen.getByLabelText('Domingo: fecha')).toHaveValue('20:30');
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

    const expanders = screen.getAllByRole('button', { name: 'Ajustar por dia' });
    await user.click(expanders[0]);
    const domingo = screen.getByLabelText('Mínimo de Balconista no turno Manhã, Dom');
    await user.clear(domingo);
    await user.type(domingo, '3');
    const m = doc().config.minimums.find((x) => x.roleId === 'balconista' && x.shiftId === 'manha');
    expect(m?.perWeekday).toEqual([2, 2, 2, 2, 2, 2, 3]);
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

  test('aviso aparece quando a escala já foi gerada', () => {
    const { unmount } = render(<SetupWizard onFinish={() => {}} />);
    expect(screen.queryByText(/A escala já foi gerada/)).not.toBeInTheDocument();
    unmount();

    appStore.getState().loadExample();
    appStore.getState().setSchedule({});
    render(<SetupWizard onFinish={() => {}} initialStep={1} />);
    expect(
      screen.getByText('A escala já foi gerada. Ao terminar, você poderá gerar de novo com as mudanças.'),
    ).toBeInTheDocument();
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
  test('"Ver exemplo" preenche 6 funcionários e chama onStart', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<FirstVisit onStart={onStart} />);
    expect(screen.getByRole('button', { name: 'Restaurar backup' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver exemplo' }));
    expect(doc().employees).toHaveLength(6);
    expect(onStart).toHaveBeenCalledTimes(1);
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
