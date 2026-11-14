import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COLUMN_NAMES } from '../../domain/types';
import { IMAGE_WIDTH, usePngFile } from './ImageExport';
import { DOWNLOADED_NOTICE, shareOrDownload } from './download';
import type { TeamCalendarDay, TeamCalendarModel, TeamCalendarWeek } from './calendarModel';
import './calendar.css';

function DayContent({ day, showMissing }: { day: TeamCalendarDay; showMissing: boolean }) {
  if (day.kind === 'outside') return null;
  if (day.kind === 'holiday') return <span className="cal-status">Feriado — fechado</span>;
  if (day.kind === 'closed') return <span className="cal-status">Loja fechada</span>;
  return (
    <>
      {day.groups.map((g) => (
        <span key={g.initial} className="tc-group" data-testid="calendar-shift">
          <b className="tc-initial">{g.initial}</b>{' '}
          {g.entries.map((e, i) => (
            <Fragment key={i}>
              {i > 0 && ', '}
              <span className={e.cover ? `tc-name tc-cover-${e.cover}` : 'tc-name'}>
                {e.name}
                {e.tag && <span className="tc-tag"> {e.tag}</span>}
              </span>
            </Fragment>
          ))}
        </span>
      ))}
      {day.off.length > 0 && <span className="tc-off">Folga: {day.off.join(', ')}</span>}
      {showMissing && day.missing.map((m) => (
        <span key={m} className="tc-missing">
          {m}
        </span>
      ))}
    </>
  );
}

/** Calendário da equipe: 7 colunas (domingo a sábado), uma linha por semana do mês. */
export function TeamCalendarTable({ weeks, showMissing }: { weeks: TeamCalendarWeek[]; showMissing: boolean }) {
  return (
    <table className="cal tc-cal" data-testid="team-calendar">
      <thead>
        <tr>
          {COLUMN_NAMES.map((name) => (
            <th key={name} scope="col" className="cal-wd">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w.sunday} data-testid="calendar-week">
            {w.days.map((d) => (
              <td key={d.date} className={`cal-cell cal-${d.kind}`} data-testid="calendar-day" data-date={d.date}>
                <span className="cal-num">{d.day}</span>
                <DayContent day={d} showMissing={showMissing} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamCalendarLegend({ model, showMissing }: { model: TeamCalendarModel; showMissing: boolean }) {
  return (
    <ul className="tc-legend" aria-label="Legenda">
      {model.legend.map((l) => (
        <li key={l.initial}>
          <b>{l.initial}</b> = {l.name} <span className="tc-mono">{l.times}</span>
        </li>
      ))}
      {model.hasFlex && (
        <li>
          <b>→</b> = cobrindo outra função
        </li>
      )}
      {model.hasCoverer && (
        <li>
          <span className="tc-cover-employee">Nome sublinhado</span> = jornada extra cobrindo uma vaga
        </li>
      )}
      {showMissing && model.hasMissing && <li>Falta = vaga sem ninguém</li>}
    </ul>
  );
}

function TeamCalendarHeader({ model, page, pages }: { model: TeamCalendarModel; page?: number; pages?: number }) {
  return (
    <header className="tc-head">
      <p className="tc-store">{model.storeName}</p>
      <h1 className="tc-title">
        {model.monthLabel}
        {pages && pages > 1 ? <small> · folha {page! + 1} de {pages}</small> : null}
      </h1>
    </header>
  );
}

/**
 * Folha de impressão do mês em calendário (A4 deitada, uma página; duas para equipes grandes).
 * `skip`: outra folha (a escala por pessoa) foi escolhida para esta impressão.
 */
export function TeamCalendarPrintSheet({ model, skip }: { model: TeamCalendarModel; skip?: boolean }) {
  const pages = model.printPages;
  return createPortal(
    <div
      className="print-only tc-print"
      data-testid="print-sheet"
      data-scope="month"
      data-format="calendar"
      data-print-skip={skip || undefined}
      aria-hidden="true"
    >
      {!skip && <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>}
      {pages.map((weeks, i) => (
        <section key={i} className="tc-page" data-testid="calendar-page">
          <TeamCalendarHeader model={model} page={i} pages={pages.length} />
          <TeamCalendarLegend model={model} showMissing />
          <TeamCalendarTable weeks={weeks} showMissing />
          <p className="tc-foot">
            Ferramenta orientativa baseada na EC 141/2026. Não substitui orientação jurídica nem convenção coletiva.
          </p>
        </section>
      ))}
    </div>,
    document.body,
  );
}

/** Imagem do mês inteiro em calendário (1080px de largura) para o WhatsApp. */
export function TeamCalendarImageExport({ model }: { model: TeamCalendarModel }) {
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
    <div className="image-export">
      <div className="image-export-status" aria-live="polite">
        {state.status === 'pending' && <p className="hint">Gerando imagem…</p>}
        {state.status === 'ready' && <p className="hint">Imagem de {model.monthLabel.toLowerCase()} pronta.</p>}
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
          <div ref={nodeRef} className="tc-image" data-testid="month-image" style={{ width: IMAGE_WIDTH }}>
            <TeamCalendarHeader model={model} />
            <TeamCalendarLegend model={model} showMissing={false} />
            <TeamCalendarTable weeks={model.weeks} showMissing={false} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
