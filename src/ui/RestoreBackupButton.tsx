import { useRef, useState, type ChangeEvent } from 'react';
import type { AppDocument } from '../domain/types';
import { parseBackup } from '../state/backup';
import { appStore } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';

export interface RestoreBackupButtonProps {
  onRestored?(): void;
  variant?: 'default' | 'primary' | 'ghost';
  className?: string;
}

function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** R21: restaura um backup .json. Arquivo inválido mostra o erro e mantém a escala atual. */
export function RestoreBackupButton({ onRestored, variant = 'default', className }: RestoreBackupButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AppDocument | null>(null);

  const apply = (document: AppDocument) => {
    appStore.getState().replaceDocument(document);
    setPending(null);
    onRestored?.();
  };

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setError(null);
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setError('Não foi possível ler o arquivo.');
      return;
    }
    const result = parseBackup(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (appStore.getState().document.employees.length > 0) {
      setPending(result.document);
    } else {
      apply(result.document);
    }
  };

  const btnClass = variant === 'primary' ? 'btn btn-primary' : variant === 'ghost' ? 'btn btn-ghost' : 'btn';

  return (
    <div className={['restore-backup', className].filter(Boolean).join(' ')}>
      <button type="button" className={btnClass} onClick={() => inputRef.current?.click()}>
        Restaurar backup
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Arquivo de backup"
        onChange={onChange}
      />
      {error && (
        <p role="alert" className="error-text">
          {error} Nada foi alterado.
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title="Substituir a escala atual?"
        confirmLabel="Substituir pelo backup"
        danger
        onConfirm={() => pending && apply(pending)}
        onCancel={() => setPending(null)}
      >
        <p>A configuração, a equipe e a escala salvas neste aparelho serão trocadas pelas do arquivo.</p>
      </ConfirmDialog>
    </div>
  );
}
