/**
 * Máscara de horário em 24h (hh:mm) para campos de texto.
 * Aceita "0545" -> "05:45" e "5:45" -> "5:45"; nunca mostra AM/PM.
 */
export function maskTime(raw: string): string {
  if (raw.includes(':')) {
    const [left, ...rest] = raw.split(':');
    const h = left.replace(/\D/g, '').slice(0, 2);
    const m = rest.join('').replace(/\D/g, '').slice(0, 2);
    return `${h}:${m}`;
  }
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** Atributos comuns dos campos de horário em 24h. */
export const TIME_FIELD_PROPS = {
  type: 'text',
  inputMode: 'numeric',
  autoComplete: 'off',
  placeholder: 'hh:mm',
  maxLength: 5,
  pattern: '[0-2]?[0-9]:[0-5][0-9]',
} as const;
