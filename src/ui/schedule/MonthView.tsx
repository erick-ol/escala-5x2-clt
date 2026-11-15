import { useId, useMemo, useState, type ReactNode } from 'react';
import { DateInput } from '../DateInput';
import { gapKey } from '../../domain/coverage';
import { formatDayMonth, formatFullDate, isISODate, monthLabel, shiftMonth, weekdayOfDate } from '../../domain/dates';
import type { MonthAlert, ProjectedWeek } from '../../domain/month';
import { isInMonth } from '../../domain/month';
import type { LegalAlert } from '../../domain/rules';
import { weekdayOf } from '../../domain/time';
import { WEEKDAY_NAMES, type ISODate } from '../../domain/types';
import { appStore, useAppStore } from '../../state/store';
import { monthWeekDerived, useMonthProjection } from '../../state/useDerived';
import { flexFor } from '../flex';
import { AlertCounter, AlertList, WarningLine } from './AlertCounter';
import { CellEditor } from './CellEditor';
import { DayTimeline } from './DayTimeline';
import { GapSheet } from './GapSheet';
import { plural, roleName } from './labels';
import { Sheet } from './Sheet';
import { WeekGrid, type Highlight } from './WeekGrid';

export interface MonthViewProps {
  year: number;
  month: number;
  onChangeMonth(year: number, month: number): void;
  /** Seletor "Ciclo | Mês", mostrado junto da troca de mês. */
  switcher: ReactNode;
}

/** Posição de uma data na tela: semana (índice em `projection.weeks`) e coluna (0 = domingo … 6 = sábado). */
interface Slot {
  week: number;
  c: number;
}

const weekRange = (w: ProjectedWeek, sep = '–') => `${formatDayMonth(w.dates[0])} ${sep} ${formatDayMonth(w.dates[6])}`;

/** "Quarta, 02/12" ou "Semana de 30/11". */
export function monthAlertWhere(alert: LegalAlert): string {
  const a = alert as MonthAlert;
  if (a.date) {
    const span = a.endDate && a.endDate !== a.date ? ` a ${formatDayMonth(a.endDate)}` : '';
    return `${WEEKDAY_NAMES[weekdayOfDate(a.date)]}, ${formatDayMonth(a.date)}${span}`;
  }
  return a.weekStart ? `Semana de ${formatDayMonth(a.weekStart)}` : 'Mês';
}

/** Alertas de uma semana real: os da semana inteira e os que tocam alguma das 7 datas. */
function alertsOfWeek(w: ProjectedWeek, alerts: MonthAlert[]): MonthAlert[] {
  return alerts.filter((a) =>
    a.date === null ? a.weekStart === w.sunday : (a.endDate ?? a.date) >= w.dates[0] && a.date <= w.dates[6],
  );
}

/**
 * Visão Mês (ciclo aplicado no mês): o ciclo de 3 semanas projetado nas datas reais do mês escolhido,
 * com feriados e ajustes só da data. Alertas pelas regras CLT em sequência de datas.
 */
