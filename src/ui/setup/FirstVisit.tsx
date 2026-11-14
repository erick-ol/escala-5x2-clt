import { emptyDocument } from '../../domain/example';
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
    <section className="first-visit card" aria-labelledby="first-visit-title">
      <p className="first-visit-kicker label">Escala 5x2 · EC 141/2026</p>
      <h1 id="first-visit-title" className="first-visit-title">
        Monte a escala 5x2 da sua equipe em minutos.
      </h1>
      <p className="first-visit-lead">
        Informe o horário da loja, os turnos e a equipe; o site gera a escala dentro das regras e mostra onde falta gente.
      </p>
      <div className="first-visit-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            loadExample();
            onStart();
          }}
        >
          Ver exemplo
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            replaceDocument(emptyDocument(new Date()));
            onStart();
          }}
        >
          Começar do zero
        </button>
        <RestoreBackupButton variant="ghost" onRestored={onStart} />
      </div>
      <p className="hint">O exemplo é um mercado com 7 funcionários. Dá para explorar e apagar depois.</p>
    </section>
  );
}
