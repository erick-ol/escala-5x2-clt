import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { toBlob } from 'html-to-image';
import { COLUMN_SHORT, DAYS_PER_WEEK, WEEKS } from '../../domain/types';
import { GapCellContent, ScheduleCellContent, cellClass } from './PrintSheet';
import { DOWNLOADED_NOTICE, shareOrDownload, slugify } from './download';
import type { ExportModel, ExportRow, GapRow, LegendItem, MonthExportModel } from './exportModel';

export const IMAGE_WIDTH = 1080;

type ImageState =
  | { status: 'pending' }
  | { status: 'ready'; file: File }
  | { status: 'error' };

export function imageTitle(storeName: string, week: number): string {
  return `${storeName} — Semana ${week + 1} de ${WEEKS}`;
}

export function imageFileName(storeName: string, week: number): string {
  return `escala-${slugify(storeName)}-semana-${week + 1}.png`;
}

/** Uma imagem (uma semana): do ciclo ou de datas reais do mês. */
export interface ImagePage {
  key: string;
  /** Texto do botão de escolha ("Semana 1", "30/11 – 06/12"). */
  button: string;
  /** Linha abaixo do nome da loja ("Semana 1 de 3", "Escala 30/11 – 06/12"). */
  heading: string;
  shareTitle: string;
  fileName: string;
  /** Aviso quando a imagem fica pronta. */
  ready: string;
  /** Cabeçalho das 7 colunas. */
  headers: string[];
  /** Colunas apagadas (datas fora do mês). */
  dim?: boolean[];
  rows: ExportRow[];
  gapRows: GapRow[];
}

export function cyclePages(model: ExportModel): ImagePage[] {
  return Array.from({ length: WEEKS }, (_, week) => {
    const from = week * DAYS_PER_WEEK;
    const slice = <T,>(cells: T[]) => cells.slice(from, from + DAYS_PER_WEEK);
    return {
      key: `s${week}`,
      button: `Semana ${week + 1}`,
      heading: `Semana ${week + 1} de ${WEEKS}`,
      shareTitle: imageTitle(model.storeName, week),
      fileName: imageFileName(model.storeName, week),
      ready: `Imagem da semana ${week + 1} pronta.`,
      headers: [...COLUMN_SHORT],
      rows: model.rows.map((r) => ({ ...r, cells: slice(r.cells) })),
      gapRows: model.gapRows.map((r) => ({ ...r, cells: slice(r.cells) })),
    };
  });
}

export function monthPages(model: MonthExportModel): ImagePage[] {
  return model.weeks.map((w) => ({
    key: w.sunday,
    button: w.label,
    heading: `Escala ${w.label}`,
    shareTitle: `${model.storeName} — Escala ${w.label}`,
    fileName: `escala-${slugify(model.storeName)}-${w.sunday}.png`,
    ready: `Imagem de ${w.label} pronta.`,
    headers: w.headers,
    dim: w.inMonth.map((x) => !x),
    rows: w.rows,
    gapRows: w.gapRows,
  }));
}