export function MonthView({ year, month, onChangeMonth, switcher }: MonthViewProps) {
  const doc = useAppStore((s) => s.document);
  const projection = useMonthProjection(year, month);
  const derived = useMemo(() => (projection ? projection.weeks.map((_, i) => monthWeekDerived(projection, i)) : []), [projection]);
  const [editing, setEditing] = useState<(Slot & { employeeId: string }) | null>(null);
  const [dateSheet, setDateSheet] = useState<Slot | null>(null);
  const [dayView, setDayView] = useState<Slot | null>(null);
  const [openGap, setOpenGap] = useState<{ week: number; key: string } | null>(null);
  const [alertList, setAlertList] = useState<'all' | { employeeId: string; week: number } | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [highlight, setHighlight] = useState<{ week: number; h: Highlight } | null>(null);
  const [editingStart, setEditingStart] = useState(false);
  const startInputId = useId();
  const startHintId = useId();

  if (!projection) return null;
  const { weeks } = projection;
  const label = monthLabel(year, month);
  const cycleStart = doc.calendar.cycleStart;

  const changeMonth = (delta: number) => {
    const next = shiftMonth(year, month, delta);
    setDayView(null);
    setHighlight(null);
    onChangeMonth(next.year, next.month);
  };

  /** Todas as datas mostradas (inclusive as de fora do mês, nas semanas da borda), em ordem. */
  const slots: Slot[] = weeks.flatMap((_, week) => Array.from({ length: 7 }, (_, c) => ({ week, c })));
  const slotIndex = (s: Slot) => s.week * 7 + s.c;
  const dateOf = (s: Slot) => weeks[s.week].dates[s.c];

  const selectAlert = (alert: LegalAlert) => {
    const a = alert as MonthAlert;
    let target: Slot | null = null;
    if (a.date) {
      const first = weeks[0].dates[0];
      const date = a.date < first ? first : a.date;
      const found = slots.find((s) => dateOf(s) === date);
      target = found ?? null;
    } else if (a.weekStart) {
      const week = weeks.findIndex((w) => w.sunday === a.weekStart);
      if (week >= 0) target = { week, c: 0 };
    }
    setAlertList(null);
    setDayView(null);
    if (!target) return;
    const w = weeks[target.week];
    setHighlight({ week: target.week, h: { employeeId: a.employeeId, day: a.date ? w.firstDay + target.c : null } });
  };

  const firstLunch = (() => {
    for (const [week, w] of weeks.entries()) {
      const g = w.lunchGaps.find((x) => isInMonth(w.dates[x.day - w.firstDay], year, month));
      if (g) return { week, c: g.day - w.firstDay };
    }
    return null;
  })();

  const gapEntry = (() => {
    if (!openGap) return null;
    const cov = derived[openGap.week]?.coverage;
    if (!cov) return null;
    const open = cov.gaps.find((g) => gapKey(g) === openGap.key);
    if (open) return { gap: open, mark: undefined };
    const covered = cov.covered.find((g) => gapKey(g) === openGap.key);
    if (!covered) return { gap: null, mark: undefined };
    const { mark, ...gap } = covered;
    return { gap, mark };
  })();

  const listAlerts =
    alertList === null
      ? []
      : alertList === 'all'
        ? projection.alerts
        : alertsOfWeek(weeks[alertList.week], projection.reports[alertList.employeeId]?.alerts ?? []);
  const listTitle =
    alertList && alertList !== 'all'
      ? `${doc.employees.find((e) => e.id === alertList.employeeId)?.name ?? ''} · ${weekRange(weeks[alertList.week])}`
      : plural(projection.alerts.length, 'alerta no mês', 'alertas no mês');

  /** Mínimos atendidos (os almoços sem cobertura aparecem numa linha à parte, como no ciclo). */
  const ok = projection.gapCount === 0;
  const lunchText = `Intervalo sem cobertura: ${plural(projection.lunchGapCount, 'vez', 'vezes')} no mês`;
  const gapText =
    projection.gapCount === 0 ? `Tudo coberto em ${label.toLowerCase()}` : `${plural(projection.gapCount, 'vaga sem ninguém', 'vagas sem ninguém')} no mês`;

  const onStartChange = (value: string) => {
    if (!isISODate(value)) return;
    appStore.getState().setCycleStart(value);
  };

  const day = dayView ? { slot: dayView, w: weeks[dayView.week] } : null;

  return (
    <div className="mv">
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {`${label}: ${gapText}. ${projection.lunchGapCount > 0 ? `${lunchText}. ` : ''}${projection.alerts.length === 0 ? 'Nenhum alerta legal' : plural(projection.alerts.length, 'alerta legal', 'alertas legais')} no mês.`}
      </div>

      <div className="sv-top">
        <section className={`cov mv-sum ${ok ? 'cov-ok' : 'cov-gaps'}`} aria-label="Cobertura do mês">
          <div className="mv-sum-main">
            <span className={ok ? 'cov-ok-icon' : 'cov-num mono'} aria-hidden="true">
              {ok ? '✓' : projection.gapCount}
            </span>
            <div>
              <h2 className="cov-headline">{gapText}</h2>
              <p className="cov-sub">
                {ok ? 'Todos os mínimos atendidos em todas as datas do mês.' : 'Contando só as datas deste mês, com feriados e ajustes.'}
              </p>
            </div>
          </div>
          {projection.lunchGapCount > 0 && firstLunch && (
            <button
              type="button"
              className="cov-lunch"
              onClick={() => {
                setHighlight(null);
                setDayView(firstLunch);
              }}
            >
              <span className="cov-lunch-icon" aria-hidden="true">
                ▲
              </span>
              <span className="cov-lunch-text">{lunchText}</span>
              <span className="cov-lunch-more">Ver o dia</span>
            </button>
          )}
        </section>
        <AlertCounter count={projection.alerts.length} onOpen={() => setAlertList('all')} />
        <WarningLine count={projection.warnings.length} onOpen={() => setWarningsOpen(true)} />
      </div>

      {day ? (
        <DayTimeline
          day={day.w.firstDay + day.slot.c}
          doc={day.w.doc}
          derived={derived[day.slot.week]}
          onChangeDay={() => {}}
          onBack={() => setDayView(null)}
          onOpenCell={(employeeId) => setEditing({ ...day.slot, employeeId })}
          onOpenGap={(key) => setOpenGap({ week: day.slot.week, key })}
          dateMode={(() => {
            const i = slotIndex(day.slot);
            const prev = slots[i - 1];
            const next = slots[i + 1];
            const name = (s: Slot) => `${WEEKDAY_NAMES[weekdayOfDate(dateOf(s))]}, ${formatDayMonth(dateOf(s))}`;
            return {
              title: `${WEEKDAY_NAMES[weekdayOfDate(dateOf(day.slot))]}, ${formatFullDate(dateOf(day.slot))} — Semana ${day.w.cycleWeek + 1} do ciclo`,
              holiday: day.w.holidays[day.slot.c],
              ...(prev ? { prev: { label: `Dia anterior: ${name(prev)}`, go: () => setDayView(prev) } } : {}),
              ...(next ? { next: { label: `Próximo dia: ${name(next)}`, go: () => setDayView(next) } } : {}),
            };
          })()}
        />
      ) : (
        <>
          <div className="mv-bar">
            {switcher}
            <div className="mv-monthnav" role="group" aria-label="Mês">
              <button type="button" className="btn btn-sm mv-monthbtn" aria-label="Mês anterior" onClick={() => changeMonth(-1)}>
                ‹
              </button>
              <h2 className="mv-month" aria-live="polite">
                {label}
              </h2>
              <button type="button" className="btn btn-sm mv-monthbtn" aria-label="Próximo mês" onClick={() => changeMonth(1)}>
                ›
              </button>
            </div>
          </div>

          <div className="mv-cycle">
            <p className="mv-cycle-line">
              O ciclo começa em: <strong>domingo, {formatFullDate(cycleStart)}</strong>{' '}
              <button
                type="button"
                className="link-btn"
                aria-expanded={editingStart}
                onClick={() => setEditingStart((v) => !v)}
              >
                {editingStart ? 'pronto' : 'alterar'}
              </button>
            </p>
            {editingStart && (
              <div className="field mv-cycle-field">
                <label htmlFor={startInputId}>Início do ciclo (domingo)</label>
                <DateInput id={startInputId} min="2020-01-05" value={cycleStart} aria-describedby={startHintId} onChange={onStartChange} />
              </div>
            )}
            <p id={startHintId} className="hint mv-cycle-hint">
              O ciclo de 3 semanas se repete a partir dessa data (semana 1, 2, 3, 1, 2, 3…). Outra data vira o
              domingo da mesma semana.
            </p>
            <p className="hint mv-cycle-hint">
              Toque numa data (Dom, Seg…) para marcar feriado ou ver o dia; toque numa célula para ajustar só aquela data.
            </p>
          </div>

          {weeks.map((w, i) => {
            const titleId = `mv-week-${w.sunday}`;
            return (
              <section key={w.sunday} className="mv-week" aria-labelledby={titleId}>
                <h3 id={titleId} className="mv-week-title">
                  <span className="mono">{weekRange(w)}</span>
                  <span className="mv-week-cycle"> · Semana {w.cycleWeek + 1} do ciclo</span>
                </h3>
                <WeekGrid
                  week={w.cycleWeek}
                  dates={{
                    dates: w.dates,
                    inMonth: w.dates.map((d) => isInMonth(d, year, month)),
                    holidays: w.holidays,
                    overridden: w.overridden,
                    range: weekRange(w, 'a'),
                  }}
                  doc={w.doc}
                  derived={derived[i]}
                  highlight={highlight?.week === i ? highlight.h : null}
                  onOpenCell={(employeeId, d) => {
                    setHighlight(null);
                    setEditing({ week: i, c: d - w.firstDay, employeeId });
                  }}
                  onOpenGap={(key) => setOpenGap({ week: i, key })}
                  onOpenAlerts={(employeeId) => setAlertList({ employeeId, week: i })}
                  onOpenDay={(d) => setDateSheet({ week: i, c: d - w.firstDay })}
                />
              </section>
            );
          })}
        </>
      )}

      {editing && weeks[editing.week] && (
        <CellEditor
          key={`${editing.employeeId}-${dateOf(editing)}`}
          employeeId={editing.employeeId}
          day={weeks[editing.week].firstDay + editing.c}
          date={dateOf(editing)}
          alerts={derived[editing.week].reports[editing.employeeId]?.alerts ?? []}
          warnings={derived[editing.week].reports[editing.employeeId]?.warnings ?? []}
          plannedBreakStart={derived[editing.week].lunchPlan[editing.employeeId]?.[weeks[editing.week].firstDay + editing.c] ?? null}
          coveringRole={(() => {
            const f = flexFor(derived[editing.week].coverage, editing.employeeId, weeks[editing.week].firstDay + editing.c);
            return f ? roleName(doc.config, f.roleId) : undefined;
          })()}
          onClose={() => setEditing(null)}
        />
      )}

      {dateSheet && weeks[dateSheet.week] && (
        <DateSheet
          date={dateOf(dateSheet)}
          cycleWeek={weeks[dateSheet.week].cycleWeek}
          onClose={() => setDateSheet(null)}
          onOpenDay={() => {
            const s = dateSheet;
            setDateSheet(null);
            setHighlight(null);
            setDayView(s);
          }}
        />
      )}

      {gapEntry && openGap && (
        <GapSheet
          gap={gapEntry.gap}
          mark={gapEntry.mark}
          readOnly={{
            kicker: gapEntry.gap
              ? `${WEEKDAY_NAMES[weekdayOf(gapEntry.gap.day)]}, ${formatDayMonth(weeks[openGap.week].dates[gapEntry.gap.day - weeks[openGap.week].firstDay])} · Semana ${weeks[openGap.week].cycleWeek + 1} do ciclo`
              : '',
            note: 'Quem cobre uma vaga se marca na visão Ciclo e vale para este dia em todas as repetições do ciclo. Para mudar só esta data, toque nas células e ajuste a escala da data.',
          }}
          onClose={() => setOpenGap(null)}
        />
      )}

      {warningsOpen && (
        <AlertList
          warning
          title={plural(projection.warnings.length, 'aviso no mês', 'avisos no mês')}
          alerts={projection.warnings}
          employees={doc.employees}
          where={monthAlertWhere}
          onSelect={(a) => {
            setWarningsOpen(false);
            selectAlert(a);
          }}
          onClose={() => setWarningsOpen(false)}
        />
      )}

      {alertList !== null && (
        <AlertList
          title={listTitle}
          alerts={listAlerts}
          employees={doc.employees}
          where={monthAlertWhere}
          onSelect={selectAlert}
          onClose={() => setAlertList(null)}
        />
      )}
    </div>
  );
}

