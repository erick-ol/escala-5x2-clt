import { useState } from 'react';
import { WEEKDAY_SHORT, type Minimum, type Role } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { findMinimum, pruneMinimums, randomId } from './setupLogic';

function parseCount(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function RolesStep() {
  const config = useAppStore((s) => s.document.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const setRoles = (roles: Role[], minimums: Minimum[] = config.minimums) => {
    updateConfig({ roles, minimums: pruneMinimums({ ...config, roles, minimums }) });
  };

  const addRole = () => {
    const id = randomId('funcao');
    const created = config.shifts.map((s) => ({ roleId: id, shiftId: s.id, perWeekday: [1, 1, 1, 1, 1, 1, 1] }));
    setRoles([...config.roles, { id, name: '' }], [...config.minimums, ...created]);
  };

  const setMinimum = (roleId: string, shiftId: string, perWeekday: number[] | null) => {
    const others = config.minimums.filter((m) => !(m.roleId === roleId && m.shiftId === shiftId));
    updateConfig({ minimums: perWeekday ? [...others, { roleId, shiftId, perWeekday }] : others });
  };

  if (config.shifts.length === 0) {
    return (
      <section className="setup-step" aria-labelledby="step-roles-title">
        <h2 id="step-roles-title" className="setup-step-title">
          Funções e mínimos
        </h2>
        <p className="setup-empty">Cadastre os turnos antes das funções.</p>
      </section>
    );
  }

  return (
    <section className="setup-step" aria-labelledby="step-roles-title">
      <h2 id="step-roles-title" className="setup-step-title">
        Funções e mínimos
      </h2>
      <p className="hint">
        Funções do negócio (ex.: caixa, balconista) e quantas pessoas de cada uma precisam estar em cada turno.
      </p>

      {config.roles.length === 0 && <p className="setup-empty">Nenhuma função ainda.</p>}

      <ul className="setup-list">
        {config.roles.map((role, ri) => {
          const roleLabel = role.name.trim() || `Função ${ri + 1}`;
          return (
            <li key={role.id} className="setup-item card">
              <div className="field">
                <label htmlFor={`role-name-${role.id}`}>Nome da função {ri + 1}</label>
                <input
                  id={`role-name-${role.id}`}
                  className="input"
                  value={role.name}
                  placeholder="Ex.: Caixa"
                  onChange={(e) =>
                    setRoles(config.roles.map((r) => (r.id === role.id ? { ...r, name: e.target.value } : r)))
                  }
                />
              </div>

              <div className="setup-minimums">
                <span className="label">Mínimo de pessoas por turno</span>
                {config.shifts.map((shift) => {
                  const key = `${role.id}:${shift.id}`;
                  const m = findMinimum(config.minimums, role.id, shift.id);
                  const values = m?.perWeekday ?? null;
                  const uniform = values ? values.every((v) => v === values[0]) : true;
                  const open = expanded[key] ?? !uniform;
                  const shiftLabel = shift.name || 'turno';
                  return (
                    <div key={shift.id} className="setup-minimum">
                      <div className="setup-minimum-row">
                        <label htmlFor={`min-${key}`} className="setup-minimum-label">
                          {shiftLabel}
                        </label>
                        <input
                          id={`min-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="input mono setup-count"
                          aria-label={`Mínimo de ${roleLabel} no turno ${shiftLabel}`}
                          aria-invalid={values === null || undefined}
                          disabled={!uniform}
                          value={values === null ? '' : uniform ? values[0] : ''}
                          placeholder={uniform ? '' : 'varia'}
                          onChange={(e) => {
                            const n = parseCount(e.target.value);
                            setMinimum(role.id, shift.id, n === null ? null : Array(7).fill(n));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost setup-expander"
                          aria-expanded={open}
                          aria-controls={`days-${key}`}
                          onClick={() => setExpanded((x) => ({ ...x, [key]: !open }))}
                        >
                          {open ? 'Mesmo número todos os dias' : 'Ajustar por dia'}
                        </button>
                      </div>
                      {open && (
                        <div id={`days-${key}`} className="setup-perday">
                          {WEEKDAY_SHORT.map((day, di) => (
                            <label key={day} className="setup-perday-cell">
                              <span>{day}</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                className="input mono"
                                aria-label={`Mínimo de ${roleLabel} no turno ${shiftLabel}, ${day}`}
                                value={values ? values[di] : ''}
                                onChange={(e) => {
                                  const n = parseCount(e.target.value) ?? 0;
                                  const base = values ?? Array(7).fill(0);
                                  setMinimum(
                                    role.id,
                                    shift.id,
                                    base.map((v, i) => (i === di ? n : v)),
                                  );
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="setup-item-foot">
                <span />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setRoles(config.roles.filter((r) => r.id !== role.id))}
                >
                  Remover {roleLabel}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn" onClick={addRole}>
        Adicionar função
      </button>
    </section>
  );
}
