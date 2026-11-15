import { EXAMPLES, emptyDocument } from '../../domain/example';
import { useAppStore } from '../../state/store';
import { RestoreBackupButton } from '../RestoreBackupButton';
import './setup.css';

export interface FirstVisitProps {
  onStart(): void;
}

export function FirstVisit({ onStart }: FirstVisitProps) {
  const loadExample = useAppStore((s) => s.loadExample);
  const replaceDocument = useAppStore((s) => s.replaceDocument);

  return (
    <section className="first-visit" aria-labelledby="first-visit-title">
      <p className="first-visit-kicker">
        <span className="brand-dot" aria-hidden="true" />
        Escala 5x2 <span className="first-visit-law">· EC 141/2026</span>
      </p>
      <h1 id="first-visit-title" className="first-visit-title">
        Monte a escala 5x2 da sua equipe em minutos.
      </h1>
      <p className="first-visit-lead">
        Informe o horário da loja, os turnos e a equipe; o site gera a escala dentro das regras e mostra onde falta gente.
      </p>
      <div className="first-visit-examples" role="group" aria-labelledby="first-visit-examples-title">
        <h2 id="first-visit-examples-title" className="first-visit-examples-title">
          Ver um exemplo pronto
        </h2>
        <ul className="first-visit-example-list">
          {EXAMPLES.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                className="first-visit-example"
                aria-labelledby={`example-${example.id}`}
                aria-describedby={`example-${example.id}-summary`}
                onClick={() => {
                  loadExample(example.id);
                  onStart();
                }}
              >
                <span id={`example-${example.id}`} className="first-visit-example-name">
                  {example.label}
                </span>
                <span id={`example-${example.id}-summary`} className="first-visit-example-summary">
                  {example.summary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="first-visit-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            replaceDocument(emptyDocument(new Date()));
            onStart();
          }}
        >
          Começar do zero
        </button>
        <RestoreBackupButton variant="ghost" onRestored={onStart} />
      </div>
      <p className="hint">Os exemplos são só um ponto de partida: dá para mudar tudo ou apagar depois.</p>
    </section>
  );
}
