import { LEGAL_DATES, LEGAL_SOURCE_URL } from '../domain/legal';
import './export/legal.css';

/** "2026-12-15" → "15/12/2026" */
function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** R23: aviso discreto e permanente de que a ferramenta é orientativa. */
export function LegalNotice() {
  return (
    <footer className="legal-notice">
      <p>
        Ferramenta orientativa baseada na EC 141/2026: escala 5x2, com teto de 42h semanais a partir de{' '}
        {formatIsoDate(LEGAL_DATES.start42h)} e de 40h a partir de {formatIsoDate(LEGAL_DATES.switch40h)}. Não
        substitui orientação jurídica nem a convenção coletiva da sua categoria.{' '}
        <a href={LEGAL_SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Ver texto oficial
        </a>
      </p>
    </footer>
  );
}
