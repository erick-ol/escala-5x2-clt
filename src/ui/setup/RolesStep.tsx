import { useState } from 'react';
import { isSingleShiftDay } from '../../domain/time';
import { WEEKDAY_NAMES, WEEKDAY_SHORT, WEEK_ORDER, type Minimum, type Role, type Weekday } from '../../domain/types';
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

  /** Dias abertos sem turno único: os que o número "de todos os dias" controla. */
  const regularDays = WEEK_ORDER.filter((w) => config.days[w]?.open && !isSingleShiftDay(config, w));

  /** Algum dia aberto com número diferente dos outros (abre a tabela por dia de cara). */
  const variesByDay = (roleId: string) =>
    config.shifts.some((s) => {
      const v = findMinimum(config.minimums, roleId, s.id)?.perWeekday;
      if (!v) return false;
      const openVals = WEEK_ORDER.filter((w) => config.days[w]?.open).map((w) => v[w]);
      return openVals.some((x) => x !== openVals[0]);
    });

  /** Muda um dia: num turno (shiftId) ou, no turno único, em todos os turnos daquele dia. */
  const setDay = (roleId: string, w: Weekday, shiftId: string | null, n: number) => {
    const targets = shiftId ? [shiftId] : config.shifts.map((s) => s.id);
    const others = config.minimums.filter((m) => !(m.roleId === roleId && targets.includes(m.shiftId)));
    const changed = targets.map((sid) => {
      const base = findMinimum(config.minimums, roleId, sid)?.perWeekday ?? Array(7).fill(0);
      return { roleId, shiftId: sid, perWeekday: base.map((v, i) => (i === w ? n : v)) };
    });
    updateConfig({ minimums: [...others, ...changed] });
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
          const open = expanded[role.id] ?? variesByDay(role.id);
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
                  const values = findMinimum(config.minimums, role.id, shift.id)?.perWeekday ?? null;
                  const regular = values ? regularDays.map((w) => values[w]) : [];
                  const uniform = regular.every((v) => v === regular[0]);
                  const shiftLabel = shift.name || 'turno';
                  return (
                    <div key={shift.id} className="setup-minimum">
                      <div className="setup-minimum-row">
                        <label htmlFor={`min-${key}`} className="setup-minimum-label">
                          {shiftLabel}
                          {!uniform && <span className="setup-minimum-note"> · varia por dia</span>}
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
                          value={values === null ? '' : uniform ? (regular[0] ?? values[0]) : ''}
                          placeholder={uniform ? '' : 'varia'}
                          onChange={(e) => {
                            const n = parseCount(e.target.value);
                            if (n === null) return setMinimum(role.id, shift.id, null);
                            // Muda só os dias normais; domingo de turno único e dias fechados mantêm o ajuste.
                            const base = values ?? Array(7).fill(n);
                            setMinimum(role.id, shift.id, base.map((v, w) => (regularDays.includes(w as Weekday) ? n : v)));
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="btn btn-sm setup-expander"
                  aria-expanded={open}
                  aria-controls={`days-${role.id}`}
                  onClick={() => setExpanded((x) => ({ ...x, [role.id]: !open }))}
                >
                  {open ? 'Fechar ajuste por dia' : 'Mudar o mínimo num dia (ex.: domingo)'}
                </button>

                {open && (
                  <table id={`days-${role.id}`} className="setup-perday">
                    <thead>
                      <tr>
                        <th scope="col">Dia</th>
                        {config.shifts.map((s) => (
                          <th key={s.id} scope="col">
                            {s.name || 'turno'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {WEEK_ORDER.map((w) => {
                        const day = WEEKDAY_SHORT[w];
                        const d = config.days[w];
                        if (!d?.open) {
                          return (
                            <tr key={w} className="is-closed">
                              <th scope="row">{day}</th>
                              <td colSpan={config.shifts.length}>Fechado</td>
                            </tr>
                          );
                        }
                        if (isSingleShiftDay(config, w)) {
                          const value = Math.max(
                            0,
                            ...config.shifts.map((s) => findMinimum(config.minimums, role.id, s.id)?.perWeekday[w] ?? 0),
                          );
                          return (
                            <tr key={w}>
                              <th scope="row">{day}</th>
                              <td colSpan={config.shifts.length}>
                                <label className="setup-perday-single">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    className="input mono"
                                    aria-label={`Mínimo de ${roleLabel} em ${WEEKDAY_NAMES[w].toLowerCase()} (turno único)`}
                                    value={value}
                                    onChange={(e) => setDay(role.id, w, null, parseCount(e.target.value) ?? 0)}
                                  />
                                  <span>turno único</span>
                                </label>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={w}>
                            <th scope="row">{day}</th>
                            {config.shifts.map((s) => {
                              const v = findMinimum(config.minimums, role.id, s.id)?.perWeekday[w];
                              return (
                                <td key={s.id}>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    className="input mono"
                                    aria-label={`Mínimo de ${roleLabel} no turno ${s.name || 'turno'}, ${day}`}
                                    value={v ?? ''}
                                    onChange={(e) => setDay(role.id, w, s.id, parseCount(e.target.value) ?? 0)}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
