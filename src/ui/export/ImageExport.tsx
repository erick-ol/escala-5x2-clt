import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toBlob } from 'html-to-image';
import { DAYS_PER_WEEK, WEEKDAY_SHORT, WEEKS } from '../../domain/types';
import { GapCellContent, ScheduleCellContent, cellClass } from './PrintSheet';
import { downloadBlob, slugify } from './download';
import type { ExportModel } from './exportModel';

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

/** Conteúdo da imagem de uma semana (retrato, 1080px). Renderizado fora da tela só para virar PNG. */
function WeekImage({ model, week }: { model: ExportModel; week: number }) {
  const from = week * DAYS_PER_WEEK;
  const range = Array.from({ length: DAYS_PER_WEEK }, (_, i) => from + i);
  return (
    <div className="wi">
      <header className="wi-header">
        <h1 className="wi-title">{model.storeName}</h1>
        <p className="wi-week">
          Semana {week + 1} de {WEEKS}
        </p>
      </header>
      <table className="wi-table">
        <thead>
          <tr>
            <th className="wi-name" />
            {range.map((d, i) => (
              <th key={d}>{WEEKDAY_SHORT[i]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="wi-name">
                {row.name}
                {row.roleName && <small>{row.roleName}</small>}
              </th>
              {range.map((d) => (
                <td key={d} className={cellClass(row.cells[d])}>
                  <ScheduleCellContent cell={row.cells[d]} />
                </td>
              ))}
            </tr>
          ))}
          {model.gapRows
            .filter((row) => range.some((d) => row.cells[d].kind !== 'none'))
            .map((row) => (
              <tr key={row.key} className="wi-gap-row">
                <th scope="row" className="wi-name">
                  {row.label}
                </th>
                {range.map((d) => (
                  <td key={d} className={`xp-gap xp-gap-${row.cells[d].kind}`}>
                    <GapCellContent cell={row.cells[d]} />
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      <ul className="wi-legend">
        {model.legend.map((l) => (
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

/** Imagem para WhatsApp, uma por semana (KTD12). O PNG é gerado antes do toque em "Compartilhar". */
export function ImageExport({ model }: { model: ExportModel }) {
  const [week, setWeek] = useState(0);
  const [state, setState] = useState<ImageState>({ status: 'pending' });
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nodeRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'pending' });
    setNotice(null);
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
        const file = new File([blob], imageFileName(model.storeName, week), { type: 'image/png' });
        setState({ status: 'ready', file });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model, week, attempt]);

  const share = async () => {
    if (state.status !== 'ready') return;
    const { file } = state;
    const title = imageTitle(model.storeName, week);
    const fallback = () => {
      downloadBlob(file, file.name);
      setNotice('Imagem baixada. Envie pelo WhatsApp a partir dos seus arquivos ou fotos.');
    };
    setNotice(null);
    let canShareFiles = false;
    try {
      canShareFiles = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
    } catch {
      canShareFiles = false;
    }
    if (!canShareFiles) {
      fallback();
      return;
    }
    try {
      await navigator.share({ files: [file], title });
    } catch (error) {
      // Usuário fechou a folha de compartilhamento: nada a fazer.
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return;
      fallback();
    }
  };

  return (
    <div className="image-export">
      <div className="week-picker" role="group" aria-labelledby={labelId}>
        <span id={labelId} className="label">
          Semana
        </span>
        {Array.from({ length: WEEKS }, (_, w) => (
          <button
            key={w}
            type="button"
            className={w === week ? 'week-btn is-active' : 'week-btn'}
            aria-pressed={w === week}
            onClick={() => setWeek(w)}
          >
            Semana {w + 1}
          </button>
        ))}
      </div>

      <div className="image-export-status" aria-live="polite">
        {state.status === 'pending' && <p className="hint">Gerando imagem…</p>}
        {state.status === 'ready' && <p className="hint">Imagem da semana {week + 1} pronta.</p>}
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
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </button>
        )}
      </div>
      {notice && <p className="hint">{notice}</p>}

      {createPortal(
        <div className="image-offscreen" aria-hidden="true">
          <div ref={nodeRef} data-testid="week-image" style={{ width: IMAGE_WIDTH }}>
            <WeekImage model={model} week={week} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
