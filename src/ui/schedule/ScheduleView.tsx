import { useState } from 'react';
import { gapKey } from '../../domain/coverage';
import { generateSchedule } from '../../domain/generator';
import type { LegalAlert } from '../../domain/rules';
import { WEEKS } from '../../domain/types';
import { weekOf } from '../../domain/time';
import { DayTimeline } from './DayTimeline';
import { useAppStore } from '../../state/store';
import { alertWeek, alertsInWeek, runGenerate, useDerived } from '../../state/useDerived';
import { ConfirmDialog } from '../ConfirmDialog';
import { AlertCounter, AlertList } from './AlertCounter';
import { CellEditor } from './CellEditor';
import { CoverageSummary } from './CoverageSummary';
import { GapSheet } from './GapSheet';
import { flexFor } from '../flex';
import { plural, roleName } from './labels';
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
  const [week, setWeek] = useState(0);
  const [error, setError] = useState<string | null>(initialError);
  const [editing, setEditing] = useState<{ employeeId: string; day: number } | null>(null);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<AlertFilter | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  /** Dia aberto na visão do dia; null = visão da semana. */
  const [dayView, setDayView] = useState<number | null>(null);
  /** Dia cujo cabeçalho recebe o foco ao voltar para a semana. */
  const [returnDay, setReturnDay] = useState<number | null>(null);

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

  const { coverage, alerts, reports, lunchGaps } = derived;

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
    setDayView(null);
    setReturnDay(null);
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

  const openDay = (day: number) => {
    setHighlight(null);
    setDayView(day);
  };
  const backToWeek = () => {
    if (dayView === null) return;
    setWeek(weekOf(dayView));
    setReturnDay(dayView);
    setDayView(null);
  };

  const weekLunchGaps = lunchGaps.filter((g) => weekOf(g.day) === week).length;
  const lunchLine =
    lunchGaps.length === 0
      ? null
      : weekLunchGaps > 0
        ? `Almoço sem cobertura: ${plural(weekLunchGaps, 'vez', 'vezes')} na semana ${week + 1}`
        : `Almoço sem cobertura: ${plural(lunchGaps.length, 'vez', 'vezes')} no ciclo`;
  const firstLunchGapDay = (() => {
    const inWeek = lunchGaps.filter((g) => weekOf(g.day) === week);
    const list = inWeek.length > 0 ? inWeek : lunchGaps;
    return list.length > 0 ? Math.min(...list.map((g) => g.day)) : null;
  })();
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
        {`${coverage.headline}. ${lunchLine ? `${lunchLine}. ` : ''}${alerts.length === 0 ? 'Nenhum alerta legal' : plural(alerts.length, 'alerta legal', 'alertas legais')}.`}
      </div>

      <div className="sv-top">
        <CoverageSummary
          coverage={coverage}
          suggestions={derived.suggestions}
          lunch={
            lunchLine && firstLunchGapDay !== null
              ? { text: lunchLine, onOpen: () => openDay(firstLunchGapDay) }
              : undefined
          }
        />
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

      {dayView === null ? (
        <>
          <div className="week-picker" role="group" aria-label="Semana do ciclo">
            {Array.from({ length: WEEKS }, (_, i) => (
              <button
                key={i}
                type="button"
                className="week-picker-btn"
                aria-pressed={week === i}
                onClick={() => {
                  setReturnDay(null);
                  setWeek(i);
                }}
              >
                Semana {i + 1}
              </button>
            ))}
          </div>

          <section className="sv-week" aria-labelledby={`sv-week-${week}`}>
            <h2 id={`sv-week-${week}`} className="sv-week-title">
              Semana {week + 1}
            </h2>
            <p className="sv-dayhint hint">Toque no dia (Seg, Ter…) para ver os horários e o almoço de cada pessoa.</p>
            <WeekGrid
              key={week}
              week={week}
              doc={doc}
              derived={derived}
              highlight={highlight}
              focusDay={returnDay}
              onOpenCell={(employeeId, day) => {
                setHighlight(null);
                setEditing({ employeeId, day });
              }}
              onOpenGap={setOpenGap}
              onOpenAlerts={(employeeId, wk) => setAlertFilter({ employeeId, week: wk })}
              onOpenDay={openDay}
            />
          </section>
        </>
      ) : (
        <DayTimeline
          day={dayView}
          doc={doc}
          derived={derived}
          onChangeDay={setDayView}
          onBack={backToWeek}
          onOpenCell={(employeeId, day) => setEditing({ employeeId, day })}
          onOpenGap={setOpenGap}
        />
      )}

      <p className="sv-legend" aria-label="Legenda">
        <span className="legend-chip legend-off">F</span> folga
        <span className="legend-chip legend-gap">▲ Falta</span> buraco
        <span className="legend-chip legend-alert">!</span> alerta legal
        <span className="legend-chip legend-covered">✓</span> coberto
        <span className="legend-chip legend-flex">→</span> cobrindo outra função
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
          plannedBreakStart={derived.lunchPlan[editing.employeeId]?.[editing.day] ?? null}
          coveringRole={(() => {
            const f = flexFor(coverage, editing.employeeId, editing.day);
            return f ? roleName(doc.config, f.roleId) : undefined;
          })()}
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
