import { useId, useState } from 'react';
import type { LegalAlert } from '../../domain/rules';
import { effectiveHours, effectiveShiftId, formatDuration, formatTime, isValidHours, parseTime, weekOf, weekdayOf, workedMinutes } from '../../domain/time';
import { WEEKDAY_NAMES, type Cell, type CoverageMark, type WorkHours } from '../../domain/types';
import { appStore, useAppStore } from '../../state/store';
import { Sheet } from './Sheet';

export interface CellEditorProps {
  employeeId: string;
  day: number;
  /** Alertas da pessoa (todos); o painel mostra os do dia e os da semana. */
  alerts: LegalAlert[];
  onClose(): void;
}

interface Snapshot {
  cell: Cell;
  customHours: WorkHours | undefined;
  marks: CoverageMark[];
}

/** Célula sem o ajuste de horário do dia (sem deixar a chave `hours: undefined`). */
function withoutHours(cell: Cell): Cell {
  return cell.shiftId ? { status: cell.status, shiftId: cell.shiftId } : { status: cell.status };
}

function sameHours(a: WorkHours, b: WorkHours) {
  return a.start === b.start && a.end === b.end && a.breakMinutes === b.breakMinutes;
}

/** Painel de edição de um dia: aplica na hora, com "Desfazer" para as mudanças feitas nesta sessão. */
export function CellEditor({ employeeId, day, alerts, onClose }: CellEditorProps) {
  const config = useAppStore((s) => s.document.config);
  const employee = useAppStore((s) => s.document.employees.find((e) => e.id === employeeId));
  const cell = useAppStore((s) => s.document.schedule?.[employeeId]?.[day]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const shiftSelectId = useId();

  if (!employee || !cell) return null;

  const snapshot = (): Snapshot => {
    const doc = appStore.getState().document;
    return {
      cell: doc.schedule?.[employeeId]?.[day] ?? cell,
      customHours: doc.employees.find((e) => e.id === employeeId)?.customHours,
      marks: doc.marks,
    };
  };

  const apply = (change: () => void) => {
    const before = snapshot();
    change();
    setHistory((h) => [...h, before]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const { setCell, updateEmployee, setMarks } = appStore.getState();
    setCell(employeeId, day, last.cell);
    updateEmployee(employeeId, { customHours: last.customHours });
    setMarks(last.marks);
    setHistory((h) => h.slice(0, -1));
  };

  const setStatus = (status: 'work' | 'off') => {
    if (cell.status === status) return;
    apply(() => appStore.getState().setCell(employeeId, day, { ...cell, status }));
  };

  const shiftId = effectiveShiftId(employee, cell);
  const hours = effectiveHours(config, employee, cell);
  const isRegisteredShift = shiftId === employee.shiftId;

  const dayAlerts = alerts.filter((a) => a.day === day || (a.day === null && (a.week === weekOf(day) || a.week === null)));

  return (
    <Sheet
      kicker={`Semana ${weekOf(day) + 1} · ${WEEKDAY_NAMES[weekdayOf(day)]}`}
      title={employee.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={undo} disabled={history.length === 0}>
            Desfazer
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      {cell.status === 'closed' ? (
        <p className="sheet-readonly">
          <span className="sheet-readonly-icon" aria-hidden="true">
            ×
          </span>
          Loja fechada
        </p>
      ) : (
        <>
          <div className="seg" role="group" aria-label="Situação do dia">
            <button
              type="button"
              className="seg-btn"
              aria-pressed={cell.status === 'work'}
              onClick={() => setStatus('work')}
            >
              Trabalha
            </button>
            <button
              type="button"
              className="seg-btn seg-off"
              aria-pressed={cell.status === 'off'}
              onClick={() => setStatus('off')}
            >
              Folga
            </button>
          </div>

          {cell.status === 'work' && (
            <>
              <div className="field">
                <label htmlFor={shiftSelectId}>Turno</label>
                <select
                  id={shiftSelectId}
                  className="input"
                  value={shiftId}
                  onChange={(e) => {
                    const next = e.target.value;
                    apply(() =>
                      appStore
                        .getState()
                        .setCell(employeeId, day, next === employee.shiftId ? { status: 'work' } : { status: 'work', shiftId: next }),
                    );
                  }}
                >
                  {config.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.id === employee.shiftId ? ' (cadastro)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {hours && (
                <HoursForm
                  key={`${hours.start}-${hours.end}-${hours.breakMinutes}`}
                  initial={hours}
                  canApplyAll={isRegisteredShift}
                  onApplyDay={(h) => apply(() => appStore.getState().setCell(employeeId, day, { ...cell, hours: h }))}
                  onApplyAll={(h) =>
                    apply(() => {
                      appStore.getState().updateEmployee(employeeId, { customHours: h });
                      appStore.getState().setCell(employeeId, day, withoutHours(cell));
                    })
                  }
                />
              )}
              {cell.hours && (
                <p className="hint">
                  Horário ajustado só neste dia.{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => apply(() => appStore.getState().setCell(employeeId, day, withoutHours(cell)))}
                  >
                    Voltar ao horário do cadastro
                  </button>
                </p>
              )}
            </>
          )}
        </>
      )}

      <section className="sheet-alerts" aria-label="Alertas deste dia">
        {dayAlerts.length === 0 ? (
          <p className="sheet-ok">
            <span aria-hidden="true">✓</span> Sem alerta legal neste dia.
          </p>
        ) : (
          <ul className="alert-items">
            {dayAlerts.map((a, i) => (
              <li key={i} className="alert-item-static">
                <span className="alert-icon" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="visually-hidden">Alerta legal: </span>
                  {a.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  );
}

interface HoursFormProps {
  initial: WorkHours;
  canApplyAll: boolean;
  onApplyDay(hours: WorkHours): void;
  onApplyAll(hours: WorkHours): void;
}

function HoursForm({ initial, canApplyAll, onApplyDay, onApplyAll }: HoursFormProps) {
  const [start, setStart] = useState(formatTime(initial.start));
  const [end, setEnd] = useState(formatTime(initial.end));
  const [pause, setPause] = useState(String(initial.breakMinutes));
  const ids = { start: useId(), end: useId(), pause: useId(), error: useId() };

  const s = parseTime(start);
  const e = parseTime(end);
  const b = /^\d+$/.test(pause.trim()) ? Number(pause) : null;
  const draft: WorkHours | null = s !== null && e !== null && b !== null ? { start: s, end: e, breakMinutes: b } : null;
  const error = draft ? isValidHours(draft) : 'Preencha entrada, saída (hh:mm) e intervalo em minutos.';
  const dirty = !draft || !sameHours(draft, initial);

  return (
    <div className="hours-form">
      <div className="hours-grid">
        <div className="field">
          <label htmlFor={ids.start}>Entrada</label>
          <input
            id={ids.start}
            type="time"
            className="input mono"
            value={start}
            aria-invalid={dirty && !!error ? true : undefined}
            aria-describedby={dirty && error ? ids.error : undefined}
            onChange={(ev) => setStart(ev.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.end}>Saída</label>
          <input
            id={ids.end}
            type="time"
            className="input mono"
            value={end}
            aria-invalid={dirty && !!error ? true : undefined}
            aria-describedby={dirty && error ? ids.error : undefined}
            onChange={(ev) => setEnd(ev.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.pause}>Intervalo (min)</label>
          <input
            id={ids.pause}
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            className="input mono"
            value={pause}
            onChange={(ev) => setPause(ev.target.value)}
          />
        </div>
      </div>
      {!dirty && (
        <p className="hint mono">{formatDuration(workedMinutes(initial))} trabalhadas no dia</p>
      )}
      {dirty && error && (
        <p id={ids.error} role="alert" className="error-text">
          {error}
        </p>
      )}
      {dirty && draft && !error && (
        <div className="apply-scope" role="group" aria-label="Aplicar o novo horário a">
          <p className="apply-scope-q">
            Aplicar <span className="mono">{formatTime(draft.start)}–{formatTime(draft.end)}</span> a:
          </p>
          <div className="apply-scope-btns">
            <button type="button" className="btn btn-sm" onClick={() => onApplyDay(draft)}>
              Só este dia
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!canApplyAll}
              onClick={() => onApplyAll(draft)}
            >
              Todos os dias
            </button>
          </div>
          {!canApplyAll && <p className="hint">Neste dia a pessoa está em outro turno; o cadastro não muda.</p>}
        </div>
      )}
    </div>
  );
}
