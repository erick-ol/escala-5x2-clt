import { defaultBreakFor, formatDuration, workedMinutes } from '../../domain/time';
import type { Employee, WorkHours } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { randomId } from './setupLogic';
import { TimeInput } from './TimeInput';

/** Valor do seletor de turno para quem não tem turno fixo (não é um turno cadastrado). */
const FLOATING = '__sem_turno_fixo';

export function TeamStep() {
  const config = useAppStore((s) => s.document.config);
  const employees = useAppStore((s) => s.document.employees);
  const addEmployee = useAppStore((s) => s.addEmployee);
  const updateEmployee = useAppStore((s) => s.updateEmployee);
  const removeEmployee = useAppStore((s) => s.removeEmployee);

  const shiftHours = (shiftId: string): WorkHours | null => {
    const s = config.shifts.find((x) => x.id === shiftId);
    return s ? { start: s.start, end: s.end, breakMinutes: s.breakMinutes } : null;
  };

  const add = () => {
    addEmployee({
      id: randomId('pessoa'),
      name: '',
      roleId: config.roles[0]?.id ?? '',
      shiftId: config.shifts[0]?.id ?? '',
      isWoman: false,
    });
  };

  const setCustom = (e: Employee, patch: Partial<WorkHours>) => {
    const current = e.customHours ?? shiftHours(e.shiftId) ?? { start: 8 * 60, end: 16 * 60, breakMinutes: 60 };
    const next = { ...current, ...patch };
    if (patch.breakMinutes === undefined && current.breakMinutes === defaultBreakFor(current.start, current.end)) {
      next.breakMinutes = defaultBreakFor(next.start, next.end);
    }
    updateEmployee(e.id, { customHours: next });
  };

  return (
    <section className="setup-step" aria-labelledby="step-team-title">
      <h2 id="step-team-title" className="setup-step-title">
        Equipe
      </h2>


      <p className="hint">Cada pessoa herda o horário do turno. Marque "Horário próprio" para quem entra ou sai em outro horário.</p>

      {employees.length === 0 && <p className="setup-empty">Nenhuma pessoa cadastrada ainda.</p>}

      <ul className="setup-list" aria-label="Equipe">
        {employees.map((e, i) => {
          const n = i + 1;
          const label = e.name.trim() || `Pessoa ${n}`;
          const hours = e.customHours;
          return (
            <li key={e.id} className="setup-item card" aria-labelledby={`emp-title-${e.id}`}>
              <h3 id={`emp-title-${e.id}`} className="setup-item-title">
                {label}
              </h3>
              <div className="field">
                <label htmlFor={`emp-name-${e.id}`}>Nome da pessoa {n}</label>
                <input
                  id={`emp-name-${e.id}`}
                  className="input"
                  value={e.name}
                  autoComplete="off"
                  aria-invalid={!e.name.trim() || undefined}
                  onChange={(ev) => updateEmployee(e.id, { name: ev.target.value })}
                />
              </div>
              <div className="setup-two">
                <div className="field">
                  <label htmlFor={`emp-role-${e.id}`}>Função</label>
                  <select
                    id={`emp-role-${e.id}`}
                    className="input"
                    value={e.roleId}
                    onChange={(ev) => {
                      const roleId = ev.target.value;
                      // A segunda área não pode ser a mesma da função principal.
                      updateEmployee(
                        e.id,
                        e.secondaryRoleId === roleId ? { roleId, secondaryRoleId: undefined } : { roleId },
                      );
                    }}
                  >
                    {!config.roles.some((r) => r.id === e.roleId) && <option value="">Escolha</option>}
                    {config.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name || 'Sem nome'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`emp-shift-${e.id}`}>Turno</label>
                  <select
                    id={`emp-shift-${e.id}`}
                    className="input"
                    value={e.floating ? FLOATING : e.shiftId}
                    aria-describedby={e.floating ? `emp-floating-hint-${e.id}` : undefined}
                    onChange={(ev) =>
                      ev.target.value === FLOATING
                        ? updateEmployee(e.id, {
                            floating: true,
                            customHours: undefined,
                            shiftId: config.shifts.some((s) => s.id === e.shiftId) ? e.shiftId : (config.shifts[0]?.id ?? ''),
                          })
                        : updateEmployee(e.id, { shiftId: ev.target.value, floating: undefined, customHours: undefined })
                    }
                  >
                    {!e.floating && !config.shifts.some((s) => s.id === e.shiftId) && <option value="">Escolha</option>}
                    {config.shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || 'Sem nome'}
                      </option>
                    ))}
                    {config.shifts.length > 1 && <option value={FLOATING}>Sem turno fixo</option>}
                  </select>
                  {e.floating && (
                    <p id={`emp-floating-hint-${e.id}`} className="hint">
                      O site põe a pessoa na manhã ou na tarde, dia a dia, para cobrir as folgas da função.
                    </p>
                  )}
                </div>
              </div>

              {config.roles.length > 1 && (
                <div className="field setup-secondary">
                  <label htmlFor={`emp-second-${e.id}`}>Segunda área (opcional)</label>
                  <select
                    id={`emp-second-${e.id}`}
                    className="input"
                    value={e.secondaryRoleId ?? ''}
                    aria-describedby={`emp-second-hint-${e.id}`}
                    onChange={(ev) => updateEmployee(e.id, { secondaryRoleId: ev.target.value || undefined })}
                  >
                    <option value="">Nenhuma</option>
                    {config.roles
                      .filter((r) => r.id !== e.roleId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || 'Sem nome'}
                        </option>
                      ))}
                  </select>
                  <p id={`emp-second-hint-${e.id}`} className="hint">
                    Cobre essa função quando a principal já estiver completa no turno.
                  </p>
                </div>
              )}

              {!e.floating && (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={hours !== undefined}
                      onChange={(ev) =>
                        updateEmployee(e.id, {
                          customHours: ev.target.checked ? (shiftHours(e.shiftId) ?? undefined) : undefined,
                        })
                      }
                    />
                    <span>
                      Horário próprio<span className="visually-hidden"> de {label}</span>
                    </span>
                  </label>
                  {hours && (
                    <div className="setup-hours">
                      <div className="field">
                        <span className="label">Entrada</span>
                        <TimeInput label={`${label}: entrada`} value={hours.start} onChange={(v) => setCustom(e, { start: v })} />
                      </div>
                      <div className="field">
                        <span className="label">Saída</span>
                        <TimeInput label={`${label}: saída`} value={hours.end} onChange={(v) => setCustom(e, { end: v })} />
                      </div>
                      <div className="field">
                        <label htmlFor={`emp-break-${e.id}`}>Intervalo (min)</label>
                        <input
                          id={`emp-break-${e.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={5}
                          className="input mono"
                          value={hours.breakMinutes}
                          onChange={(ev) => {
                            const v = Number(ev.target.value);
                            if (ev.target.value !== '' && Number.isFinite(v) && v >= 0 && v <= 600) {
                              setCustom(e, { breakMinutes: Math.round(v) });
                            }
                          }}
                        />
                      </div>
                      <span className="hint setup-hours-note">Trabalhado: {formatDuration(workedMinutes(hours))}</span>
                    </div>
                  )}
                </>
              )}

              <div className="setup-woman">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={e.isWoman}
                    aria-describedby={`emp-woman-hint-${e.id}`}
                    onChange={(ev) => updateEmployee(e.id, { isWoman: ev.target.checked })}
                  />
                  <span>
                    Funcionária mulher<span className="visually-hidden"> ({label})</span>
                  </span>
                </label>
                <p id={`emp-woman-hint-${e.id}`} className="hint">
                  Só muda a regra de domingo: folga a cada 2 semanas (CLT art. 386). Não aparece na escala.
                </p>
              </div>

              <div className="setup-item-foot">
                <span />
                <button type="button" className="btn btn-ghost" onClick={() => removeEmployee(e.id)}>
                  Remover {label}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn" onClick={add} disabled={config.shifts.length === 0}>
        Adicionar pessoa
      </button>
    </section>
  );
}
