import type { LegalAlert } from '../../domain/rules';
import type { Employee } from '../../domain/types';
import { alertWhere, employeeName, plural } from './labels';
import { Sheet } from './Sheet';

export interface AlertCounterProps {
  count: number;
  onOpen(): void;
}

/** Contador geral de alertas legais (R16a). Em vermelho, separado dos buracos (laranja). */
export function AlertCounter({ count, onOpen }: AlertCounterProps) {
  if (count === 0) {
    return (
      <p className="alert-counter is-zero">
        <span className="alert-counter-icon" aria-hidden="true">
          ✓
        </span>
        Nenhum alerta legal
      </p>
    );
  }
  return (
    <button type="button" className="alert-counter" onClick={onOpen}>
      <span className="alert-counter-icon" aria-hidden="true">
        !
      </span>
      <span>{plural(count, 'alerta legal', 'alertas legais')}</span>
      <span className="alert-counter-hint">Não impede exportar · ver lista</span>
    </button>
  );
}

export interface AlertListProps {
  title: string;
  alerts: LegalAlert[];
  employees: Employee[];
  onSelect(alert: LegalAlert): void;
  onClose(): void;
}

/** Lista de alertas: pessoa, regra e dia. Tocar leva à célula. */
export function AlertList({ title, alerts, employees, onSelect, onClose }: AlertListProps) {
  return (
    <Sheet
      tone="alert"
      kicker="Alertas legais"
      title={title}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fechar
        </button>
      }
    >
      {alerts.length === 0 ? (
        <p className="sheet-ok">
          <span aria-hidden="true">✓</span> Nenhum alerta.
        </p>
      ) : (
        <ul className="alert-items">
          {alerts.map((a, i) => (
            <li key={i}>
              <button type="button" className="alert-item" onClick={() => onSelect(a)}>
                <span className="alert-icon" aria-hidden="true">
                  !
                </span>
                <span className="alert-item-body">
                  <span className="alert-item-who">
                    {employeeName(employees, a.employeeId)} · <span className="alert-item-where">{alertWhere(a)}</span>
                  </span>
                  <span className="alert-item-msg">{a.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Alertas não impedem salvar nem exportar. Eles somem quando o problema é resolvido.</p>
    </Sheet>
  );
}
