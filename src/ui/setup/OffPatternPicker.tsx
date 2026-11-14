import type { OffPattern } from '../../domain/types';
import { useAppStore } from '../../state/store';

const PATTERNS: Array<{ value: OffPattern; title: string; detail: string }> = [
  { value: 'together', title: 'Juntas sempre que possível', detail: 'Ex.: sábado e domingo.' },
  { value: 'flexible', title: 'Podem ser separadas', detail: 'O site separa as folgas se isso cobrir melhor a loja.' },
];

/** Como distribuir as 2 folgas da semana; mesmo visual do seletor de regime. */
export function OffPatternPicker() {
  const offPattern = useAppStore((s) => s.document.config.offPattern) ?? 'together';
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <fieldset className="setup-regime">
      <legend className="label">Folgas</legend>
      <div className="setup-regime-options">
        {PATTERNS.map((p) => (
          <label key={p.value} className={`setup-regime-option${offPattern === p.value ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="offPattern"
              value={p.value}
              checked={offPattern === p.value}
              onChange={() => updateConfig({ offPattern: p.value })}
            />
            <span>
              <strong>{p.title}</strong>
              <span className="hint">{p.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
