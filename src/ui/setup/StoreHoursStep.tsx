import { WEEKDAY_NAMES, WEEK_ORDER, type StoreDay, type Weekday } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { OffPatternPicker } from './OffPatternPicker';
import { RegimePicker } from './RegimePicker';
import { RestPicker } from './RestPicker';
import { TimeInput } from './TimeInput';

/** Índice de segunda-feira em `config.days`. */
const MONDAY: Weekday = 0;
const SUNDAY: Weekday = 6;

export function StoreHoursStep() {
  const config = useAppStore((s) => s.document.config);
  const updateConfig = useAppStore((s) => s.updateConfig);

  const setDay = (index: number, patch: Partial<StoreDay>) => {
    updateConfig({ days: config.days.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  };

  /**
   * Copia aberto/abre/fecha de segunda (o dia típico; a lista começa no domingo, que costuma ser diferente);
   * o "turno único" e o "sem folga" de cada dia ficam como estão.
   */
  const copyToAll = () => {
    const { open, opensAt, closesAt } = config.days[MONDAY];
    updateConfig({ days: config.days.map((d) => ({ ...d, open, opensAt, closesAt })) });
  };

  return (
    <section className="setup-step" aria-labelledby="step-store-title">
      <h2 id="step-store-title" className="setup-step-title">
        Funcionamento da loja
      </h2>
      <p className="hint">Dias em que abre e horário de abertura e fechamento. Domingo pode ser diferente.</p>

      <section className="setup-rules" aria-labelledby="rules-title">
        <h3 id="rules-title" className="setup-rules-title">
          Regras da escala
        </h3>
        <RegimePicker />
        <p className="hint">40h já cumpre a lei; 42h é o limite da transição (até 15/12/2027).</p>
        <OffPatternPicker />
        <p className="hint">Nunca mais de 2 folgas seguidas nem mais de 6 dias seguidos de trabalho.</p>
        <RestPicker />
      </section>

      <div className="field">
        <label htmlFor="store-name">Nome do negócio (opcional)</label>
        <input
          id="store-name"
          className="input"
          value={config.name}
          placeholder="Ex.: Mercado São José"
          onChange={(e) => updateConfig({ name: e.target.value })}
        />
      </div>

      <p className="hint">
        <b>Turno único:</b> todos trabalham no horário da loja nesse dia (ex.: domingo de manhã).{' '}
        <b>Sem folga:</b> ninguém folga nesse dia (ex.: sábado, dia de movimento). O domingo não tem essa opção: a
        lei exige folga em alguns domingos.
      </p>
      <div className="setup-days" role="group" aria-label="Horário por dia da semana">
        <div className="setup-days-head" aria-hidden="true">
          <span>Dia</span>
          <span>Abre</span>
          <span>Fecha</span>
        </div>
        {WEEK_ORDER.map((i) => {
          const day = config.days[i];
          const name = WEEKDAY_NAMES[i];
          const invalid = day.open && day.closesAt <= day.opensAt;
          return (
            <div key={name} className={`setup-day${day.open ? '' : ' is-closed'}`}>
              <label className="checkbox setup-day-name">
                <input type="checkbox" checked={day.open} onChange={(e) => setDay(i, { open: e.target.checked })} />
                <span>{name}</span>
              </label>
              {day.open ? (
                <>
                  <TimeInput label={`${name}: abre`} value={day.opensAt} onChange={(v) => setDay(i, { opensAt: v })} />
                  <TimeInput
                    label={`${name}: fecha`}
                    value={day.closesAt}
                    invalid={invalid}
                    onChange={(v) => setDay(i, { closesAt: v })}
                  />
                  <div className="setup-day-flags">
                    <label className="checkbox setup-day-single">
                      <input
                        type="checkbox"
                        checked={!!day.singleShift}
                        aria-label={`${name}: turno único`}
                        onChange={(e) => setDay(i, { singleShift: e.target.checked })}
                      />
                      <span aria-hidden="true">Turno único</span>
                    </label>
                    {i !== SUNDAY && (
                      <label className="checkbox setup-day-single">
                        <input
                          type="checkbox"
                          checked={!!day.noOff}
                          aria-label={`${name}: sem folga`}
                          onChange={(e) => setDay(i, { noOff: e.target.checked })}
                        />
                        <span aria-hidden="true">Sem folga</span>
                      </label>
                    )}
                  </div>
                </>
              ) : (
                <span className="setup-day-closed hint">Fechado</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="setup-row-actions">
        <button type="button" className="btn" onClick={copyToAll}>
          Copiar para todos os dias
        </button>
        <span className="hint">Usa o horário de segunda (o turno único e o "sem folga" de cada dia não mudam).</span>
      </div>
    </section>
  );
}
