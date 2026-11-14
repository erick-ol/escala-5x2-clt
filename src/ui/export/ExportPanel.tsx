import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { backupFileName, serializeBackup } from '../../state/backup';
import { appStore, useAppStore } from '../../state/store';
import { RestoreBackupButton } from '../RestoreBackupButton';
import { monthLabel } from '../../domain/dates';
import { ImageExport, cyclePages, monthPages } from './ImageExport';
import { MonthPrintSheet, PrintSheet } from './PrintSheet';
import { downloadBlob, formatDateTime } from './download';
import { buildExportModel, buildMonthExportModel } from './exportModel';
import './export.css';

export interface ExportPanelProps {
  /** Aberto a partir da visão Mês: oferece exportar o mês (padrão) ou o ciclo. */
  month?: { year: number; month: number };
  onClose(): void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Painel de exportação (R20, R21): imprimir, imagem para WhatsApp e backup em destaque. */
export function ExportPanel({ month, onClose }: ExportPanelProps) {
  const document_ = useAppStore((s) => s.document);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const [scope, setScope] = useState<'cycle' | 'month'>(month ? 'month' : 'cycle');
  const model = useMemo(() => buildExportModel(document_), [document_]);
  const monthModel = useMemo(
    () => (month && scope === 'month' ? buildMonthExportModel(document_, month.year, month.month) : null),
    [document_, month, scope],
  );
  const pages = useMemo(() => (monthModel ? monthPages(monthModel) : cyclePages(model)), [model, monthModel]);
  const [justBackedUp, setJustBackedUp] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const printId = useId();
  const imageId = useId();
  const backupId = useId();
  const scopeId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (panelRef.current && !panelRef.current.contains(event.target as Node)) return;
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
            {month && (
              <section className="export-section" aria-labelledby={scopeId}>
                <h3 id={scopeId} className="export-section-title">
                  O que exportar
                </h3>
                <div className="seg export-scope" role="group" aria-labelledby={scopeId}>
                  <button type="button" className="seg-btn" aria-pressed={scope === 'month'} onClick={() => setScope('month')}>
                    Mês: {monthLabel(month.year, month.month)}
                  </button>
                  <button type="button" className="seg-btn" aria-pressed={scope === 'cycle'} onClick={() => setScope('cycle')}>
                    Ciclo de 3 semanas
                  </button>
                </div>
              </section>
            )}
            <section className="export-section" aria-labelledby={printId}>
              <h3 id={printId} className="export-section-title">
                Imprimir
              </h3>
              <p className="hint">
                {monthModel
                  ? `Folhas em paisagem com as semanas de ${monthModel.monthLabel.toLowerCase()} nas datas reais, legíveis em preto e branco.`
                  : 'Uma folha em paisagem com as 3 semanas do ciclo, legível em preto e branco.'}
              </p>
              <button type="button" className="btn" onClick={() => window.print()}>
                Imprimir escala
              </button>
            </section>

            <section className="export-section" aria-labelledby={imageId}>
              <h3 id={imageId} className="export-section-title">
                Imagem para WhatsApp
              </h3>
              <p className="hint">Uma imagem por semana, para caber na tela do celular.</p>
              <ImageExport key={monthModel ? 'month' : 'cycle'} storeName={model.storeName} legend={model.legend} pages={pages} />
            </section>
            {monthModel ? <MonthPrintSheet model={monthModel} /> : <PrintSheet model={model} />}
          </>
        ) : (
          <p className="export-empty">Gere a escala para poder imprimir ou compartilhar a imagem.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
