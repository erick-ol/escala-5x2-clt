import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IMAGE_WIDTH, usePngFile } from './ImageExport';
import { DOWNLOADED_NOTICE, shareOrDownload } from './download';
import type { PersonalModel } from './personalModel';
import './personal.css';

/** Quebra a linha só entre as partes ("06:30–14:00 · almoço 09:45–10:45"), nunca no meio de um horário. */
function Segments({ text }: { text: string }) {
  const parts = text.split(' · ');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="pp-seg">
            {part}
            {i < parts.length - 1 && ' ·'}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Escala individual: cabeçalho (loja, pessoa, função, turno, período) e uma linha por dia, com o total da semana.
 * O mesmo conteúdo serve para a prévia no painel, a folha impressa (A4 retrato) e a imagem do WhatsApp.
 */
export function PersonalSheetBody({ model }: { model: PersonalModel }) {
  const hasOutside = model.weeks.some((w) => w.days.some((d) => d.outside));
  return (
    <article className="pp" data-scope={model.scope}>
      <header className="pp-head">
        <p className="pp-store">{model.storeName}</p>
        <h1 className="pp-name">{model.name}</h1>
        {model.roleLine && <p className="pp-role">{model.roleLine}</p>}
        {model.shiftLine && (
          <p className="pp-shift">
            Turno: <span className="pp-num">{model.shiftLine}</span>
          </p>
        )}
        <p className="pp-period">{model.periodLabel}</p>
      </header>
      <div className="pp-weeks">
        {model.weeks.map((w) => (
          <section key={w.key} className="pp-week" data-testid="personal-week">
            <h2 className="pp-week-title">
              <span>{w.label}</span>
              <span className="pp-total pp-num">
                <span className="pp-total-label">Total </span>
                {w.total}
              </span>
            </h2>
            <table className="pp-days">
              <tbody>
                {w.days.map((d) => (
                  <tr key={d.key} className={`pp-day pp-day-${d.kind}${d.outside ? ' pp-out' : ''}`} data-testid="personal-day">
                    <th scope="row" className="pp-date pp-num">
                      {d.label}
                    </th>
                    <td className="pp-what">
                      <span className="pp-text pp-num">
                        <Segments text={d.text} />
                      </span>
                      {d.note && <span className="pp-note">{d.note}</span>}
                      {d.extras.map((x, i) => (
                        <span key={i} className="pp-extra pp-num">
                          + <Segments text={x} />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {hasOutside && <p className="pp-foot">Datas em cinza e itálico são de outro mês.</p>}
    </article>
  );
}

/**
 * Folhas impressas por pessoa (uma página cada), num portal "print-only" como a folha da equipe.
 * Só é montada quando a impressão escolhida é por pessoa; nesse caso a página vira A4 retrato.
 */
export function PersonalPrintSheet({ models }: { models: PersonalModel[] }) {
  return createPortal(
    <div className="print-only pp-print" data-testid="personal-print" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>
      {models.map((m) => (
        <div key={m.employeeId} className="pp-page" data-testid="personal-page">
          <PersonalSheetBody model={m} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Imagem da escala individual para o WhatsApp: o PNG é gerado ao escolher a pessoa e compartilhado no toque. */
export function PersonalImageExport({ model }: { model: PersonalModel }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { state, retry } = usePngFile(nodeRef, model.fileName, model);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(null), [model]);

  const share = async () => {
    if (state.status !== 'ready') return;
    setNotice(null);
    const outcome = await shareOrDownload(state.file, model.shareTitle);
    if (outcome === 'downloaded') setNotice(DOWNLOADED_NOTICE);
  };

  return (
    <div className="pp-image-export">
      <button type="button" className="btn btn-primary" disabled={state.status !== 'ready'} onClick={share}>
        Imagem para WhatsApp
      </button>
      <div className="pp-image-status" aria-live="polite">
        {state.status === 'pending' && <p className="hint">Preparando a imagem de {model.name}…</p>}
        {state.status === 'ready' && <p className="hint">Imagem de {model.name} pronta.</p>}
      </div>
      {state.status === 'error' && (
        <div className="pp-image-error">
          <p role="alert" className="error-text">
            A imagem de {model.name} não saiu. Tente de novo ou imprima.
          </p>
          <button type="button" className="btn" onClick={retry}>
            Tentar de novo
          </button>
        </div>
      )}
      {notice && <p className="hint">{notice}</p>}
      {createPortal(
        <div className="image-offscreen" aria-hidden="true">
          <div ref={nodeRef} className="pp-image" data-testid="personal-image" style={{ width: IMAGE_WIDTH }}>
            <PersonalSheetBody model={model} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
