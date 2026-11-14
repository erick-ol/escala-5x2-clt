import { LEGAL_DATES } from '../../domain/legal';
import type { Regime } from '../../domain/types';
import { useAppStore } from '../../state/store';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const REGIMES: Array<{ value: Regime; title: string; detail: string }> = [
  {
    value: '42h',
    title: '42h por semana',
    detail: `Transição, a partir de ${formatDate(LEGAL_DATES.start42h)}. Até 8h24 por dia.`,
  },
  { value: '40h', title: '40h por semana', detail: `A partir de ${formatDate(LEGAL_DATES.switch40h)}. Até 8h por dia.` },
];

/** Regime de horas: define o teto semanal e a jornada diária usada na sugestão de turnos. */
export function RegimePicker() {
  const regime = useAppStore((s) => s.document.config.regime);
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <fieldset className="setup-regime">
      <legend className="label">Regime de horas</legend>
      <div className="setup-regime-options">
        {REGIMES.map((r) => (
          <label key={r.value} className={`setup-regime-option${regime === r.value ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="regime"
              value={r.value}
              checked={regime === r.value}
              onChange={() => updateConfig({ regime: r.value })}
            />
            <span>
              <strong>{r.title}</strong>
              <span className="hint">{r.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
