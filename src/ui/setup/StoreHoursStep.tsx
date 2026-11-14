import { WEEKDAY_NAMES, type StoreDay } from '../../domain/types';
import { useAppStore } from '../../state/store';
import { OffPatternPicker } from './OffPatternPicker';
import { RegimePicker } from './RegimePicker';
import { TimeInput } from './TimeInput';

export function StoreHoursStep() {
  const config = useAppStore((s) => s.document.config);
  const updateConfig = useAppStore((s) => s.updateConfig);

  const setDay = (index: number, patch: Partial<StoreDay>) => {
    updateConfig({ days: config.days.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  };

  const copyToAll = () => {
    const first = config.days[0];
    updateConfig({ days: config.days.map(() => ({ ...first })) });
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

      <div className="setup-days" role="group" aria-label="Horário por dia da semana">
        <div className="setup-days-head" aria-hidden="true">
          <span>Dia</span>
          <span>Abre</span>
          <span>Fecha</span>
        </div>
        {config.days.map((day, i) => {
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
        <span className="hint">Usa o horário de segunda.</span>
      </div>
    </section>
  );
}
