import { useEffect, useRef } from 'react';
import { gapKey, shiftPhrase, type Gap } from '../../domain/coverage';
import type { PresenceBlock } from '../../domain/lunch';
import { MINUTES_PER_DAY, findShift, formatTime, weekOf, weekdayOf } from '../../domain/time';
import { CYCLE_DAYS, WEEKDAY_NAMES, type AppDocument, type Minutes } from '../../domain/types';
import type { Derived } from '../../state/useDerived';
import { roleName } from './labels';

export interface DayTimelineProps {
  day: number;
  doc: AppDocument;
  derived: Derived;
  onChangeDay(day: number): void;
  onBack(): void;
  onOpenCell(employeeId: string, day: number): void;
  onOpenGap(key: string): void;
}

/** "balconista" → "balconistas"; "auxiliar" → "auxiliares". */
function pluralRole(name: string, n: number): string {
  const lower = name.toLowerCase();
  if (n === 1) return lower;
  return /[aeiou]$/.test(lower) ? `${lower}s` : `${lower}es`;
}

function missingText(n: number, role: string): string {
  return `${n === 1 ? 'Falta' : 'Faltam'} ${n} ${pluralRole(role, n)}`;
}

/** Passa para depois de `after` um horário que cruzou a meia-noite. */
function after(m: Minutes, ref: Minutes): Minutes {
  return m < ref ? m + MINUTES_PER_DAY : m;
}

interface Segment {
  key: string;
  from: Minutes;
  to: Minutes;
  text: string;
  /** Buraco do dia inteiro (abre a folha do buraco); undefined para falta no almoço. */
  gapKey?: string;
}

