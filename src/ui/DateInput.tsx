import { useEffect, useRef, useState } from 'react';
import { isISODate } from '../domain/dates';

export interface DateInputProps {
  id: string;
  /** Data em ISO (AAAA-MM-DD). */
  value: string;
  /** Recebe a data em ISO quando a pessoa termina de digitar uma data válida (ou escolhe no calendário). */
  onChange(iso: string): void;
  min?: string;
  'aria-describedby'?: string;
}

/** "2026-12-06" → "06/12/2026". */
export function isoToBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "06/12/2026" → "2026-12-06" (null se não for uma data que existe). */
export function brToISO(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isISODate(iso) ? iso : null;
}

/** Só os dígitos, com as barras no lugar: "06122026" → "06/12/2026". */
function mask(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/**
 * Campo de data sempre em DD/MM/AAAA. O `type="date"` nativo segue o idioma do navegador (num Chrome em
 * inglês aparece MM/DD/AAAA), então o campo é de texto com máscara e o calendário nativo fica num botão.
 */
export function DateInput({ id, value, onChange, min, 'aria-describedby': describedBy }: DateInputProps) {
  const [text, setText] = useState(() => isoToBR(value));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // A data gravada pode mudar por fora (ex.: vira o domingo da semana): o campo mostra a gravada.
  useEffect(() => {
    setText(isoToBR(value));
    setInvalid(false);
  }, [value]);

  const commit = (iso: string | null) => {
    if (iso && (!min || iso >= min)) {
      setInvalid(false);
      onChange(iso);
    } else {
      setInvalid(true);
    }
  };

  const errorId = `${id}-erro`;
  return (
    <div className="date-input">
      <div className="date-input-row">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/AAAA"
          maxLength={10}
          className="input mono"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined}
          onChange={(e) => {
            const next = mask(e.target.value);
            setText(next);
            if (next.length === 10) commit(brToISO(next));
            else setInvalid(false);
          }}
          onBlur={() => {
            if (text.length > 0 && text.length < 10) setInvalid(true);
          }}
        />
        <button
          type="button"
          className="btn btn-sm date-input-pick"
          onClick={() => {
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus();
            }
          }}
        >
          Calendário
        </button>
        <input
          ref={picker}
          type="date"
          className="date-input-native"
          tabIndex={-1}
          aria-hidden="true"
          min={min}
          value={value}
          onChange={(e) => commit(isISODate(e.target.value) ? e.target.value : null)}
        />
      </div>
      {invalid && (
        <p id={errorId} className="error-text date-input-error">
          Data inválida. Use DD/MM/AAAA{min ? `, a partir de ${isoToBR(min)}` : ''}.
        </p>
      )}
    </div>
  );
}
