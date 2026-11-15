import type { RestFix } from '../../domain/restFixes';
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

/** Linha de avisos de descanso (11h entre jornadas, 35h semanais): em laranja, abaixo dos alertas legais. */
export function WarningLine({ count, onOpen }: AlertCounterProps) {
  if (count === 0) return null;
  return (
    <button type="button" className="alert-counter is-warning" onClick={onOpen}>
      <span className="alert-counter-icon" aria-hidden="true">
        ▲
      </span>
      <span>{plural(count, 'aviso de descanso', 'avisos de descanso')}</span>
      <span className="alert-counter-hint">Menos de 11h entre jornadas · ver lista</span>
    </button>
  );
}

export interface AlertListProps {
  title: string;
  alerts: LegalAlert[];
  employees: Employee[];
  /** Onde o alerta acontece (padrão: dia e semana do ciclo). */
  where?(alert: LegalAlert): string;
  onSelect(alert: LegalAlert): void;
  onClose(): void;
  /** Avisos de descanso em vez de alertas legais (laranja, outro texto). */
  warning?: boolean;
  /** Ajustes sugeridos para um aviso de 11h (só na visão do ciclo). */
  fixesFor?(alert: LegalAlert): RestFix[];
  onApplyFix?(fix: RestFix): void;
}

/** Lista de alertas: pessoa, regra e dia. Tocar leva à célula. */
export function AlertList({ title, alerts, employees, where = alertWhere, onSelect, onClose, warning = false, fixesFor, onApplyFix }: AlertListProps) {
  return (
    <Sheet
      tone={warning ? 'gap' : 'alert'}
      kicker={warning ? 'Avisos de descanso' : 'Alertas legais'}
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
              <button type="button" className={`alert-item${warning ? ' is-warning' : ''}`} onClick={() => onSelect(a)}>
                <span className={`alert-icon${warning ? ' is-warning' : ''}`} aria-hidden="true">
                  {warning ? '▲' : '!'}
                </span>
                <span className="alert-item-body">
                  <span className="alert-item-who">
                    {employeeName(employees, a.employeeId)} · <span className="alert-item-where">{where(a)}</span>
                  </span>
                  <span className="alert-item-msg">{a.message}</span>
                </span>
              </button>
              {fixesFor && onApplyFix && a.kind === 'intershift-rest' && <RestFixList fixes={fixesFor(a)} onApply={onApplyFix} />}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        {warning
          ? fixesFor
            ? 'A CLT pede 11h de descanso entre uma jornada e a próxima. Os ajustes não abrem buraco nem criam alerta legal; depois dá para mudar de novo tocando na célula.'
            : 'A CLT pede 11h de descanso entre uma jornada e a próxima. O site não bloqueia: confira se dá para ajustar.'
          : 'Alertas não impedem salvar nem exportar. Eles somem quando o problema é resolvido.'}
      </p>
    </Sheet>
  );
}

/** Ajustes para um aviso de 11h: o que muda, quantos avisos sobram e o botão de aplicar. */
function RestFixList({ fixes, onApply }: { fixes: RestFix[]; onApply(fix: RestFix): void }) {
  if (fixes.length === 0) {
    return <p className="rest-fixes-none">Sem ajuste simples que não abra buraco ou crie alerta legal.</p>;
  }
  return (
    <div className="rest-fixes">
      <p className="rest-fixes-label">{fixes.length === 1 ? 'Ajuste possível' : 'Ajustes possíveis'}</p>
      <ul>
        {fixes.map((fix) => (
          <li key={fix.text} className="rest-fix">
            <span className="rest-fix-body">
              <span className="rest-fix-text">{fix.text}</span>
              <span className="rest-fix-effect">
{`Tira ${plural(fix.warningsBefore - fix.warningsAfter, 'aviso', 'avisos')} de 11h · sem buraco novo`}
              </span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => onApply(fix)} aria-label={`Aplicar: ${fix.text}`}>
              Aplicar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