/** Visão do dia: uma barra por pessoa da entrada à saída, com o almoço, agrupada pela função contada no dia. */
export function DayTimeline({ day, doc, derived, onChangeDay, onBack, onOpenCell, onOpenGap }: DayTimelineProps) {
  const { config, employees, schedule } = doc;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wd = weekdayOf(day);
  const storeDay = config.days[wd];
  const blocks = derived.presence(day);
  const byId = new Map(employees.map((e) => [e.id, e]));

  useEffect(() => {
    titleRef.current?.focus();
  }, [day]);

  // Eixo: da abertura ao fechamento, alargado para caber quem entra antes ou sai depois.
  const opens = storeDay?.open ? storeDay.opensAt : Math.min(...blocks.map((b) => b.start), 8 * 60);
  const closes = storeDay?.open ? after(storeDay.closesAt, opens) : opens + 10 * 60;
  const norm = (b: PresenceBlock) => {
    const end = after(b.end, b.start);
    const breakStart = b.breakStart === null ? null : after(b.breakStart, b.start);
    const breakEnd = b.breakEnd === null || breakStart === null ? null : after(b.breakEnd, breakStart);
    return { ...b, end, breakStart, breakEnd };
  };
  const rows = blocks.map(norm);
  const axisStart = Math.floor(Math.min(opens, ...rows.map((b) => b.start)) / 60) * 60;
  const axisEnd = Math.ceil(Math.max(closes, ...rows.map((b) => b.end)) / 60) * 60;
  const span = Math.max(60, axisEnd - axisStart);
  const pct = (m: Minutes) => `${(((Math.min(Math.max(m, axisStart), axisEnd) - axisStart) / span) * 100).toFixed(3)}%`;
  const width = (from: Minutes, to: Minutes) =>
    `${(((Math.min(to, axisEnd) - Math.max(from, axisStart)) / span) * 100).toFixed(3)}%`;
  const hours: Minutes[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);

  const dayGaps = derived.coverage.gaps.filter((g) => g.day === day);
  const lunchGaps = derived.lunchGaps.filter((g) => g.day === day);

  const roleIds = [
    ...config.roles.map((r) => r.id),
    ...new Set([...rows.map((b) => b.roleId), ...dayGaps.map((g) => g.roleId)]),
  ];
  const groups = [...new Set(roleIds)]
    .map((roleId) => {
      const people = rows.filter((b) => b.roleId === roleId);
      const segments: Segment[] = [];
      const gapsByShift = new Map<string, Gap[]>();
      for (const g of dayGaps.filter((x) => x.roleId === roleId)) {
        gapsByShift.set(g.shiftId, [...(gapsByShift.get(g.shiftId) ?? []), g]);
      }
      const role = roleName(config, roleId);
      for (const [shiftId, list] of gapsByShift) {
        const shift = findShift(config, shiftId);
        if (!shift) continue;
        const from = shift.start;
        const to = after(shift.end, shift.start);
        segments.push({
          key: `d-${shiftId}`,
          from,
          to,
          text: `${missingText(list.length, role)} ${shiftPhrase(shift.name)} (${formatTime(from)}–${formatTime(to)})`,
          gapKey: gapKey(list[0]),
        });
      }
      for (const g of lunchGaps.filter((x) => x.roleId === roleId)) {
        const from = g.from;
        const to = after(g.to, g.from);
        segments.push({
          key: `l-${g.from}-${g.to}`,
          from,
          to,
          text: `${missingText(g.missing, role)} no almoço ${formatTime(from)}–${formatTime(to)}`,
        });
      }
      return { roleId, role, people, segments };
    })
    .filter((g) => g.people.length > 0 || g.segments.length > 0);

  const working = new Set(rows.map((b) => b.employeeId));
  const off = employees.filter((e) => !working.has(e.id) && schedule?.[e.id]?.[day]?.status === 'off');
  const closed = !storeDay?.open;
  const title = `${WEEKDAY_NAMES[wd]}, dia ${day + 1} — Semana ${weekOf(day) + 1}`;
  const prev = day - 1;
  const next = day + 1;

  return (
    <section className="dt" aria-labelledby="dt-title">
      <div className="dt-nav">
        <button type="button" className="btn btn-sm dt-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> Voltar para a semana
        </button>
        <div className="dt-step" role="group" aria-label="Trocar de dia">
          <button
            type="button"
            className="btn btn-sm dt-step-btn"
            disabled={prev < 0}
            aria-label={prev >= 0 ? `Dia anterior: ${WEEKDAY_NAMES[weekdayOf(prev)]}, dia ${prev + 1}` : 'Dia anterior'}
            onClick={() => onChangeDay(prev)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-sm dt-step-btn"
            disabled={next >= CYCLE_DAYS}
            aria-label={next < CYCLE_DAYS ? `Próximo dia: ${WEEKDAY_NAMES[weekdayOf(next)]}, dia ${next + 1}` : 'Próximo dia'}
            onClick={() => onChangeDay(next)}
          >
            ›
          </button>
        </div>
      </div>

      <h2 id="dt-title" ref={titleRef} tabIndex={-1} className="dt-title">
        {title}
      </h2>
      {storeDay?.open ? (
        <p className="hint dt-sub">
          Loja aberta das <span className="mono">{formatTime(storeDay.opensAt)}</span> às{' '}
          <span className="mono">{formatTime(storeDay.closesAt)}</span>. Toque numa barra para editar o horário.
        </p>
      ) : (
        <p className="dt-closed">Loja fechada neste dia.</p>
      )}

      {groups.length > 0 && (
        <div className="dt-chart">
          <div className="dt-axis" aria-hidden="true">
            <span className="dt-label" />
            <div className="dt-track">
              {hours.map((m, i) => (
                <span key={m} className={`dt-hour${i % 2 === 1 ? ' is-odd' : ''}`} style={{ left: pct(m) }}>
                  {formatTime(m).slice(0, 2)}
                </span>
              ))}
            </div>
          </div>

          {groups.map((group) => (
            <div key={group.roleId} className="dt-group" role="group" aria-label={group.role}>
              <h3 className="dt-group-title">{group.role}</h3>
              <ul className="dt-rows">
                {group.people.map((b) => {
                  const employee = byId.get(b.employeeId);
                  const name = employee?.name ?? 'Pessoa removida';
                  const lunch =
                    b.breakStart !== null && b.breakEnd !== null
                      ? `Almoço ${formatTime(b.breakStart)}–${formatTime(b.breakEnd)}`
                      : null;
                  const flex = employee && employee.roleId !== b.roleId;
                  const label = [
                    `${name}: ${formatTime(b.start)}–${formatTime(b.end)}`,
                    lunch ? `${lunch.toLowerCase()}${b.breakPlanned ? ', sugerido pelo site' : ''}` : 'sem almoço',
                    flex ? `cobrindo ${group.role}` : null,
                    'editar',
                  ]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <li key={b.employeeId} className="dt-row">
                      <span className="dt-label dt-name" title={name}>
                        {name}
                      </span>
                      <div className="dt-track">
                        <Gridlines hours={hours} pct={pct} />
                        <button
                          type="button"
                          className={`dt-bar${b.breakPlanned ? ' is-planned' : ''}`}
                          style={{ left: pct(b.start), width: width(b.start, b.end) }}
                          aria-label={label}
                          onClick={() => onOpenCell(b.employeeId, day)}
                        >
                          {b.breakStart !== null && b.breakEnd !== null && (
                            <span
                              className="dt-lunch"
                              aria-hidden="true"
                              style={{
                                left: `${(((b.breakStart - b.start) / (b.end - b.start)) * 100).toFixed(3)}%`,
                                width: `${(((b.breakEnd - b.breakStart) / (b.end - b.start)) * 100).toFixed(3)}%`,
                              }}
                            />
                          )}
                        </button>
                        <span className="dt-caption" aria-hidden="true">
                          <span className="mono">
                            {formatTime(b.start)}–{formatTime(b.end)}
                          </span>
                          {lunch && (
                            <>
                              {' · '}
                              <span className="dt-caption-lunch">
                                {lunch}
                                {b.breakPlanned && <span className="dt-planned"> (sugerido)</span>}
                              </span>
                            </>
                          )}
                          {flex && <span className="dt-flex"> · cobre {group.role.toLowerCase()}</span>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="dt-row dt-coverage">
                <span className="dt-label dt-coverage-label">{group.segments.length > 0 ? 'Cobertura' : 'Coberto'}</span>
                <div className="dt-track">
                  <div className="dt-strip" aria-hidden="true">
                    {group.segments.map((s) => (
                      <span key={s.key} className="dt-strip-gap" style={{ left: pct(s.from), width: width(s.from, s.to) }} />
                    ))}
                  </div>
                </div>
              </div>
              {group.segments.length > 0 && (
                <ul className="dt-gaps">
                  {group.segments.map((s) => (
                    <li key={s.key}>
                      {s.gapKey ? (
                        <button type="button" className="dt-gap dt-gap-btn" onClick={() => onOpenGap(s.gapKey!)}>
                          <span aria-hidden="true">▲</span> {s.text}
                        </button>
                      ) : (
                        <span className="dt-gap">
                          <span aria-hidden="true">▲</span> {s.text}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {!closed && groups.length === 0 && <p className="hint">Ninguém trabalha neste dia.</p>}

      {off.length > 0 && (
        <p className="dt-off">
          <span className="dt-off-label">De folga:</span> {off.map((e) => e.name).join(', ')}
        </p>
      )}
    </section>
  );
}

function Gridlines({ hours, pct }: { hours: Minutes[]; pct(m: Minutes): string }) {
  return (
    <>
      {hours.map((m) => (
        <span key={m} className="dt-gridline" aria-hidden="true" style={{ left: pct(m) }} />
      ))}
    </>
  );
}
