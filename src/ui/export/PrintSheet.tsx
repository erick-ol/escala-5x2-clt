import { createPortal } from 'react-dom';
import { CYCLE_DAYS, DAYS_PER_WEEK, WEEKDAY_SHORT } from '../../domain/types';
import { weekdayOf } from '../../domain/time';
import type { ExportCell, ExportModel, GapCell } from './exportModel';
import './print.css';

export function ScheduleCellContent({ cell }: { cell: ExportCell }) {
  if (cell.kind === 'off') return <span className="xp-off">F</span>;
  if (cell.kind === 'closed') return <span className="xp-closed">—</span>;
  return (
    <>
      <span className="xp-initial">{cell.initial}</span>
      <span className="xp-times mono">{cell.times}</span>
    </>
  );
}

export function GapCellContent({ cell }: { cell: GapCell }) {
  if (cell.kind === 'none') return null;
  if (cell.kind === 'missing') return <span className="xp-missing">✕ {cell.label}</span>;
  if (cell.kind === 'owner') return <span className="xp-owner">{cell.label}</span>;
  return <span className="xp-coverer">{cell.label}</span>;
}

export function cellClass(cell: ExportCell): string {
  return `xp-cell xp-cell-${cell.kind}`;
}

const days = Array.from({ length: CYCLE_DAYS }, (_, d) => d);

/** Folha de impressão do ciclo inteiro (R20, KTD12). Fica escondida na tela e é a única coisa impressa. */
export function PrintSheet({ model }: { model: ExportModel }) {
  return createPortal(
    <div className="print-only" data-testid="print-sheet" aria-hidden="true">
      <header className="ps-header">
        <h1 className="ps-title">{model.storeName}</h1>
        <p className="ps-sub">Escala 5x2 · ciclo de 3 semanas que se repete</p>
      </header>
      <ul className="ps-legend" aria-label="Legenda">
        {model.legend.map((l) => (
          <li key={l.initial}>
            <b>{l.initial}</b> = {l.name} <span className="mono">{l.times}</span>
          </li>
        ))}
        <li>
          <span className="xp-off">F</span> = Folga
        </li>
        <li>
          <span className="xp-closed">—</span> = Loja fechada
        </li>
        <li>
          <span className="xp-missing">✕ Falta</span> = vaga sem ninguém
        </li>
      </ul>
      <table className="ps-table">
        <thead>
          <tr>
            <th className="ps-name" rowSpan={2}>
              Nome
            </th>
            {[0, 1, 2].map((w) => (
              <th key={w} colSpan={DAYS_PER_WEEK} className="ps-week">
                Semana {w + 1}
              </th>
            ))}
          </tr>
          <tr>
            {days.map((d) => (
              <th key={d} className={d % DAYS_PER_WEEK === 0 ? 'ps-day ps-week-start' : 'ps-day'}>
                {WEEKDAY_SHORT[weekdayOf(d)]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id} data-testid="print-row">
              <th scope="row" className="ps-name">
                {row.name}
                {row.roleName && <small>{row.roleName}</small>}
              </th>
              {row.cells.map((cell, d) => (
                <td key={d} className={`${cellClass(cell)}${d % DAYS_PER_WEEK === 0 ? ' ps-week-start' : ''}`}>
                  <ScheduleCellContent cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {model.gapRows.length > 0 && (
            <tr className="ps-gap-heading">
              <th colSpan={CYCLE_DAYS + 1}>Vagas que a equipe não cobre</th>
            </tr>
          )}
          {model.gapRows.map((row) => (
            <tr key={row.key} className="ps-gap-row">
              <th scope="row" className="ps-name">
                {row.label}
              </th>
              {row.cells.map((cell, d) => (
                <td key={d} className={`xp-gap xp-gap-${cell.kind}${d % DAYS_PER_WEEK === 0 ? ' ps-week-start' : ''}`}>
                  <GapCellContent cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ps-foot">
        Ferramenta orientativa baseada na EC 141/2026. Não substitui orientação jurídica nem convenção coletiva.
      </p>
    </div>,
    document.body,
  );
}
