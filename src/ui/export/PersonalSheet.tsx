import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { COLUMN_NAMES } from '../../domain/types';
import { personalCalendarWeeks } from './calendarModel';
import { IMAGE_WIDTH, ImageActions, usePngFile } from './ImageExport';
import { DOWNLOADED_NOTICE, shareOrDownload } from './download';
import type { PersonalDay, PersonalModel } from './personalModel';
import './personal.css';
import './calendar.css';

/** Cabeçalho da escala individual: loja, pessoa, função, turno e período. */
function PersonalHeader({ model }: { model: PersonalModel }) {
  return (
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
  );
}

/** "06:30–14:00" que, se a coluna for estreita, quebra depois do traço (nunca no meio de um horário). */
function Breakable({ text }: { text: string }) {
  const parts = text.split('–');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              –<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** Conteúdo de um dia no calendário: horário, almoço, "cobre …" e jornadas extras; folga e loja fechada em destaque. */
function PersonalCalendarDay({ info }: { info: PersonalDay }) {
  return (
    <>
      {info.kind === 'work' ? (
        <>
          <span className="pc-time pp-num">
            {info.shiftTag && <b className="pc-tag">{info.shiftTag}</b>}
            {info.shiftTag && ' '}
            <span className="pc-range">
              <Breakable text={info.range ?? info.text} />
            </span>
          </span>
          {info.lunch && (
            <span className="pc-lunch pp-num">
              <Breakable text={info.lunch} />
            </span>
          )}
          {info.note && <span className="pc-note">{info.note}</span>}
        </>
      ) : (
        <span className={`pc-status pc-status-${info.kind}`}>{info.kind === 'closed' ? 'Loja fechada' : info.text}</span>
      )}
      {info.extras.map((x, i) => (
        <span key={i} className="pc-extra pp-num">
          {x.split(' · ').map((part, j) => (
            <span key={j} className="pc-extra-part">
              {j === 0 ? `+ ${part.charAt(0).toLocaleLowerCase('pt-BR')}${part.slice(1)}` : part}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

/**
 * Escala individual em calendário de parede (mês e ciclo): domingo a sábado, uma linha por semana, total da
 * semana na última coluna. No mês, cada dia tem o número e os de outro mês saem só com ele, em cinza; no ciclo,
 * a coluna do total diz qual semana é. O mesmo conteúdo serve para a prévia, a folha impressa e a imagem.
 */
export function PersonalCalendarBody({ model }: { model: PersonalModel }) {
  const weeks = personalCalendarWeeks(model);
  const days = model.weeks.flatMap((w) => w.days).filter((d) => !d.outside);
  const singleTags = [...new Set(days.filter((d) => d.shiftTag && d.text.startsWith('Turno único')).map((d) => d.shiftTag))];
  const hasOutside = weeks.some((w) => w.days.some((d) => d.outside));
  return (
    <article className="pp pc" data-scope={model.scope} data-format="calendar">
      <PersonalHeader model={model} />
      <table className="cal pc-cal" data-testid="personal-calendar">
        <thead>
          <tr>
            {COLUMN_NAMES.map((name) => (
              <th key={name} scope="col" className="cal-wd">
                {name}
              </th>
            ))}
            <th scope="col" className="cal-wd cal-total-head">
              Semana
            </th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.key} data-testid="personal-calendar-week">
              {w.days.map((d) => (
                <td
                  key={d.info.key}
                  className={d.outside ? 'cal-cell cal-outside' : `cal-cell pc-${d.info.kind}`}
                  data-testid="personal-calendar-day"
                  data-date={d.info.date}
                >
                  {d.day > 0 && <span className="cal-num pp-num">{d.day}</span>}
                  {!d.outside && <PersonalCalendarDay info={d.info} />}
                </td>
              ))}
              <td className="cal-total pp-num" data-testid="personal-calendar-total">
                {model.scope === 'cycle' && <span className="cal-week-name">{w.label}</span>}
                {w.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-foot pc-foot">
        {singleTags.map((t) => `${t} = turno único (todos no mesmo horário). `).join('')}
        Semana = horas trabalhadas de domingo a sábado
        {hasOutside ? ', contando os dias de outro mês (em cinza).' : '.'}
      </p>
    </article>
  );
}

/**
 * Folhas impressas por pessoa (uma página cada, em calendário), num portal "print-only" como a folha da equipe.
 * Só é montada quando a impressão escolhida é por pessoa; nesse caso a página vira A4 retrato.
 */
export function PersonalPrintSheet({ models }: { models: PersonalModel[] }) {
  return createPortal(
    <div className="print-only pp-print" data-testid="personal-print" data-format="calendar" aria-hidden="true">
      <style>{'@page { size: A4 portrait; margin: 10mm; }'}</style>
      {models.map((m) => (
        <div key={m.employeeId} className="pp-page" data-testid="personal-page">
          <PersonalCalendarBody model={m} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Imagem da escala individual para o WhatsApp: o PNG é gerado ao escolher a pessoa e compartilhado no toque. */
export function PersonalImageExport({ model, secondary }: { model: PersonalModel; secondary?: ReactNode }) {
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
      <ImageActions
        state={state}
        ready={`Imagem de ${model.name} pronta.`}
        onShare={share}
        onRetry={retry}
        secondary={secondary}
        notice={notice}
      />
      {createPortal(
        <div className="image-offscreen" aria-hidden="true">
          <div
            ref={nodeRef}
            className="pp-image"
            data-testid="personal-image"
            data-format="calendar"
            style={{ width: IMAGE_WIDTH }}
          >
            <p className="xi-brand">
              <span className="xi-dot" />
              Escala 5x2
            </p>
            <PersonalCalendarBody model={model} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
