import { useId, useRef, type ReactNode } from 'react';
import { LIGHT_DISMISS, useModalDialog } from './useModalDialog';
import './setup/setup.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Verbo específico da ação (ex.: "Apagar tudo e começar do zero"). */
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** Componente único de confirmação para ações destrutivas. Foco inicial em "Cancelar". */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return props.open ? <OpenConfirmDialog {...props} /> : null;
}

function OpenConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog(onCancel, cancelRef);
  const titleId = useId();
  const bodyId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog card"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      {...LIGHT_DISMISS}
    >
      <h2 id={titleId} className="confirm-title">
        {title}
      </h2>
      {children && (
        <div id={bodyId} className="confirm-body">
          {children}
        </div>
      )}
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
