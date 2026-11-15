import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { referenceDocument as exampleDocument } from '../../test/fixtures';
import { serializeBackup } from '../../state/backup';
import { appStore } from '../../state/store';
import { ConfirmDialog } from '../ConfirmDialog';
import { RestoreBackupButton } from '../RestoreBackupButton';
import { suggestShifts } from './setupLogic';

beforeEach(() => {
  window.localStorage?.clear?.();
  appStore.getState().resetToEmpty();
});

function Harness({ onConfirm = () => {}, onCancel = () => {} }: { onConfirm?(): void; onCancel?(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <ConfirmDialog
        open={open}
        title="Remover?"
        confirmLabel="Remover pessoa"
        danger
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      >
        <p>Não dá para desfazer.</p>
      </ConfirmDialog>
    </>
  );
}

describe('ConfirmDialog', () => {
  test('abre com foco em Cancelar, Esc cancela e o foco volta para quem abriu', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<Harness onCancel={onCancel} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Remover?' });
    // <dialog> nativo aberto como modal: o navegador cuida da semântica de modal.
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });

  // Prender o Tab é do showModal() nativo (o resto da página fica inerte); o jsdom não implementa isso.
  test('botão Cancelar cancela e o foco volta para quem abriu', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });
});

describe('RestoreBackupButton', () => {
  const upload = async (content: string) => {
    const user = userEvent.setup();
    const file = new File([content], 'backup.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Arquivo de backup'), file);
    return user;
  };

  test('arquivo inválido mostra erro e mantém os dados atuais', async () => {
    appStore.getState().loadExample();
    const before = appStore.getState().document;
    const onRestored = vi.fn();
    render(<RestoreBackupButton onRestored={onRestored} />);

    await upload('isto não é json');
    expect(await screen.findByRole('alert')).toHaveTextContent('O arquivo não é um backup válido da escala.');
    expect(appStore.getState().document).toBe(before);
    expect(onRestored).not.toHaveBeenCalled();
  });

  test('backup válido sobre equipe existente pede confirmação antes de substituir', async () => {
    appStore.getState().loadExample();
    const backup = exampleDocument();
    backup.config.name = 'Padaria do backup';
    const onRestored = vi.fn();
    render(<RestoreBackupButton onRestored={onRestored} />);

    const user = await upload(serializeBackup(backup));
    const dialog = await screen.findByRole('dialog', { name: 'Substituir a escala atual?' });
    expect(dialog).toBeInTheDocument();
    expect(appStore.getState().document.config.name).toBe('Mercado do exemplo');

    await user.click(screen.getByRole('button', { name: 'Substituir pelo backup' }));
    expect(appStore.getState().document.config.name).toBe('Padaria do backup');
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  test('backup válido sem equipe atual restaura direto', async () => {
    const onRestored = vi.fn();
    render(<RestoreBackupButton onRestored={onRestored} />);
    await upload(serializeBackup(exampleDocument()));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(appStore.getState().document.employees).toHaveLength(6);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('suggestShifts', () => {
  const day = (opensAt: number, closesAt: number, open = true) => ({ open, opensAt, closesAt });

  test('usa o dia aberto mais longo e a jornada oficial (8h24 + 1h no regime de 42h), sobrepondo os turnos', () => {
    const days = [day(480, 1080), day(390, 1230), day(0, 0, false), day(480, 1080), day(480, 1080), day(480, 1080), day(480, 720)];
    const three = suggestShifts(days, 3);
    expect(three.map((s) => [s.start, s.end])).toEqual([
      [390, 954],
      [530, 1094],
      [666, 1230],
    ]);
    expect(three.every((s) => s.end - s.start - s.breakMinutes === 504)).toBe(true);
    expect(three.map((s) => s.name)).toEqual(['Manhã', 'Tarde', 'Noite']);
    const one = suggestShifts(days, 1);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ start: 390, end: 954 });
    expect(suggestShifts(days, 2, [], '40h').map((s) => [s.start, s.end])).toEqual([
      [390, 930],
      [690, 1230],
    ]);
  });

  test('loja aberta menos tempo que um turno: o turno ocupa o horário inteiro', () => {
    const short = Array.from({ length: 7 }, () => day(480, 840));
    expect(suggestShifts(short, 1)[0]).toMatchObject({ start: 480, end: 840, breakMinutes: 15 });
  });

  test('sem dia aberto válido não sugere nada', () => {
    expect(suggestShifts(Array.from({ length: 7 }, () => day(0, 0, false)), 2)).toEqual([]);
  });
});