interface DateSheetProps {
  date: ISODate;
  cycleWeek: number;
  onClose(): void;
  onOpenDay(): void;
}

/** Opções de uma data: feriado (loja fechada só nela), desfazer os ajustes da data e ver o dia. */
function DateSheet({ date, cycleWeek, onClose, onOpenDay }: DateSheetProps) {
  const config = useAppStore((s) => s.document.config);
  const closedDates = useAppStore((s) => s.document.calendar.closedDates);
  const overrides = useAppStore((s) => s.document.calendar.dateOverrides);
  const checkboxId = useId();
  const wd = weekdayOfDate(date);
  const open = !!config.days[wd]?.open;
  const holiday = closedDates.includes(date);
  const adjusted = overrides.filter((o) => o.date === date).length;

  return (
    <Sheet
      kicker={`Semana ${cycleWeek + 1} do ciclo`}
      title={`${WEEKDAY_NAMES[wd]}, ${formatFullDate(date)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onOpenDay}>
            Ver o dia
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      {open ? (
        <>
          <label className="date-holiday" htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={holiday}
              onChange={(e) => appStore.getState().setClosedDate(date, e.target.checked)}
            />
            <span>Loja fechada nesta data (feriado)</span>
          </label>
          <p className="hint">
            Todos ficam como “loja fechada” e a data não tem mínimo de cobertura. Conta como descanso. O ciclo não muda.
          </p>
        </>
      ) : (
        <p className="sheet-readonly">
          <span className="sheet-readonly-icon" aria-hidden="true">
            ×
          </span>
          A loja não abre neste dia da semana.
        </p>
      )}
      {adjusted > 0 && (
        <p className="hint">
          {plural(adjusted, 'pessoa com escala ajustada', 'pessoas com escala ajustada')} nesta data.{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              appStore.getState().setDateOverrides(appStore.getState().document.calendar.dateOverrides.filter((o) => o.date !== date))
            }
          >
            Voltar ao ciclo nesta data
          </button>
        </p>
      )}
    </Sheet>
  );
}
