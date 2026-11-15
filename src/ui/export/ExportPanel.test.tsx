import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import { referenceDocument as exampleDocument } from '../../test/fixtures';
import { generateSchedule } from '../../domain/generator';
import { cellOnDate, projectMonth } from '../../domain/month';
import { evaluateRules } from '../../domain/rules';
import { CYCLE_DAYS, type AppDocument } from '../../domain/types';
import { serializeBackup } from '../../state/backup';
import { appStore } from '../../state/store';
import { LegalNotice } from '../LegalNotice';
import { ExportPanel } from './ExportPanel';
import { buildPersonalModel } from './personalModel';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
const toBlobMock = vi.mocked(toBlob);

const TODAY = new Date('2026-11-14T12:00:00Z');

/**
 * Exemplo sem o único balconista da tarde: sobra buraco todo dia nesse turno.
 * Sem segunda área, para o João (caixa, segunda área balconista) não tapar esses buracos.
 */
function fixture(): AppDocument {
  const base = exampleDocument(TODAY);
  const employees = base.employees.filter((e) => e.id !== 'pedro').map((e) => ({ ...e, secondaryRoleId: undefined }));
  const schedule = generateSchedule({ config: base.config, employees });
  return {
    ...base,
    employees,
    schedule,
    marks: [
      // Segunda e terça da semana 1 (o dia 0 é o domingo de turno único).
      { day: 1, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
      { day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'richard' } },
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
    // Cada semana vai de domingo a sábado.
    const days = Array.from(sheet.querySelectorAll('thead tr:nth-child(2) th')).map((th) => th.textContent);
    expect(days).toEqual(Array.from({ length: 3 }, () => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']).flat());
    expect(weekImage().querySelector('th')?.parentElement?.textContent).toMatch(/Dom.*Seg.*Ter.*Qua.*Qui.*Sex.*Sáb/);
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
    expect(cells[1]).toHaveTextContent('Dono/família');
    expect(cells[2]).toHaveTextContent('Richard');
    expect(cells[3]).toHaveTextContent('Falta');
    expect(weekImage()).toHaveTextContent('Dono/família');
  });

  it('turno único: domingo sai como "U" com o horário da loja e a legenda explica', async () => {
    await renderReady();
    const sheet = printSheet();
    const legend = sheet.querySelector('.ps-legend')!;
    expect(legend).toHaveTextContent('U = Turno único Dom 07:00–13:00');
    const doc = appStore.getState().document;
    const worker = doc.employees.find((e) => doc.schedule![e.id][0].status === 'work')!;
    const row = within(sheet).getAllByTestId('print-row').find((r) => r.textContent?.includes(worker.name))!;
    const sunday = row.querySelectorAll('td')[0];
    expect(sunday).toHaveTextContent('U');
    expect(sunday).toHaveTextContent('07:00–13:00');
    expect(weekImage()).toHaveTextContent('Turno único');
  });

  it('imagem tem cabeçalho com loja e semana, e troca de semana gera outra imagem', async () => {
    await renderReady();
    expect(weekImage()).toHaveTextContent('Mercado do exemplo');
    expect(weekImage()).toHaveTextContent('Semana 1 de 3');
    await userEvent.click(screen.getByRole('button', { name: 'Semana 2' }));
    await screen.findByText('Imagem da semana 2 pronta.');
    expect(weekImage()).toHaveTextContent('Semana 2 de 3');
    // A imagem por funcionário também chama toBlob: conta só as da semana.
    expect(toBlobMock.mock.calls.filter(([node]) => (node as HTMLElement).dataset.testid === 'week-image')).toHaveLength(2);
  });

  it('falha ao gerar a imagem mostra erro e mantém o painel aberto', async () => {
    toBlobMock.mockRejectedValue(new Error('canvas'));
    const onClose = vi.fn();
    render(<ExportPanel onClose={onClose} />);
    expect(screen.getByText('Gerando imagem…')).toBeInTheDocument();
    expect(await screen.findByText(/Não foi possível gerar a imagem/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compartilhar imagem' })).toBeDisabled();
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
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    const share = navigator.share as unknown as ReturnType<typeof vi.fn>;
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as ShareData;
    expect(arg.title).toBe('Mercado do exemplo — Semana 1 de 3');
    expect(arg.files?.[0].name).toBe('escala-mercado-do-exemplo-semana-1.png');
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('sem suporte a arquivos, cai para download', async () => {
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect((anchorClick.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(
      'escala-mercado-do-exemplo-semana-1.png',
    );
  });

  it('com NotAllowedError, cai para download', async () => {
    setShare(true, () => Promise.reject(new DOMException('negado', 'NotAllowedError')));
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(navigator.share).toHaveBeenCalledTimes(1);
  });

  it('quando a pessoa cancela o compartilhamento (AbortError), não baixa nada', async () => {
    setShare(true, () => Promise.reject(new DOMException('cancelado', 'AbortError')));
    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
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

describe('ExportPanel no mês', () => {
  beforeEach(() => {
    const doc = fixture();
    appStore.setState({
      document: {
        ...doc,
        calendar: {
          cycleStart: '2026-11-29',
          closedDates: ['2026-12-25'],
          dateOverrides: [{ date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } }],
        },
      },
    });
  });

  it('formato tabela: folha do mês tem todas as datas do mês, semana a semana, com o feriado', async () => {
    render(<ExportPanel month={{ year: 2026, month: 12 }} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dezembro de 2026' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Tabela por semana' }));
    await screen.findByText('Imagem de 29/11 – 05/12 pronta.');
    const sheet = printSheet();
    expect(sheet).toHaveAttribute('data-scope', 'month');
    expect(sheet).not.toHaveAttribute('data-format');
    expect(sheet).toHaveTextContent('Escala de Dezembro de 2026');
    for (let d = 1; d <= 31; d++) expect(sheet).toHaveTextContent(`${String(d).padStart(2, '0')}/12`);
    const weeks = within(sheet).getAllByTestId('print-week');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toHaveTextContent('29/11 – 05/12');
    expect(weeks[0]).toHaveTextContent('Semana 1 do ciclo');
    expect(Array.from(weeks[0].querySelectorAll('thead th')).map((th) => th.textContent?.slice(0, 3)).slice(-7)).toEqual([
      'Dom',
      'Seg',
      'Ter',
      'Qua',
      'Qui',
      'Sex',
      'Sáb',
    ]);
    const doc = appStore.getState().document;
    for (const w of weeks) {
      const rows = within(w).getAllByTestId('print-row');
      expect(rows).toHaveLength(doc.employees.length);
      for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(7);
    }
    // Feriado de 25/12 (sexta): coluna 5 da semana de 20/12 (domingo a sábado).
    for (const row of within(weeks[3]).getAllByTestId('print-row')) expect(row.querySelectorAll('td')[5]).toHaveTextContent('Fer.');
    // Ajuste da data: Rosa de folga em 02/12 (quarta).
    const rosa = within(weeks[0]).getAllByTestId('print-row').find((r) => r.textContent?.includes('Rosa'))!;
    expect(rosa.querySelectorAll('td')[3]).toHaveTextContent('F');
    expect(sheet.textContent).not.toMatch(/alerta/i);
  });

  it('formato tabela: imagens por semana com datas reais; dá para voltar ao ciclo', async () => {
    setShare(true, () => Promise.resolve());
    render(<ExportPanel month={{ year: 2026, month: 12 }} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tabela por semana' }));
    await screen.findByText('Imagem de 29/11 – 05/12 pronta.');
    expect(weekImage()).toHaveTextContent('Escala 29/11 – 05/12');
    expect(weekImage()).toHaveTextContent('Dom 29/11');
    expect(weekImage()).toHaveTextContent('Sáb 05/12');
    await userEvent.click(screen.getByRole('button', { name: '06/12 – 12/12' }));
    await screen.findByText('Imagem de 06/12 – 12/12 pronta.');
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    const arg = (navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData;
    expect(arg.title).toBe('Mercado do exemplo — Escala 06/12 – 12/12');
    expect(arg.files?.[0].name).toBe('escala-mercado-do-exemplo-2026-12-06.png');

    await userEvent.click(screen.getByRole('button', { name: 'Ciclo de 3 semanas' }));
    await screen.findByText('Imagem da semana 1 pronta.');
    expect(printSheet()).not.toHaveAttribute('data-scope');
    expect(printSheet()).toHaveTextContent('Semana 3');
  });
});

const personalImage = () => screen.getByTestId('personal-image');
/** Troca o painel para "Uma pessoa" (e escolhe a pessoa, se pedida). */
async function choosePerson(name?: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Uma pessoa' }));
  if (name) await userEvent.selectOptions(screen.getByLabelText('Funcionário'), name);
}

describe('ExportPanel por funcionário', () => {
  let printSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
  });
  afterEach(() => printSpy.mockRestore());

  it('começa na equipe; "Uma pessoa" mostra a primeira pessoa e troca ao escolher outra', async () => {
    render(<ExportPanel onClose={vi.fn()} />);
    await screen.findByText('Imagem da semana 1 pronta.');
    expect(screen.getByRole('button', { name: 'Equipe toda' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Funcionário')).not.toBeInTheDocument();
    expect(screen.queryByTestId('personal-image')).not.toBeInTheDocument();
    await choosePerson();
    await screen.findByText('Imagem de Andreza pronta.');
    expect(screen.queryByTestId('week-image')).not.toBeInTheDocument();
    expect(personalImage()).toHaveTextContent('Andreza');
    expect(personalImage()).toHaveTextContent('Ciclo de 3 semanas a partir de');
    // Ciclo também em calendário: domingo a sábado, a coluna do total diz a semana.
    expect(within(personalImage()).getByTestId('personal-calendar')).toBeInTheDocument();
    expect(within(personalImage()).getAllByTestId('personal-calendar-total').map((t) => t.textContent)).toEqual([
      expect.stringMatching(/^Semana 1/),
      expect.stringMatching(/^Semana 2/),
      expect.stringMatching(/^Semana 3/),
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Funcionário'), 'Rosa');
    await screen.findByText('Imagem de Rosa pronta.');
    expect(personalImage()).toHaveTextContent('Rosa');
    expect(personalImage()).toHaveTextContent('Balconista');
    expect(personalImage()).toHaveTextContent('05:45–13:30');
    expect(personalImage()).not.toHaveTextContent('Andreza');
    expect(within(personalImage()).getAllByTestId('personal-calendar-day')).toHaveLength(CYCLE_DAYS);
    expect(within(personalImage()).getAllByTestId('personal-calendar-total')).toHaveLength(3);
    expect(personalImage()).toHaveTextContent('Rosa');
    expect(personalImage()).toHaveAttribute('data-format', 'calendar');
    const personalCalls = toBlobMock.mock.calls.filter(([node]) => (node as HTMLElement).dataset.testid === 'personal-image');
    expect(personalCalls).toHaveLength(2);
  });

  it('"Imprimir" com uma pessoa imprime só a folha dela, sem a folha da equipe', async () => {
    render(<ExportPanel onClose={vi.fn()} />);
    await choosePerson();
    await screen.findByText('Imagem de Andreza pronta.');
    expect(screen.queryByTestId('personal-print')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Funcionário'), 'Rosa');
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    const pages = within(screen.getByTestId('personal-print')).getAllByTestId('personal-page');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveTextContent('Rosa');
    expect(screen.getByTestId('personal-print').querySelector('style')?.textContent).toContain('A4 portrait');
    expect(printSheet()).toHaveAttribute('data-print-skip');

    // Voltar a imprimir a equipe tira a folha individual da impressão.
    await userEvent.click(screen.getByRole('button', { name: 'Equipe toda' }));
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(printSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('personal-print')).not.toBeInTheDocument();
    expect(printSheet()).not.toHaveAttribute('data-print-skip');
  });

  it('"Imprimir todos" gera uma página por pessoa', async () => {
    render(<ExportPanel onClose={vi.fn()} />);
    await choosePerson();
    await screen.findByText('Imagem de Andreza pronta.');
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir todos (uma página por pessoa)' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    const doc = appStore.getState().document;
    const pages = within(screen.getByTestId('personal-print')).getAllByTestId('personal-page');
    expect(pages).toHaveLength(doc.employees.length);
    doc.employees.forEach((e, i) => {
      expect(pages[i]).toHaveTextContent(e.name);
      expect(within(pages[i]).getAllByTestId('personal-calendar-day')).toHaveLength(CYCLE_DAYS);
    });
    expect(printSheet()).toHaveAttribute('data-print-skip');
  });

  it('imagem sem suporte a arquivos cai para download com o nome da pessoa', async () => {
    render(<ExportPanel onClose={vi.fn()} />);
    await choosePerson('Rosa');
    await screen.findByText('Imagem de Rosa pronta.');
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect((anchorClick.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('escala-rosa-ciclo.png');
    expect(screen.getAllByText(/Imagem baixada/)).toHaveLength(1);
  });

  it('falha ao gerar a imagem da pessoa mostra erro e "Tentar de novo"', async () => {
    toBlobMock.mockImplementation(async (node) => {
      if ((node as HTMLElement).dataset.testid === 'personal-image') throw new Error('canvas');
      return new Blob(['png'], { type: 'image/png' });
    });
    render(<ExportPanel onClose={vi.fn()} />);
    await choosePerson();
    expect(await screen.findByText(/Não foi possível gerar a imagem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compartilhar imagem' })).toBeDisabled();
    toBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText('Imagem de Andreza pronta.');
    expect(screen.getByRole('button', { name: 'Compartilhar imagem' })).toBeEnabled();
  });

  it('não mostra alertas nem "Funcionária mulher" na imagem e na impressão', async () => {
    const doc = fixture();
    doc.schedule!.andreza = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'work' as const }));
    appStore.getState().replaceDocument(doc);
    const reports = evaluateRules({ config: doc.config, employees: doc.employees, schedule: doc.schedule! });
    const messages = reports.andreza.alerts.map((a) => a.message);
    expect(messages.length).toBeGreaterThan(0);
    render(<ExportPanel onClose={vi.fn()} />);
    await choosePerson();
    await screen.findByText('Imagem de Andreza pronta.');
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir todos (uma página por pessoa)' }));
    for (const node of [personalImage(), screen.getByTestId('personal-print')]) {
      const text = node.textContent ?? '';
      expect(text).not.toMatch(/Funcionária mulher|alerta|Falta|Dono\/família/i);
      for (const m of messages) expect(text).not.toContain(m);
    }
  });
});

describe('ExportPanel por funcionário no mês', () => {
  beforeEach(() => {
    const doc = fixture();
    appStore.setState({
      document: {
        ...doc,
        calendar: {
          cycleStart: '2026-11-29',
          closedDates: ['2026-12-25'],
          dateOverrides: [{ date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } }],
        },
      },
    });
  });

  it('formato tabela: a pessoa continua em calendário do mês, com datas reais, feriado, ajuste e nome do mês', async () => {
    setShare(true, () => Promise.resolve());
    render(<ExportPanel month={{ year: 2026, month: 12 }} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tabela por semana' }));
    await choosePerson('Rosa');
    await screen.findByText('Imagem de Rosa pronta.');
    // O formato é só da equipe: some com "Uma pessoa".
    expect(screen.queryByRole('button', { name: 'Tabela por semana' })).not.toBeInTheDocument();
    expect(personalImage()).toHaveTextContent('Dezembro de 2026');
    const days = within(personalImage()).getAllByTestId('personal-calendar-day');
    expect(days).toHaveLength(35);
    const day = (date: string) => days.find((d) => d.dataset.date === date)!;
    expect(day('2026-12-02')).toHaveTextContent('Folga');
    expect(day('2026-12-25')).toHaveTextContent('Feriado');

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    const arg = (navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData;
    expect(arg.files?.[0].name).toBe('escala-rosa-dezembro-2026.png');
    expect(arg.title).toBe('Escala de Rosa — Dezembro de 2026');
    expect(anchorClick).not.toHaveBeenCalled();

    // Voltar ao ciclo troca o período da escala individual.
    await userEvent.click(screen.getByRole('button', { name: 'Ciclo de 3 semanas' }));
    await screen.findByText('Imagem de Rosa pronta.');
    expect(personalImage()).toHaveTextContent('Ciclo de 3 semanas a partir de 29/11/2026');
    expect(within(personalImage()).getAllByTestId('personal-calendar-day')).toHaveLength(CYCLE_DAYS);
  });
});

const DECEMBER = { year: 2026, month: 12 };
const monthImage = () => screen.getByTestId('month-image');
const isOutside = (td: HTMLElement) => td.classList.contains('cal-outside');

describe('ExportPanel no mês — calendário (padrão)', () => {
  let printSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const doc = fixture();
    appStore.setState({
      document: {
        ...doc,
        calendar: {
          cycleStart: '2026-11-29',
          closedDates: ['2026-12-25'],
          dateOverrides: [{ date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } }],
        },
      },
    });
    printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
  });
  afterEach(() => printSpy.mockRestore());

  it('a impressão sai em calendário: A4 deitada, domingo a sábado, cada data do mês uma vez', async () => {
    render(<ExportPanel month={DECEMBER} onClose={vi.fn()} />);
    await screen.findByText('Imagem de dezembro de 2026 pronta.');
    expect(screen.getByRole('button', { name: 'Calendário' })).toHaveAttribute('aria-pressed', 'true');
    const sheet = printSheet();
    expect(sheet).toHaveAttribute('data-scope', 'month');
    expect(sheet).toHaveAttribute('data-format', 'calendar');
    expect(sheet.querySelector('style')?.textContent).toContain('A4 landscape');
    expect(within(sheet).queryAllByTestId('print-week')).toHaveLength(0);
    expect(within(sheet).getAllByTestId('calendar-page')).toHaveLength(1);
    expect(sheet).toHaveTextContent('Mercado do exemplo');
    expect(sheet).toHaveTextContent('Dezembro de 2026');
    expect(sheet.querySelector('.tc-legend')).toHaveTextContent('U = Turno único Dom 07:00–13:00');

    const cal = within(sheet).getByTestId('team-calendar');
    expect(Array.from(cal.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Domingo',
      'Segunda',
      'Terça',
      'Quarta',
      'Quinta',
      'Sexta',
      'Sábado',
    ]);
    const weeks = within(cal).getAllByTestId('calendar-week');
    expect(weeks).toHaveLength(5);
    for (const w of weeks) expect(within(w).getAllByTestId('calendar-day')).toHaveLength(7);
    const days = within(cal).getAllByTestId('calendar-day');
    expect(days.filter((d) => !isOutside(d)).map((d) => d.querySelector('.cal-num')!.textContent)).toEqual(
      Array.from({ length: 31 }, (_, i) => String(i + 1)),
    );
    // Fora do mês: só o número.
    const outside = days.filter(isOutside);
    expect(outside.map((d) => d.textContent)).toEqual(['29', '30', '1', '2']);

    const day = (date: string) => days.find((d) => d.dataset.date === date)!;
    expect(day('2026-12-25')).toHaveTextContent('Feriado — fechado');
    expect(within(day('2026-12-25')).queryAllByTestId('calendar-shift')).toHaveLength(0);
    // Quinta 03/12: cada pessoa no turno do cadastro, ou na lista de folga.
    const doc = appStore.getState().document;
    const thursday = day('2026-12-03');
    const lines = within(thursday).getAllByTestId('calendar-shift');
    expect(lines.map((l) => l.textContent?.slice(0, 1))).toEqual(['M', 'T']);
    for (const e of doc.employees) {
      const { cell } = cellOnDate(doc, e.id, '2026-12-03');
      const line = lines.find((l) => l.textContent?.includes(e.name));
      if (cell?.status === 'work') {
        expect(line?.textContent?.slice(0, 1)).toBe(e.shiftId === 'manha' ? 'M' : 'T');
      } else {
        expect(line).toBeUndefined();
        expect(thursday.querySelector('.tc-off')).toHaveTextContent(e.name);
      }
    }
    // Ajuste da data, turno único no domingo e vaga sem ninguém (discreta, só na impressão).
    expect(day('2026-12-02').querySelector('.tc-off')).toHaveTextContent('Rosa');
    expect(within(day('2026-12-06')).getAllByTestId('calendar-shift').map((l) => l.textContent?.slice(0, 1))).toEqual(['U']);
    expect(day('2026-12-08')).toHaveTextContent('Falta 1 balconista (T)');
  });

  it('imagem do mês: um calendário só, sem "Falta", compartilhado com o nome do mês', async () => {
    setShare(true, () => Promise.resolve());
    render(<ExportPanel month={DECEMBER} onClose={vi.fn()} />);
    await screen.findByText('Imagem de dezembro de 2026 pronta.');
    expect(screen.queryByTestId('week-image')).not.toBeInTheDocument();
    const image = monthImage();
    expect(within(image).getByTestId('team-calendar')).toBeInTheDocument();
    expect(image).toHaveTextContent('Mercado do exemplo');
    expect(image).toHaveTextContent('Dezembro de 2026');
    expect(within(image).getAllByTestId('calendar-day').filter((d) => !isOutside(d))).toHaveLength(31);
    expect(image).not.toHaveTextContent('Falta');
    const nodes = toBlobMock.mock.calls.map(([node]) => (node as HTMLElement).dataset.testid);
    expect(nodes).toContain('month-image');
    expect(nodes).not.toContain('week-image');

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar imagem' }));
    const arg = (navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData;
    expect(arg.title).toBe('Mercado do exemplo — Dezembro de 2026');
    expect(arg.files?.[0].name).toBe('escala-mercado-do-exemplo-dezembro-2026.png');
  });

  it('por funcionário: imagem e impressão em calendário, com intervalo, folga, feriado e totais', async () => {
    render(<ExportPanel month={DECEMBER} onClose={vi.fn()} />);
    await choosePerson('Rosa');
    await screen.findByText('Imagem de Rosa pronta.');
    const cal = within(personalImage()).getByTestId('personal-calendar');
    expect(Array.from(cal.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Domingo',
      'Segunda',
      'Terça',
      'Quarta',
      'Quinta',
      'Sexta',
      'Sábado',
      'Semana',
    ]);
    const weeks = within(cal).getAllByTestId('personal-calendar-week');
    expect(weeks).toHaveLength(5);
    for (const w of weeks) expect(within(w).getAllByTestId('personal-calendar-day')).toHaveLength(7);
    const days = within(cal).getAllByTestId('personal-calendar-day');
    expect(days.filter((d) => !isOutside(d)).map((d) => d.querySelector('.cal-num')!.textContent)).toEqual(
      Array.from({ length: 31 }, (_, i) => String(i + 1)),
    );
    expect(days.filter(isOutside).map((d) => d.textContent)).toEqual(['29', '30', '1', '2']);
    const day = (date: string) => days.find((d) => d.dataset.date === date)!;
    expect(day('2026-12-02')).toHaveTextContent('Folga');
    expect(day('2026-12-25')).toHaveTextContent('Feriado');
    const work = days.filter((d) => d.classList.contains('pc-work'));
    expect(work.length).toBeGreaterThan(15);
    for (const d of work) expect(d.textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}.*intervalo \d{2}:\d{2}–\d{2}:\d{2}/);
    for (const d of days.filter((x) => x.classList.contains('pc-off'))) expect(d).toHaveTextContent('Folga');
    const model = buildPersonalModel(appStore.getState().document, 'rosa', { kind: 'month', ...DECEMBER })!;
    expect(within(cal).getAllByTestId('personal-calendar-total').map((t) => t.textContent)).toEqual(
      model.weeks.map((w) => w.total),
    );

    // A imagem da pessoa é o mesmo calendário da impressão.
    expect(personalImage()).toHaveAttribute('data-format', 'calendar');
    expect(personalImage()).toHaveTextContent('Rosa');
    const last = toBlobMock.mock.calls.filter(([node]) => (node as HTMLElement).dataset.testid === 'personal-image').at(-1)!;
    expect((last[0] as HTMLElement).querySelector('[data-testid="personal-calendar"]')).not.toBeNull();

    // Impressão só desta pessoa: A4 em pé, calendário; a folha da equipe fica de fora (sem forçar paisagem).
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    const print = screen.getByTestId('personal-print');
    expect(print).toHaveAttribute('data-format', 'calendar');
    expect(print.querySelector('style')?.textContent).toContain('A4 portrait');
    expect(within(print).getAllByTestId('personal-page')).toHaveLength(1);
    expect(within(print).getByTestId('personal-calendar')).toBeInTheDocument();
    expect(print).toHaveTextContent('Rosa');
    expect(printSheet()).toHaveAttribute('data-print-skip');
    expect(printSheet().querySelector('style')).toBeNull();

    // "Tabela por semana" muda só a folha da equipe: a da pessoa continua em calendário.
    await userEvent.click(screen.getByRole('button', { name: 'Equipe toda' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tabela por semana' }));
    await choosePerson();
    expect(within(personalImage()).getByTestId('personal-calendar')).toBeInTheDocument();
    expect(within(personalImage()).getAllByTestId('personal-calendar-day')).toHaveLength(35);
  });

  it('não leva alertas nem "Funcionária mulher" para o calendário', async () => {
    const doc = appStore.getState().document;
    doc.schedule!.andreza = Array.from({ length: CYCLE_DAYS }, () => ({ status: 'work' as const }));
    appStore.getState().replaceDocument({ ...doc });
    const messages = projectMonth(doc, 2026, 12)!.alerts.map((a) => a.message);
    expect(messages.length).toBeGreaterThan(0);
    render(<ExportPanel month={DECEMBER} onClose={vi.fn()} />);
    await screen.findByText('Imagem de dezembro de 2026 pronta.');
    const team = [printSheet(), monthImage()].map((n) => n.textContent ?? '');
    await choosePerson();
    await screen.findByText('Imagem de Andreza pronta.');
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir todos (uma página por pessoa)' }));
    const personal = [personalImage(), screen.getByTestId('personal-print')].map((n) => n.textContent ?? '');
    for (const text of [...team, ...personal]) {
      expect(text).not.toMatch(/Funcionária mulher|alerta/i);
      for (const m of messages) expect(text).not.toContain(m);
    }
    for (const text of personal) expect(text).not.toMatch(/Falta|Dono\/família/);
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
