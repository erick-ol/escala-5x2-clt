import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { backupFileName, serializeBackup } from '../../state/backup';
import { appStore, useAppStore } from '../../state/store';
import { RestoreBackupButton } from '../RestoreBackupButton';
import { ImageExport } from './ImageExport';
import { PrintSheet } from './PrintSheet';
import { downloadBlob, formatDateTime } from './download';
import { buildExportModel } from './exportModel';
import './export.css';

export interface ExportPanelProps {
  onClose(): void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Painel de exportação (R20, R21): imprimir, imagem para WhatsApp e backup em destaque. */
export function ExportPanel({ onClose }: ExportPanelProps) {
  const document_ = useAppStore((s) => s.document);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const model = useMemo(() => buildExportModel(document_), [document_]);
  const [justBackedUp, setJustBackedUp] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const printId = useId();
  const imageId = useId();
  const backupId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const downloadBackup = () => {
    const doc = appStore.getState().document;
    const blob = new Blob([serializeBackup(doc)], { type: 'application/json' });
    downloadBlob(blob, backupFileName(doc));
    appStore.getState().markBackupDone();
    setJustBackedUp(true);
  };

  return createPortal(
    <div className="export-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="export-panel card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="export-head">
          <div>
            <p className="export-kicker label">{model.storeName}</p>
            <h2 id={titleId} className="export-title">
              Exportar escala
            </h2>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost export-close" onClick={onClose}>
            Fechar
          </button>
        </header>

        <section className="export-section export-backup" aria-labelledby={backupId}>
          <h3 id={backupId} className="export-section-title">
            Backup
          </h3>
          <p className="hint">
            Guarde uma cópia da configuração e da escala. O iPhone pode apagar os dados do site depois de alguns dias
            sem uso.
          </p>
          <button type="button" className="btn btn-primary export-backup-btn" onClick={downloadBackup}>
            Baixar backup
          </button>
          <p className="export-backup-status" aria-live="polite">
            {justBackedUp && lastBackupAt
              ? `Backup baixado em ${formatDateTime(lastBackupAt)}`
              : lastBackupAt
                ? `Último backup em ${formatDateTime(lastBackupAt)}`
                : 'Você ainda não baixou nenhum backup.'}
          </p>
          <RestoreBackupButton variant="ghost" className="export-restore" />
        </section>

        {model.hasSchedule ? (
          <>
            <section className="export-section" aria-labelledby={printId}>
              <h3 id={printId} className="export-section-title">
                Imprimir
              </h3>
              <p className="hint">Uma folha em paisagem com as 3 semanas do ciclo, legível em preto e branco.</p>
              <button type="button" className="btn" onClick={() => window.print()}>
                Imprimir escala
              </button>
            </section>

            <section className="export-section" aria-labelledby={imageId}>
              <h3 id={imageId} className="export-section-title">
                Imagem para WhatsApp
              </h3>
              <p className="hint">Uma imagem por semana, para caber na tela do celular.</p>
              <ImageExport model={model} />
            </section>
            <PrintSheet model={model} />
          </>
        ) : (
          <p className="export-empty">Gere a escala para poder imprimir ou compartilhar a imagem.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
