import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { evaluateRules } from '../../domain/rules';
import { CYCLE_DAYS, type AppDocument } from '../../domain/types';
import { serializeBackup } from '../../state/backup';
import { appStore } from '../../state/store';
import { LegalNotice } from '../LegalNotice';
import { ExportPanel } from './ExportPanel';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
const toBlobMock = vi.mocked(toBlob);

const TODAY = new Date('2026-11-14T12:00:00Z');

/** Exemplo sem o único balconista da tarde: sobra buraco todo dia nesse turno. */
function fixture(): AppDocument {
  const base = exampleDocument(TODAY);
  const employees = base.employees.filter((e) => e.id !== 'pedro');
  const schedule = generateSchedule({ config: base.config, employees });
  return {
    ...base,
    employees,
    schedule,
    marks: [
      { day: 0, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
      { day: 1, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'richard' } },
    ],
  };
}

const printSheet = () => screen.getByTestId('print-sheet');
const weekImage = () => screen.getByTestId('week-image');

let createObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  appStore.setState({ document: fixture(), lastBackupAt: null, hasSavedData: true });
  toBlobMock.mockReset();
  toBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  createObjectURL = vi.fn(() => 'blob:mock');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  anchorClick.mockRestore();
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).canShare;
});

function setShare(canShare: boolean, share: () => Promise<void>) {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => canShare), configurable: true });
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true });
}

async function renderReady() {
  const onClose = vi.fn();
  render(<ExportPanel onClose={onClose} />);
  await screen.findByText('Imagem da semana 1 pronta.');
  return onClose;
}

describe('ExportPanel', () => {
  it('folha impressa contém todas as pessoas e os 21 dias', async () => {
    await renderReady();
    const sheet = printSheet();
    const doc = appStore.getState().document;
    const rows = within(sheet).getAllByTestId('print-row');
    expect(rows).toHaveLength(doc.employees.length);
    for (const e of doc.employees) expect(sheet).toHaveTextContent(e.name);
    for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(CYCLE_DAYS);
    expect(sheet).toHaveTextContent('Mercado do exemplo');
    expect(sheet).toHaveTextContent('Semana 3');
  });

  it('exportação não contém alertas nem "Funcionária mulher"', async () => {
    const doc = fixture();
    // Força violações: Andreza trabalha os 21 dias.
    doc.schedule!.andreza = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'work' as const }));
    appStore.getState().replaceDocument(doc);
    const reports = evaluateRules({ config: doc.config, employees: doc.employees, schedule: doc.schedule! });
    const messages = Object.values(reports).flatMap((r) => r.alerts.map((a) => a.message));
    expect(messages.length).toBeGreaterThan(0);

    await renderReady();
    for (const node of [printSheet(), weekImage()]) {
      const text = node.textContent ?? '';
      expect(text).not.toMatch(/Funcionária mulher/i);
      expect(text).not.toMatch(/alerta/i);
      for (const m of messages) expect(text).not.toContain(m);
    }
  });

  it('buraco coberto pelo dono aparece como "Dono/família", por funcionário com o nome e o resto como "Falta"', async () => {
    await renderReady();
    const sheet = printSheet();
    expect(within(sheet).getAllByText('Dono/família').length).toBeGreaterThan(0);
    const gapRow = within(sheet).getByText('Balconista · Tarde').closest('tr')!;
    const cells = gapRow.querySelectorAll('td');
    expect(cells[0]).toHaveTextContent('Dono/família');
    expect(cells[1]).toHaveTextContent('Richard');
    expect(cells[2]).toHaveTextContent('Falta');
    expect(weekImage()).toHaveTextContent('Dono/família');
  });

  it('imagem tem cabeçalho com loja e semana, e troca de semana gera outra imagem', async () => {
    await renderReady();
    expect(weekImage()).toHaveTextContent('Mercado do exemplo');
    expect(weekImage()).toHaveTextContent('Semana 1 de 3');
    await userEvent.click(screen.getByRole('button', { name: 'Semana 2' }));
    await screen.findByText('Imagem da semana 2 pronta.');
    expect(weekImage()).toHaveTextContent('Semana 2 de 3');
    expect(toBlobMock).toHaveBeenCalledTimes(2);
  });

  it('falha ao gerar a imagem mostra erro e mantém o painel aberto', async () => {
    toBlobMock.mockRejectedValue(new Error('canvas'));
    const onClose = vi.fn();
    render(<ExportPanel onClose={onClose} />);
    expect(screen.getByText('Gerando imagem…')).toBeInTheDocument();
    expect(await screen.findByText(/Não foi possível gerar a imagem/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mostra o botão de backup e, depois do download, "Backup baixado em"', async () => {
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar backup' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(anchorClick).toHaveBeenCalled();
    const anchor = anchorClick.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^backup-mercado-do-exemplo-\d{4}-\d{2}-\d{2}\.json$/);
    expect(appStore.getState().lastBackupAt).not.toBeNull();
    expect(screen.getByText(/Backup baixado em \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
  });

  it('restaurar um backup válido substitui a escala após confirmação', async () => {
    await renderReady();
    const other = { ...exampleDocument(TODAY), config: { ...exampleDocument(TODAY).config, name: 'Padaria Nova' } };
    const file = new File([serializeBackup(other)], 'backup.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Arquivo de backup'), file);
    await userEvent.click(await screen.findByRole('button', { name: 'Substituir pelo backup' }));
    expect(appStore.getState().document.config.name).toBe('Padaria Nova');
  });

  it('restaurar arquivo inválido mostra erro e mantém a escala', async () => {
    await renderReady();
    const file = new File(['não é json'], 'x.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Arquivo de backup'), file);
    expect(await screen.findByText(/não é um backup válido/)).toBeInTheDocument();
    expect(appStore.getState().document.config.name).toBe('Mercado do exemplo');
  });

  it('compartilha o arquivo quando o navegador aceita', async () => {
    setShare(true, () => Promise.resolve());
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    const share = navigator.share as unknown as ReturnType<typeof vi.fn>;
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as ShareData;
    expect(arg.title).toBe('Mercado do exemplo — Semana 1 de 3');
    expect(arg.files?.[0].name).toBe('escala-mercado-do-exemplo-semana-1.png');
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('sem suporte a arquivos, cai para download', async () => {
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect((anchorClick.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(
      'escala-mercado-do-exemplo-semana-1.png',
    );
  });

  it('com NotAllowedError, cai para download', async () => {
    setShare(true, () => Promise.reject(new DOMException('negado', 'NotAllowedError')));
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(navigator.share).toHaveBeenCalledTimes(1);
  });

  it('quando a pessoa cancela o compartilhamento (AbortError), não baixa nada', async () => {
    setShare(true, () => Promise.reject(new DOMException('cancelado', 'AbortError')));
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('Esc fecha, o foco começa no painel e volta para quem abriu', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(<ExportPanel onClose={onClose} />);
    await screen.findByText('Imagem da semana 1 pronta.');
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('LegalNotice', () => {
  it('mostra o aviso com as datas e o link oficial', () => {
    render(<LegalNotice />);
    expect(screen.getByText(/EC 141\/2026/)).toHaveTextContent('16/12/2026');
    expect(screen.getByText(/EC 141\/2026/)).toHaveTextContent('16/12/2027');
    expect(screen.getByText(/não substitui orientação jurídica/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver texto oficial' })).toHaveAttribute('href', expect.stringContaining('planalto.gov.br'));
  });
});
