import { useState } from 'react';
import { formatTime, parseTime } from '../../domain/time';
import type { Minutes } from '../../domain/types';
import { maskTime, TIME_FIELD_PROPS } from '../timeMask';

interface TimeInputProps {
  value: Minutes;
  onChange(value: Minutes): void;
  label: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** Campo de horário em 24h que só grava valores completos; enquanto a pessoa digita, mantém o rascunho local. */
export function TimeInput({ value, onChange, label, id, invalid, disabled }: TimeInputProps) {
  const [draft, setDraft] = useState(formatTime(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(formatTime(value));
  }
  return (
    <input
      id={id}
      {...TIME_FIELD_PROPS}
      className="input mono"
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={draft}
      onChange={(e) => {
        const masked = maskTime(e.target.value);
        setDraft(masked);
        const parsed = parseTime(masked);
        if (parsed !== null && parsed !== value) {
          setSynced(parsed);
          onChange(parsed);
        }
      }}
      onBlur={() => setDraft(formatTime(value))}
    />
  );
}
