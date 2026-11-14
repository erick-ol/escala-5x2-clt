import { useState } from 'react';
import { gapKey } from '../../domain/coverage';
import { generateSchedule } from '../../domain/generator';
import type { LegalAlert } from '../../domain/rules';
import { WEEKS } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { alertWeek, alertsInWeek, runGenerate, useDerived } from '../../state/useDerived';
import { ConfirmDialog } from '../ConfirmDialog';
import { AlertCounter, AlertList } from './AlertCounter';
import { CellEditor } from './CellEditor';
import { CoverageSummary } from './CoverageSummary';
import { GapSheet } from './GapSheet';
import { plural } from './labels';
import { useMediaQuery } from './useMediaQuery';
import { WeekGrid, type Highlight } from './WeekGrid';
import './schedule.css';

export interface ScheduleViewProps {
  onExport(): void;
  /** Erro de uma geração feita fora da tela (ex.: ao terminar a configuração). */
  initialError?: string | null;
}

type AlertFilter = { employeeId: string; week: number } | 'all';

/** Tabela do ciclo com resumo, alertas e edição ao vivo (U8). */
export function ScheduleView({ onExport, initialError = null }: ScheduleViewProps) {
  const doc = useAppStore((s) => s.document);
  const derived = useDerived();
  const wide = useMediaQuery('(min-width: 900px)');
  const [week, setWeek] = useState(0);
  const [error, setError] = useState<string | null>(initialError);
  const [editing, setEditing] = useState<{ employeeId: string; day: number } | null>(null);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<AlertFilter | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const generate = () => setError(runGenerate());

  if (!doc.schedule || !derived) {
    return (
      <section className="sv-empty card" aria-labelledby="sv-empty-title">
        <p className="label">Escala</p>
        <h2 id="sv-empty-title">{error ? 'A escala não foi gerada' : 'Nenhuma escala gerada ainda'}</h2>
        {error ? (
          <p role="alert" className="error-text">
            {error} Confira turnos, funções e equipe e tente de novo.
          </p>
        ) : (
          <p className="hint">Com a loja, os turnos e a equipe cadastrados, o site monta o ciclo de 3 semanas.</p>
        )}
        <button type="button" className="btn btn-primary" onClick={generate}>
          {error ? 'Tentar de novo' : 'Gerar escala'}
        </button>
      </section>
    );
  }

  const { coverage, alerts, reports } = derived;

  const hasManualChanges = () => {
    if (doc.marks.length > 0) return true;
    try {
      const fresh = generateSchedule({ config: doc.config, employees: doc.employees });
      return JSON.stringify(fresh) !== JSON.stringify(doc.schedule);
    } catch {
      return true;
    }
  };

  const onRegenerate = () => {
    if (hasManualChanges()) setConfirmRegen(true);
    else generate();
  };

  const selectAlert = (alert: LegalAlert) => {
    const w = alertWeek(alert);
    if (w !== null) setWeek(w);
    setAlertFilter(null);
    setHighlight({ employeeId: alert.employeeId, day: alert.day });
  };

  const gapEntry = (() => {
    if (!openGap) return null;
    const open = coverage.gaps.find((g) => gapKey(g) === openGap);
    if (open) return { gap: open, mark: undefined };
    const covered = coverage.covered.find((g) => gapKey(g) === openGap);
    if (!covered) return { gap: null, mark: undefined };
    const { mark, ...gap } = covered;
    return { gap, mark };
  })();

  const weeks = wide ? Array.from({ length: WEEKS }, (_, i) => i) : [week];
  const listAlerts =
    alertFilter === null
      ? []
      : alertFilter === 'all'
        ? alerts
        : alertsInWeek(reports[alertFilter.employeeId]?.alerts ?? [], alertFilter.week);
  const listTitle =
    alertFilter && alertFilter !== 'all'
      ? `${doc.employees.find((e) => e.id === alertFilter.employeeId)?.name ?? ''} · semana ${alertFilter.week + 1}`
      : plural(alerts.length, 'alerta no ciclo', 'alertas no ciclo');

  return (
    <div className="sv">
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {`${coverage.headline}. ${alerts.length === 0 ? 'Nenhum alerta legal' : plural(alerts.length, 'alerta legal', 'alertas legais')}.`}
      </div>

      <div className="sv-top">
        <CoverageSummary coverage={coverage} suggestions={derived.suggestions} />
        <AlertCounter count={alerts.length} onOpen={() => setAlertFilter('all')} />
      </div>

      {error && (
        <div className="sv-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-sm" onClick={generate}>
            Tentar de novo
          </button>
        </div>
      )}

      {!wide && (
        <div className="week-picker" role="group" aria-label="Semana do ciclo">
          {Array.from({ length: WEEKS }, (_, i) => (
            <button
              key={i}
              type="button"
              className="week-picker-btn"
              aria-pressed={week === i}
              onClick={() => setWeek(i)}
            >
              Semana {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className={`sv-weeks${wide ? ' is-wide' : ''}`}>
        {weeks.map((w) => (
          <section key={w} className="sv-week" aria-labelledby={`sv-week-${w}`}>
            <h2 id={`sv-week-${w}`} className="sv-week-title">
              Semana {w + 1}
            </h2>
            <WeekGrid
              week={w}
              doc={doc}
              derived={derived}
              highlight={highlight}
              onOpenCell={(employeeId, day) => {
                setHighlight(null);
                setEditing({ employeeId, day });
              }}
              onOpenGap={setOpenGap}
              onOpenAlerts={(employeeId, wk) => setAlertFilter({ employeeId, week: wk })}
            />
          </section>
        ))}
      </div>

      <p className="sv-legend" aria-label="Legenda">
        <span className="legend-chip legend-off">F</span> folga
        <span className="legend-chip legend-gap">▲ Falta</span> buraco
        <span className="legend-chip legend-alert">!</span> alerta legal
        <span className="legend-chip legend-covered">✓</span> coberto
      </p>

      <div className="sv-actionbar" role="region" aria-label="Ações da escala">
        <button type="button" className="btn" onClick={onRegenerate}>
          Regerar
        </button>
        <button type="button" className="btn btn-primary" onClick={onExport}>
          Exportar
        </button>
      </div>

      {editing && (
        <CellEditor
          employeeId={editing.employeeId}
          day={editing.day}
          alerts={reports[editing.employeeId]?.alerts ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      {gapEntry && <GapSheet gap={gapEntry.gap} mark={gapEntry.mark} onClose={() => setOpenGap(null)} />}

      {alertFilter !== null && (
        <AlertList
          title={listTitle}
          alerts={listAlerts}
          employees={doc.employees}
          onSelect={selectAlert}
          onClose={() => setAlertFilter(null)}
        />
      )}

      <ConfirmDialog
        open={confirmRegen}
        title="Regerar a escala?"
        confirmLabel="Regerar e perder ajustes"
        danger
        onCancel={() => setConfirmRegen(false)}
        onConfirm={() => {
          setConfirmRegen(false);
          generate();
        }}
      >
        <p>
          Some: trocas de folga, horários ajustados só num dia e marcações de cobertura. Fica: equipe, turnos e horários
          do cadastro.
        </p>
      </ConfirmDialog>
    </div>
  );
}
