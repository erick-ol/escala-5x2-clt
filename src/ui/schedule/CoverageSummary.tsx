import { useId, useState } from 'react';
import type { CoverageResult } from '../../domain/coverage';
import type { Suggestion } from '../../domain/suggestions';
import { plural } from './labels';

export interface CoverageSummaryProps {
  coverage: CoverageResult;
  suggestions: Map<string, Suggestion[]>;
}

/** Manchete da cobertura (R12); tocar abre as sugestões por padrão de buraco (R13). */
export function CoverageSummary({ coverage, suggestions }: CoverageSummaryProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { summary } = coverage;

  if (summary.length === 0) {
    return (
      <section className="cov cov-ok" aria-label="Cobertura">
        <span className="cov-ok-icon" aria-hidden="true">
          ✓
        </span>
        <div>
          <h2 className="cov-headline">Tudo coberto</h2>
          <p className="cov-sub">Todos os mínimos de cada turno estão atendidos nas 3 semanas.</p>
        </div>
      </section>
    );
  }

  const total = summary.reduce((acc, s) => acc + s.perWeek, 0);

  return (
    <section className="cov cov-gaps" aria-label="Cobertura">
      <button
        type="button"
        className="cov-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cov-num mono" aria-hidden="true">
          {total}
        </span>
        <span className="cov-text">
          <span className="cov-headline">{coverage.headline}</span>
          <span className="cov-more">{open ? 'Esconder sugestões' : 'Ver sugestões'}</span>
        </span>
        <span className={`cov-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          ›
        </span>
      </button>
      <div id={panelId} hidden={!open} className="cov-panel">
        {summary.map((item) => {
          const list = suggestions.get(`${item.roleId}|${item.shiftId}`) ?? [];
          return (
            <article key={`${item.roleId}|${item.shiftId}`} className="cov-item">
              <h3 className="cov-item-title">
                <span className="tag tag-gap">
                  <span aria-hidden="true">▲</span> {plural(item.perWeek, 'buraco', 'buracos')}/semana
                </span>
                {item.text}
              </h3>
              {list.length === 0 ? (
                <p className="hint">Nenhuma mudança simples reduz este buraco. Dá para marcar quem cobre na grade.</p>
              ) : (
                <ul className="cov-sugs">
                  {list.map((s, i) => (
                    <li key={i} className="cov-sug">
                      <span className="cov-sug-text">{s.text}</span>
                      <span className="cov-sug-delta mono">
                        buracos: {s.gapsBefore} → {s.gapsAfter} no ciclo
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
