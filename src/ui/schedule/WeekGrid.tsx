import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { gapKey, type Gap } from '../../domain/coverage';
import {
  effectiveHours,
  effectiveShiftId,
  formatDuration,
  formatTime,
  isSingleShiftDay,
  isVirtualShiftId,
  registeredHours,
  weekdayOf,
} from '../../domain/time';
import { formatDayMonth } from '../../domain/dates';
import { DAYS_PER_WEEK, WEEKDAY_NAMES, WEEKDAY_SHORT, type AppDocument, type CoverageMark, type Employee, type ISODate } from '../../domain/types';
import { alertsInWeek, type Derived } from '../../state/useDerived';
import { flexFor, flexTag } from '../flex';
import { dayLabel, employeeName, plural, roleName, shiftInitial, shiftName, shiftTone, shortName } from './labels';

export interface Highlight {
  employeeId: string;
  day: number | null;
}

/** Visão Mês: a semana mostra datas reais (cabeçalhos, rótulos, feriados e ajustes da data). */
export interface WeekDates {
  /** As 7 datas, de segunda a domingo. */
  dates: ISODate[];
  /** Data dentro do mês escolhido (fora dele, a coluna fica apagada). */
  inMonth: boolean[];
  /** Loja fechada só nesta data (feriado). */
  holidays: boolean[];
  /** Células ajustadas só na data: `${employeeId}|${i}`. */
  overridden: ReadonlySet<string>;
  /** "30/11 a 06/12" */
  range: string;
}

export interface WeekGridProps {
  week: number;
  /** Visão Mês: datas reais desta semana. Sem isso, a grade mostra os dias do ciclo. */
  dates?: WeekDates;
  doc: AppDocument;
  derived: Derived;
  highlight: Highlight | null;
  /** Dia cujo cabeçalho recebe o foco ao montar (ao voltar da visão do dia). */
  focusDay?: number | null;
  onOpenCell(employeeId: string, day: number): void;
  onOpenGap(key: string): void;
  onOpenAlerts(employeeId: string, week: number): void;
  onOpenDay(day: number): void;
}

interface GapEntry {
  gap: Gap;
  mark?: CoverageMark;
}

type GridRow =
  | { kind: 'group'; key: string; roleId: string | null; label: string }
  | { kind: 'employee'; key: string; employee: Employee }
  | { kind: 'gap'; key: string; shiftId: string; roleId: string; slot: number; cells: (GapEntry | undefined)[] };

/** Linhas da semana agrupadas pela função principal; as faltas de cada função ficam no fim do grupo, uma por turno. */
function buildRows(doc: AppDocument, derived: Derived, week: number): GridRow[] {
  const { config, employees } = doc;
  const first = week * DAYS_PER_WEEK;
  const inWeek = (g: Gap) => g.day >= first && g.day < first + DAYS_PER_WEEK;
  const entries: GapEntry[] = [
    ...derived.coverage.gaps.filter(inWeek).map((gap) => ({ gap })),
    ...derived.coverage.covered.filter(inWeek).map(({ mark, ...gap }) => ({ gap, mark })),
  ];

  const rows: GridRow[] = [];
  const known = new Set(config.roles.map((r) => r.id));
  const groups: { roleId: string | null; label: string }[] = config.roles.map((r) => ({ roleId: r.id, label: r.name }));
  if (employees.some((e) => !known.has(e.roleId))) groups.push({ roleId: null, label: 'Sem função' });

  for (const group of groups) {
    const people = employees.filter((e) => (group.roleId === null ? !known.has(e.roleId) : e.roleId === group.roleId));
    const groupGaps = group.roleId === null ? [] : entries.filter((x) => x.gap.roleId === group.roleId);
    if (people.length === 0 && groupGaps.length === 0) continue;
    rows.push({ kind: 'group', key: `g-${group.roleId ?? 'none'}`, ...group });
    for (const employee of people) rows.push({ kind: 'employee', key: `e-${employee.id}`, employee });
    if (group.roleId === null) continue;
    const shiftIds = [...config.shifts.map((s) => s.id), ...new Set(groupGaps.map((x) => x.gap.shiftId))];
    for (const shiftId of new Set(shiftIds)) {
      const forShift = groupGaps.filter((x) => x.gap.shiftId === shiftId);
      if (forShift.length === 0) continue;
      const slots = Math.max(...forShift.map((x) => x.gap.slot)) + 1;
      for (let slot = 0; slot < slots; slot++) {
        const cells = Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
          forShift.find((x) => x.gap.slot === slot && x.gap.day === first + i),
        );
        rows.push({ kind: 'gap', key: `v-${group.roleId}-${shiftId}-${slot}`, shiftId, roleId: group.roleId, slot, cells });
      }
    }
  }
  return rows;
}

