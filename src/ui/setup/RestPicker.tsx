import { useAppStore } from '../../state/store';

const OPTIONS: Array<{ ignore: boolean; title: string; detail: string }> = [
  { ignore: false, title: 'Respeitar', detail: 'Ninguém volta antes de 11h de descanso (CLT, art. 66).' },
  { ignore: true, title: 'Ignorar', detail: 'Ex.: fechar no sábado à noite e abrir no domingo cedo.' },
];

/** Descanso de 11h entre jornadas: respeitar ou ignorar; mesmo visual do seletor de regime. */
export function RestPicker() {
  const ignore = useAppStore((s) => !!s.document.config.ignoreRest11h);
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <fieldset className="setup-regime">
      <legend className="label">Descanso de 11h entre jornadas</legend>
      <div className="setup-regime-options">
        {OPTIONS.map((o) => (
          <label key={o.title} className={`setup-regime-option${ignore === o.ignore ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="ignoreRest11h"
              value={o.title}
              checked={ignore === o.ignore}
              onChange={() => updateConfig({ ignoreRest11h: o.ignore })}
            />
            <span>
              <strong>{o.title}</strong>
              <span className="hint">{o.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {ignore && (
        <p className="hint setup-rest-warning">
          Atenção: a CLT exige 11h entre o fim de uma jornada e o início da próxima. Ignorar pode gerar cobrança de
          horas extras na Justiça do Trabalho.
        </p>
      )}
    </fieldset>
  );
}
