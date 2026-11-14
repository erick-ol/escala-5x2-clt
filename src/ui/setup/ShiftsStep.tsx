import { useState } from 'react';
import { defaultBreakFor, formatDuration, formatTime, workedMinutes } from '../../domain/time';
import type { Shift } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { longestOpenDay, pruneMinimums, randomId, suggestShifts } from './setupLogic';
import { TimeInput } from './TimeInput';

const MAX_SHIFTS = 3;

export function ShiftsStep() {
  const config = useAppStore((s) => s.document.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [count, setCount] = useState(() => Math.min(MAX_SHIFTS, Math.max(1, config.shifts.length || 2)));
  const longest = longestOpenDay(config.days);

  const setShifts = (shifts: Shift[]) => {
    updateConfig({ shifts, minimums: pruneMinimums({ ...config, shifts }) });
  };

  const patchShift = (id: string, patch: Partial<Shift>) => {
    setShifts(config.shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const setHours = (shift: Shift, patch: Partial<Pick<Shift, 'start' | 'end'>>) => {
    const start = patch.start ?? shift.start;
    const end = patch.end ?? shift.end;
    // Só recalcula o intervalo se ele ainda era o sugerido (não sobrescreve um ajuste manual).
    const wasDefault = shift.breakMinutes === defaultBreakFor(shift.start, shift.end);
    patchShift(shift.id, wasDefault ? { ...patch, breakMinutes: defaultBreakFor(start, end) } : patch);
  };

  const addShift = () => {
    const last = config.shifts[config.shifts.length - 1];
    const start = last ? last.end : (longest?.opensAt ?? 8 * 60);
    const end = Math.min(start + 6 * 60, 23 * 60 + 59);
    setShifts([
      ...config.shifts,
      { id: randomId('turno'), name: '', start, end, breakMinutes: defaultBreakFor(start, end) },
    ]);
  };

  return (
    <section className="setup-step" aria-labelledby="step-shifts-title">
      <h2 id="step-shifts-title" className="setup-step-title">
        Turnos
      </h2>
      <p className="hint">De 1 a 3 turnos. O site sugere os horários a partir do funcionamento; tudo pode ser ajustado.</p>

      <div className="setup-suggest card">
        <div className="field">
          <label htmlFor="shift-count">Quantos turnos?</label>
          <select
            id="shift-count"
            className="input"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            <option value={1}>1 turno</option>
            <option value={2}>2 turnos</option>
            <option value={3}>3 turnos</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!longest}
          onClick={() => setShifts(suggestShifts(config.days, count, config.shifts))}
        >
          Sugerir turnos
        </button>
        {longest ? (
          <p className="hint">
            Divide o dia mais longo ({formatTime(longest.opensAt)}–{formatTime(longest.closesAt)}) em partes iguais.
          </p>
        ) : (
          <p className="hint">Informe o funcionamento da loja para receber uma sugestão.</p>
        )}
      </div>

      {config.shifts.length === 0 ? (
        <p className="setup-empty">Nenhum turno ainda.</p>
      ) : (
        <ul className="setup-list">
          {config.shifts.map((shift, i) => {
            const n = i + 1;
            return (
              <li key={shift.id} className="setup-item card">
                <div className="field">
                  <label htmlFor={`shift-name-${shift.id}`}>Nome do turno {n}</label>
                  <input
                    id={`shift-name-${shift.id}`}
                    className="input"
                    value={shift.name}
                    placeholder="Ex.: Manhã"
                    onChange={(e) => patchShift(shift.id, { name: e.target.value })}
                  />
                </div>
                <div className="setup-hours">
                  <div className="field">
                    <span className="label">Entrada</span>
                    <TimeInput
                      label={`Turno ${n}: entrada`}
                      value={shift.start}
                      onChange={(v) => setHours(shift, { start: v })}
                    />
                  </div>
                  <div className="field">
                    <span className="label">Saída</span>
                    <TimeInput label={`Turno ${n}: saída`} value={shift.end} onChange={(v) => setHours(shift, { end: v })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`shift-break-${shift.id}`}>Intervalo (min)</label>
                    <input
                      id={`shift-break-${shift.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={5}
                      className="input mono"
                      value={shift.breakMinutes}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== '' && Number.isFinite(v) && v >= 0) {
                          patchShift(shift.id, { breakMinutes: Math.round(v) });
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="setup-item-foot">
                  <span className="hint">Trabalhado: {formatDuration(workedMinutes(shift))}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShifts(config.shifts.filter((s) => s.id !== shift.id))}
                  >
                    Remover turno {n}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {config.shifts.length < MAX_SHIFTS && (
        <button type="button" className="btn" onClick={addShift}>
          Adicionar turno
        </button>
      )}
    </section>
  );
}
