import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { gapKey, type Gap } from '../../domain/coverage';
import { effectiveHours, effectiveShiftId, formatDuration, formatTime, weekdayOf } from '../../domain/time';
import { DAYS_PER_WEEK, WEEKDAY_NAMES, WEEKDAY_SHORT, type AppDocument, type CoverageMark, type Employee } from '../../domain/types';
import { alertsInWeek, type Derived } from '../../state/useDerived';
import { dayLabel, employeeName, plural, roleName, shiftInitial, shiftName, shiftTone, shortName } from './labels';

export interface Highlight {
  employeeId: string;
  day: number | null;
}

export interface WeekGridProps {
  week: number;
  doc: AppDocument;
  derived: Derived;
  highlight: Highlight | null;
  onOpenCell(employeeId: string, day: number): void;
  onOpenGap(key: string): void;
  onOpenAlerts(employeeId: string, week: number): void;
}

interface GapEntry {
  gap: Gap;
  mark?: CoverageMark;
}

type GridRow =
  | { kind: 'group'; key: string; shiftId: string | null; label: string; tone: string }
  | { kind: 'employee'; key: string; employee: Employee }
  | { kind: 'gap'; key: string; shiftId: string; roleId: string; slot: number; cells: (GapEntry | undefined)[] };

function buildRows(doc: AppDocument, derived: Derived, week: number): GridRow[] {
  const { config, employees } = doc;
  const first = week * DAYS_PER_WEEK;
  const inWeek = (g: Gap) => g.day >= first && g.day < first + DAYS_PER_WEEK;
  const entries: GapEntry[] = [
    ...derived.coverage.gaps.filter(inWeek).map((gap) => ({ gap })),
    ...derived.coverage.covered.filter(inWeek).map(({ mark, ...gap }) => ({ gap, mark })),
  ];

  const rows: GridRow[] = [];
  const known = new Set(config.shifts.map((s) => s.id));
  const groups: { shiftId: string | null; label: string; tone: string }[] = config.shifts.map((s) => ({
    shiftId: s.id,
    label: `${s.name} · ${formatTime(s.start)}–${formatTime(s.end)}`,
    tone: shiftTone(config, s.id),
  }));
  if (employees.some((e) => !known.has(e.shiftId))) groups.push({ shiftId: null, label: 'Sem turno', tone: 'none' });

  for (const group of groups) {
    const people = employees.filter((e) => (group.shiftId === null ? !known.has(e.shiftId) : e.shiftId === group.shiftId));
    const groupGaps = group.shiftId === null ? [] : entries.filter((x) => x.gap.shiftId === group.shiftId);
    if (people.length === 0 && groupGaps.length === 0) continue;
    rows.push({ kind: 'group', key: `g-${group.shiftId ?? 'none'}`, ...group });
    for (const employee of people) rows.push({ kind: 'employee', key: `e-${employee.id}`, employee });
    if (group.shiftId === null) continue;
    for (const role of config.roles) {
      const forRole = groupGaps.filter((x) => x.gap.roleId === role.id);
      if (forRole.length === 0) continue;
      const slots = Math.max(...forRole.map((x) => x.gap.slot)) + 1;
      for (let slot = 0; slot < slots; slot++) {
        const cells = Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
          forRole.find((x) => x.gap.slot === slot && x.gap.day === first + i),
        );
        rows.push({ kind: 'gap', key: `v-${group.shiftId}-${role.id}-${slot}`, shiftId: group.shiftId, roleId: role.id, slot, cells });
      }
    }
  }
  return rows;
}

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export function WeekGrid({ week, doc, derived, highlight, onOpenCell, onOpenGap, onOpenAlerts }: WeekGridProps) {
  const { config, employees, schedule } = doc;
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ r: number; c: number }>({ r: -1, c: -1 });
  const rows = buildRows(doc, derived, week);
  const first = week * DAYS_PER_WEEK;

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
    for (let k = r + step; k >= 0 && k < rows.length; k += step) if (focusAt(k, c)) return;
  };

  const tabIndexFor = (r: number, c: number) => (r === current.r && c === current.c ? 0 : -1);

  return (
    <div
      ref={gridRef}
      className="wg"
      role="grid"
      aria-label={`Escala da semana ${week + 1}`}
      aria-rowcount={rows.length + 1}
      onKeyDown={onKeyDown}
    >
      <div role="row" className="wg-line wg-head">
        <div role="columnheader" className="wg-corner">
          <span className="wg-week-tag">S{week + 1}</span>
        </div>
        {Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
          const day = first + i;
          const open = config.days[weekdayOf(day)]?.open;
          return (
            <div
              role="columnheader"
              key={day}
              className={`wg-dayhead${open ? '' : ' is-closed'}${weekdayOf(day) === 6 ? ' is-sunday' : ''}`}
              aria-label={`${WEEKDAY_NAMES[weekdayOf(day)]}, dia ${day + 1} do ciclo`}
            >
              <span className="wg-dayhead-name">{WEEKDAY_SHORT[weekdayOf(day)]}</span>
              <span className="wg-dayhead-num mono">{day + 1}</span>
            </div>
          );
        })}
      </div>

      {rows.map((row, r) => {
        if (row.kind === 'group') {
          return (
            <div role="row" key={row.key} className={`wg-group tone-${row.tone}`}>
              <div role="rowheader" className="wg-group-label">
                <span className="wg-group-swatch" aria-hidden="true" />
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
                <span className="wg-gapname-role">{shortName(role)}</span>
              </div>
              {row.cells.map((entry, c) => {
                if (!entry) return <div role="gridcell" key={c} className="wg-cell wg-cell-empty" />;
                const { gap, mark } = entry;
                const who = mark
                  ? mark.coveredBy.kind === 'owner'
                    ? 'Dono/família'
                    : employeeName(employees, mark.coveredBy.employeeId)
                  : null;
                const label = `${role}, ${shift}, ${dayLabel(gap.day)}: ${who ? `coberto por ${who}` : 'falta 1 pessoa'}`;
                return (
                  <div role="gridcell" key={c} className="wg-cell">
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
              <span className="wg-name-text">{shortName(employee.name)}</span>
            </div>
            {Array.from({ length: DAYS_PER_WEEK }, (_, c) => {
              const day = first + c;
              const cell = cells[day];
              const dayAlerts = (report?.alerts ?? []).filter((a) => a.day === day);
              const covering = coverMarks.filter((g) => g.day === day);
              const isHighlighted = highlight?.employeeId === employee.id && highlight.day === day;
              let label = `${employee.name}, ${dayLabel(day)}: `;
              let body;
              let cls = 'wg-btn';
              if (!cell || cell.status === 'closed') {
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
                const sid = effectiveShiftId(employee, cell);
                const hours = effectiveHours(config, employee, cell);
                label += `trabalha ${shiftName(config, sid).toLowerCase()}`;
                if (hours) label += ` ${formatTime(hours.start)}–${formatTime(hours.end)}`;
                if (cell.hours) label += ', horário ajustado neste dia';
                cls += ` wg-work tone-${shiftTone(config, sid)}`;
                if (sid !== employee.shiftId) cls += ' is-moved';
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
                  </>
                );
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
                <div role="gridcell" key={c} className="wg-cell">
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
                  aria-label={`${plural(weekAlerts.length, 'alerta', 'alertas')} de ${employee.name} na semana ${week + 1}`}
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
