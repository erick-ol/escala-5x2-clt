import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { exampleDocument } from './domain/example';
import { generateSchedule } from './domain/generator';
import { appStore } from './state/store';

// A prévia de imagem do painel de exportação não roda em jsdom.
vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));

const TODAY = new Date('2026-11-14T12:00:00');
const doc = () => appStore.getState().document;

function seedWithSchedule() {
  const d = exampleDocument(TODAY);
  appStore.getState().replaceDocument({ ...d, schedule: generateSchedule({ config: d.config, employees: d.employees }) });
}

async function finishWizard(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Próximo' }));
  await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
}

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
  appStore.setState({ storageAvailable: true });
});

describe('App', () => {
  test('primeira visita → Ver exemplo → configuração → Gerar escala mostra a grade', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: /monte a escala 5x2/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver exemplo' }));
    expect(screen.getByRole('heading', { name: 'Configurar a escala' })).toBeInTheDocument();

    await finishWizard(user);
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mercado do exemplo' })).toBeInTheDocument();
    expect(doc().schedule).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Rosa, segunda, semana 1:/ })).toBeInTheDocument();
  });

  test('com escala salva, abre direto na tabela; "Exportar" abre o painel de exportação', async () => {
    seedWithSchedule();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    // Uma semana por vez em qualquer tela, com as abas de semana e as pessoas agrupadas por função.
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Semana 2' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('rowheader', { name: 'Caixa' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Balconista' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(screen.getByText('Exportar escala')).toBeInTheDocument();
  });

  test('reconfigurar com escala existente pergunta antes de regerar; manter encaixa quem entrou', async () => {
    seedWithSchedule();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Rosa, quarta, semana 1: trabalha manhã 05:45–13:30' }));
    await user.click(screen.getByRole('button', { name: 'Folga' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    const before = doc().schedule!;

    await user.click(screen.getByRole('button', { name: 'Configurar' }));
    appStore.getState().addEmployee({ id: 'bia', name: 'Bia', roleId: 'balconista', shiftId: 'tarde', isWoman: true });
    await finishWizard(user);

    const dialog = screen.getByRole('dialog', { name: 'Gerar a escala de novo?' });
    expect(dialog).toHaveTextContent('horários ajustados só num dia, ajustes de datas do mês e marcações de cobertura');
    expect(dialog).toHaveTextContent('horários do cadastro');
    expect(dialog).toHaveTextContent('o início do ciclo no calendário e os feriados');
    await user.click(within(dialog).getByRole('button', { name: 'Manter a escala atual' }));

    const after = doc().schedule!;
    expect(after.rosa).toEqual(before.rosa);
    expect(after.rosa[2].status).toBe('off');
    for (let w = 0; w < 3; w++) {
      const offs = after.bia.slice(w * 7, w * 7 + 7).filter((c) => c.status === 'off').length;
      expect(offs).toBe(2);
    }
    expect(screen.getByRole('rowheader', { name: 'Bia' })).toBeInTheDocument();
  });

  test('reconfigurar e confirmar regera e apaga as trocas de folga', async () => {
    seedWithSchedule();
    appStore.getState().setCell('rosa', 2, { status: 'off' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Configurar' }));
    await finishWizard(user);
    await user.click(screen.getByRole('button', { name: 'Regerar e perder ajustes' }));
    expect(doc().schedule!.rosa[2].status).toBe('work');
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
  });

  test('com armazenamento indisponível, o aviso fixo aparece', () => {
    appStore.setState({ storageAvailable: false });
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Seus dados não estão sendo salvos neste aparelho. Baixe um backup antes de sair.',
    );
  });

  test('o aviso legal fica no rodapé', () => {
    seedWithSchedule();
    render(<App />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent('EC 141/2026');
  });
});