/** Conteúdo da imagem de uma semana (retrato, 1080px). Renderizado fora da tela só para virar PNG. */
function WeekImage({ storeName, legend, page }: { storeName: string; legend: LegendItem[]; page: ImagePage }) {
  const dim = (i: number) => (page.dim?.[i] ? ' wi-out' : '');
  const cells = page.rows.flatMap((r) => r.cells);
  return (
    <div className="wi">
      <header className="wi-header">
        <h1 className="wi-title">{storeName}</h1>
        <p className="wi-week">{page.heading}</p>
      </header>
      <table className="wi-table">
        <thead>
          <tr>
            <th className="wi-name" />
            {page.headers.map((text, i) => (
              <th key={i} className={dim(i).trim() || undefined}>
                {text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="wi-name">
                {row.name}
                {row.roleName && <small>{row.roleName}</small>}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className={`${cellClass(cell)}${dim(i)}`}>
                  <ScheduleCellContent cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {page.gapRows
            .filter((row) => row.cells.some((c) => c.kind !== 'none'))
            .map((row) => (
              <tr key={row.key} className="wi-gap-row">
                <th scope="row" className="wi-name">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={i} className={`xp-gap xp-gap-${cell.kind}${dim(i)}`}>
                    <GapCellContent cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      <ul className="wi-legend">
        {legend.map((l) => (
          <li key={l.initial}>
            <b>{l.initial}</b> {l.name} <span className="mono">{l.times}</span>
          </li>
        ))}
        <li>
          <b>F</b> Folga
        </li>
        <li>
          <b>—</b> Loja fechada
        </li>
        {cells.some((c) => c.kind === 'closed' && c.holiday) && (
          <li>
            <b>Fer.</b> Feriado
          </li>
        )}
        {cells.some((c) => c.kind === 'work' && c.flex) && (
          <li>
            <b>→</b> cobrindo outra função
          </li>
        )}
      </ul>
    </div>
  );
}

async function waitForFonts(): Promise<void> {
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    // sem suporte: segue com as fontes que houver
  }
}

/**
 * Gera o PNG do nó (fora da tela) sempre que `trigger` muda, antes do toque em "Compartilhar":
 * o compartilhamento precisa acontecer dentro do gesto do usuário, sem esperar a imagem.
 */
export function usePngFile(nodeRef: RefObject<HTMLElement>, fileName: string, trigger: unknown) {
  const [state, setState] = useState<ImageState>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'pending' });
    (async () => {
      try {
        await waitForFonts();
        const node = nodeRef.current;
        if (!node) throw new Error('sem nó');
        const blob = await toBlob(node, {
          width: IMAGE_WIDTH,
          pixelRatio: 1,
          backgroundColor: '#ffffff',
          cacheBust: true,
        });
        if (!blob) throw new Error('imagem vazia');
        if (cancelled) return;
        setState({ status: 'ready', file: new File([blob], fileName, { type: 'image/png' }) });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `trigger` muda junto com o conteúdo do nó (e o nome do arquivo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

export interface ImageExportProps {
  storeName: string;
  legend: LegendItem[];
  pages: ImagePage[];
}

/** Imagem para WhatsApp, uma por semana (KTD12). O PNG é gerado antes do toque em "Compartilhar". */
export function ImageExport({ storeName, legend, pages }: ImageExportProps) {
  const [index, setIndex] = useState(0);
  const week = Math.min(index, pages.length - 1);
  const page = pages[week];
  const nodeRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const { state, retry } = usePngFile(nodeRef, page.fileName, page);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(null), [page]);

  const share = async () => {
    if (state.status !== 'ready') return;
    setNotice(null);
    const outcome = await shareOrDownload(state.file, page.shareTitle);
    if (outcome === 'downloaded') setNotice(DOWNLOADED_NOTICE);
  };

  return (
    <div className="image-export">
      <div className="image-week-picker" role="group" aria-labelledby={labelId}>
        <span id={labelId} className="label">
          Semana
        </span>
        {pages.map((p, w) => (
          <button
            key={p.key}
            type="button"
            className={w === week ? 'week-btn is-active' : 'week-btn'}
            aria-pressed={w === week}
            onClick={() => setIndex(w)}
          >
            {p.button}
          </button>
        ))}
      </div>

      <div className="image-export-status" aria-live="polite">
        {state.status === 'pending' && <p className="hint">Gerando imagem…</p>}
        {state.status === 'ready' && <p className="hint">{page.ready}</p>}
      </div>
      {state.status === 'error' && (
        <p role="alert" className="error-text">
          Não foi possível gerar a imagem. Tente de novo ou use a impressão.
        </p>
      )}

      <div className="image-export-actions">
        <button type="button" className="btn btn-primary" disabled={state.status !== 'ready'} onClick={share}>
          Compartilhar
        </button>
        {state.status === 'error' && (
          <button type="button" className="btn" onClick={retry}>
            Tentar de novo
          </button>
        )}
      </div>
      {notice && <p className="hint">{notice}</p>}

      {createPortal(
        <div className="image-offscreen" aria-hidden="true">
          <div ref={nodeRef} data-testid="week-image" style={{ width: IMAGE_WIDTH }}>
            <WeekImage storeName={storeName} legend={legend} page={page} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