/** "Manhã 06:30–14:00": turno do cadastro com o horário da pessoa. */
function shiftLabel(config: AppDocument['config'], employee: Employee): string {
  const hours = registeredHours(config, employee);
  const name = shiftName(config, employee.shiftId);
  return hours ? `${name} ${formatTime(hours.start)}–${formatTime(hours.end)}` : name;
}

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
/** Linha dos cabeçalhos de dia na navegação por setas. */
const HEAD_ROW = -1;

export function WeekGrid({
  week,
  dates,
  doc,
  derived,
  highlight,
  focusDay = null,
  onOpenCell,
  onOpenGap,
  onOpenAlerts,
  onOpenDay,
}: WeekGridProps) {
  const { config, employees, schedule } = doc;
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ r: number; c: number }>({ r: -1, c: -1 });
  const rows = buildRows(doc, derived, week);
  const first = week * DAYS_PER_WEEK;
  /** Rótulo do dia nos nomes acessíveis: "quarta, semana 1" ou, no mês, "quarta 02/12". */
  const labelOf = (day: number) =>
    dates ? `${WEEKDAY_NAMES[weekdayOf(day)].toLowerCase()} ${formatDayMonth(dates.dates[day - first])}` : dayLabel(day);
  const outClass = (c: number) => (dates && !dates.inMonth[c] ? ' is-out' : '');

  // Primeira célula navegável recebe o tabindex=0 quando ainda não há célula ativa.
  const navRows = rows.map((row) => row.kind !== 'group');
  const firstNav = navRows.indexOf(true);
  const current = active.r >= 0 ? active : { r: firstNav, c: 0 };

  useEffect(() => {
    if (!highlight || !gridRef.current) return;
    const r = rows.findIndex((row) => row.kind === 'employee' && row.employee.id === highlight.employeeId);
    if (r < 0) return;
    const day = highlight.day ?? first;
    if (day < first || day >= first + DAYS_PER_WEEK) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${day - first}"]`);
    if (el) {
      setActive({ r, c: day - first });
      el.focus();
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    // rows muda a cada render; o foco só deve acontecer quando o destaque muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, first]);

  const focusAt = (r: number, c: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (!el) return false;
    setActive({ r, c });
    el.focus();
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.dataset.r === undefined) return;
    event.preventDefault();
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    const last = DAYS_PER_WEEK - 1;
    if (event.key === 'Home' || event.key === 'End') {
      const step = event.key === 'Home' ? 1 : -1;
      for (let k = step === 1 ? 0 : last; k >= 0 && k <= last; k += step) if (focusAt(r, k)) return;
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      for (let k = c + step; k >= 0 && k <= last; k += step) if (focusAt(r, k)) return;
      return;
    }
    const step = event.key === 'ArrowUp' ? -1 : 1;
    for (let k = r + step; k >= HEAD_ROW && k < rows.length; k += step) if (focusAt(k, c)) return;
  };

  const tabIndexFor = (r: number, c: number) => (r === current.r && c === current.c ? 0 : -1);

  // Ao voltar da visão do dia, o foco volta ao cabeçalho daquele dia.
  useEffect(() => {
    if (focusDay === null || focusDay < first || focusDay >= first + DAYS_PER_WEEK) return;
    focusAt(HEAD_ROW, focusDay - first);
  }, [focusDay, first]);

  return (
    <div
      ref={gridRef}
      className="wg"
      role="grid"
      aria-label={dates ? `Escala de ${dates.range}` : `Escala da semana ${week + 1}`}
      aria-rowcount={rows.length + 1}
      onKeyDown={onKeyDown}
    >
      <div role="row" className="wg-line wg-head">
        <div role="columnheader" className="wg-corner">
          <span className="wg-week-tag">S{week + 1}</span>
        </div>
        {Array.from({ length: DAYS_PER_WEEK }, (_, c) => {
          const day = first + c;
          const wd = weekdayOf(day);
          const open = config.days[wd]?.open;
          const single = isSingleShiftDay(config, wd);
          const holiday = !!dates?.holidays[c];
          const date = dates?.dates[c];
          const label = date
            ? `${WEEKDAY_NAMES[wd]}, ${formatDayMonth(date)}${holiday ? ', fechado (feriado)' : single ? ', turno único' : ''}${dates?.inMonth[c] ? '' : ', fora do mês'}: opções da data`
            : `${WEEKDAY_NAMES[wd]}, dia ${day + 1} do ciclo${single ? ', turno único' : ''}: ver o dia`;
          return (
            <div
              role="columnheader"
              key={day}
              className={`wg-dayhead${open ? '' : ' is-closed'}${holiday ? ' is-holiday' : ''}${wd === 6 ? ' is-sunday' : ''}${outClass(c)}`}
            >
              <button
                type="button"
                className="wg-daybtn"
                aria-label={label}
                data-r={HEAD_ROW}
                data-c={c}
                tabIndex={tabIndexFor(HEAD_ROW, c)}
                onFocus={() => setActive({ r: HEAD_ROW, c })}
                onClick={() => onOpenDay(day)}
              >
                <span className="wg-dayhead-name">{WEEKDAY_SHORT[wd]}</span>
                <span className="wg-dayhead-num mono">{date ? formatDayMonth(date) : day + 1}</span>
                <span className="wg-dayhead-more" aria-hidden="true">
                  {holiday ? 'feriado' : single ? 'único' : date ? 'data' : 'ver'}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {rows.map((row, r) => {
        if (row.kind === 'group') {
          return (
            <div role="row" key={row.key} className="wg-group">
              <div role="rowheader" className="wg-group-label">
                {row.label}
              </div>
            </div>
          );
        }

        if (row.kind === 'gap') {
          const role = roleName(config, row.roleId);
          const shift = shiftName(config, row.shiftId).toLowerCase();
          return (
            <div role="row" key={row.key} className="wg-line wg-gaprow">
              <div role="rowheader" className="wg-name wg-gapname" aria-label={`Vagas faltantes: ${role}, ${shift}`}>
                <span className="wg-gapname-kicker">falta</span>
                <span className="wg-gapname-role">{shiftName(config, row.shiftId)}</span>
              </div>
              {row.cells.map((entry, c) => {
                if (!entry) return <div role="gridcell" key={c} className={`wg-cell wg-cell-empty${outClass(c)}`} />;
                const { gap, mark } = entry;
                const who = mark
                  ? mark.coveredBy.kind === 'owner'
                    ? 'Dono/família'
                    : employeeName(employees, mark.coveredBy.employeeId)
                  : null;
                const label = `${role}, ${shift}, ${labelOf(gap.day)}: ${who ? `coberto por ${who}` : 'falta 1 pessoa'}`;
                return (
                  <div role="gridcell" key={c} className={`wg-cell${outClass(c)}`}>
                    <button
                      type="button"
                      className={`wg-btn ${mark ? 'wg-covered' : 'wg-gap'}`}
                      aria-label={label}
                      data-r={r}
                      data-c={c}
                      tabIndex={tabIndexFor(r, c)}
                      onFocus={() => setActive({ r, c })}
                      onClick={() => onOpenGap(gapKey(gap))}
                    >
                      {who ? (
                        <>
                          <span className="wg-covered-check" aria-hidden="true">
                            ✓
                          </span>
                          <span className="wg-covered-name">{mark?.coveredBy.kind === 'owner' ? 'Dono' : shortName(who)}</span>
                        </>
                      ) : (
                        <>
                          <span className="wg-gap-icon" aria-hidden="true">
                            ▲
                          </span>
                          <span className="wg-gap-text">Falta</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        }

        const { employee } = row;
        const cells = schedule?.[employee.id] ?? [];
        const report = derived.reports[employee.id];
        const weekAlerts = alertsInWeek(report?.alerts ?? [], week);
        const minutes = report?.weeklyMinutes[week] ?? 0;
        const coverMarks = derived.coverage.covered.filter(
          (g) => g.mark.coveredBy.kind === 'employee' && g.mark.coveredBy.employeeId === employee.id,
        );

        return (
          <div role="row" key={row.key} className="wg-line wg-person">
            <div role="rowheader" className="wg-name" aria-label={employee.name} title={employee.name}>
              <span className="wg-name-full" aria-hidden="true">
                {employee.name}
              </span>
              <span className="wg-name-short" aria-hidden="true">
                {shortName(employee.name)}
              </span>
            </div>
            {Array.from({ length: DAYS_PER_WEEK }, (_, c) => {
              const day = first + c;
              const cell = cells[day];
              const dayAlerts = (report?.alerts ?? []).filter((a) => a.day === day);
              const covering = coverMarks.filter((g) => g.day === day);
              const flex = cell?.status === 'work' ? flexFor(derived.coverage, employee.id, day) : undefined;
              const isHighlighted = highlight?.employeeId === employee.id && highlight.day === day;
              const dated = !!dates?.overridden.has(`${employee.id}|${c}`);
              let label = `${employee.name}, ${labelOf(day)}: `;
              let body;
              let cls = 'wg-btn';
              if (dates?.holidays[c]) {
                label += 'fechado (feriado)';
                cls += ' wg-closed wg-holiday';
                body = <span className="wg-closed-text">Feriado</span>;
              } else if (!cell || cell.status === 'closed') {
                label += 'loja fechada';
                cls += ' wg-closed';
                body = <span className="wg-closed-text">Fech.</span>;
              } else if (cell.status === 'off') {
                label += 'folga';
                cls += ' wg-off';
                body = (
                  <span className="wg-off-text" aria-hidden="true">
                    F
                  </span>
                );
              } else {
                const sid = effectiveShiftId(config, employee, cell, day);
                const hours = effectiveHours(config, employee, cell, day);
                label += `trabalha ${shiftName(config, sid).toLowerCase()}`;
                if (hours) label += ` ${formatTime(hours.start)}–${formatTime(hours.end)}`;
                if (cell.hours) label += ', horário ajustado neste dia';
                if (flex) {
                  label += `, cobrindo ${roleName(config, flex.roleId)}`;
                  cls += ' is-flex';
                }
                cls += ` wg-work tone-${shiftTone(config, sid)}`;
                if (sid !== employee.shiftId && !isVirtualShiftId(sid)) cls += ' is-moved';
                body = (
                  <>
                    <span className="wg-shift" aria-hidden="true">
                      {shiftInitial(config, sid)}
                    </span>
                    {hours && (
                      <span className="wg-time mono" aria-hidden="true">
                        {formatTime(hours.start)}
                      </span>
                    )}
                    {cell.hours && <span className="wg-adjusted" aria-hidden="true" />}
                    {flex && (
                      <span className="wg-flex" aria-hidden="true">
                        {flexTag(roleName(config, flex.roleId))}
                      </span>
                    )}
                  </>
                );
              }
              if (dated) {
                label += ', ajustado nesta data';
                cls += ' is-dated';
              }
              if (covering.length > 0) {
                const what = covering.map((g) => `${roleName(config, g.roleId)} ${shiftName(config, g.shiftId).toLowerCase()}`);
                label += `, cobre ${what.join(' e ')}`;
                cls += ' is-covering';
              }
              if (dayAlerts.length > 0) {
                label += `, ${plural(dayAlerts.length, 'alerta legal', 'alertas legais')}`;
                cls += ' has-alert';
              }
              if (isHighlighted) cls += ' is-highlighted';
              return (
                <div role="gridcell" key={c} className={`wg-cell${outClass(c)}`}>
                  <button
                    type="button"
                    className={cls}
                    aria-label={label}
                    data-r={r}
                    data-c={c}
                    tabIndex={tabIndexFor(r, c)}
                    onFocus={() => setActive({ r, c })}
                    onClick={() => onOpenCell(employee.id, day)}
                  >
                    {body}
                    {dated && <span className="wg-dated" aria-hidden="true" />}
                    {covering.length > 0 && (
                      <span className="wg-plus" aria-hidden="true">
                        +
                      </span>
                    )}
                    {dayAlerts.length > 0 && (
                      <span className="wg-alert-dot" aria-hidden="true">
                        !
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
            <div role="gridcell" className="wg-meta">
              <span className="wg-shiftlabel mono">{shiftLabel(config, employee)}</span>
              <span className="wg-hours">
                <span className="visually-hidden">Horas na semana: </span>
                <span className="mono">{formatDuration(minutes)}</span>
                <span className="wg-hours-unit" aria-hidden="true">
                  {' '}
                  na semana
                </span>
              </span>
              {weekAlerts.length > 0 && (
                <button
                  type="button"
                  className="wg-alert-btn"
                  aria-label={`${plural(weekAlerts.length, 'alerta', 'alertas')} de ${employee.name} ${dates ? `de ${dates.range}` : `na semana ${week + 1}`}`}
                  onClick={() => onOpenAlerts(employee.id, week)}
                >
                  <span className="wg-alert-btn-icon" aria-hidden="true">
                    !
                  </span>
                  {plural(weekAlerts.length, 'alerta', 'alertas')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
