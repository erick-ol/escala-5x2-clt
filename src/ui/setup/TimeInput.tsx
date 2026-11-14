import { useState } from 'react';
import { formatTime, parseTime } from '../../domain/time';
import type { Minutes } from '../../domain/types';

interface TimeInputProps {
  value: Minutes;
  onChange(value: Minutes): void;
  label: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** Campo de horário que só grava valores completos; enquanto a pessoa digita, mantém o rascunho local. */
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
      type="time"
      className="input mono"
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseTime(e.target.value);
        if (parsed !== null && parsed !== value) {
          setSynced(parsed);
          onChange(parsed);
        }
      }}
      onBlur={() => setDraft(formatTime(value))}
    />
  );
}
