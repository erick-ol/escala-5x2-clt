import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { appStore } from '../../state/store';
import { buildAiPrompt } from './aiPrompt';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
  appStore.setState({ storageAvailable: true });
});

describe('Gerar com IA', () => {
  test('tela inicial → colar a resposta da IA → importa e mostra a escala gerada', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Gerar com IA' }));
    expect(screen.getByRole('heading', { name: 'Monte a escala conversando com uma IA' })).toBeInTheDocument();

    // A "resposta da IA": o próprio texto do prompt traz um código de exemplo completo.
    fireEvent.change(screen.getByLabelText('Código da IA'), { target: { value: buildAiPrompt() } });
    await user.click(screen.getByRole('button', { name: 'Importar e gerar a escala' }));

    expect(screen.getByRole('heading', { name: 'Padaria Pão Quente' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Escala da semana 1' })).toBeInTheDocument();
    expect(appStore.getState().document.schedule).not.toBeNull();
    expect(appStore.getState().document.employees.map((e) => e.name)).toEqual(['Rosa', 'João', 'Ana', 'Bia', 'Caio']);
  });

  test('código com erro mostra o motivo e não altera nada', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Gerar com IA' }));
    fireEvent.change(screen.getByLabelText('Código da IA'), {
      target: { value: '{"formato":"escala-5x2-ia","funcionamento":{},"turnos":[],"funcoes":[],"equipe":[]}' },
    });
    await user.click(screen.getByRole('button', { name: 'Importar e gerar a escala' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não deu para importar. Nada foi alterado.');
    expect(screen.getByRole('alert')).toHaveTextContent('"turnos": cadastre de 1 a 3 turnos');
    expect(appStore.getState().document.employees).toHaveLength(0);
  });
});
