import { useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { backupFileName, serializeBackup } from '../../state/backup';
import { appStore, useAppStore } from '../../state/store';
import { RestoreBackupButton } from '../RestoreBackupButton';
import { LIGHT_DISMISS, useModalDialog } from '../useModalDialog';
import { monthLabel } from '../../domain/dates';
import { ImageExport, cyclePages, monthPages } from './ImageExport';
import { MonthPrintSheet, PrintSheet } from './PrintSheet';
import { downloadBlob, formatDateTime } from './download';
import { buildExportModel, buildMonthExportModel } from './exportModel';
import { buildTeamCalendar } from './calendarModel';
import { PersonalImageExport, PersonalPrintSheet } from './PersonalSheet';
import { buildPersonalModels, type PersonalScope } from './personalModel';
import { TeamCalendarImageExport, TeamCalendarPrintSheet } from './TeamCalendar';
import './export.css';

export interface ExportPanelProps {
  /** Aberto a partir da visão Mês: oferece exportar o mês (padrão) ou o ciclo. */
  month?: { year: number; month: number };
  onClose(): void;
}

/**
 * Painel de exportação (R20, R21). De cima para baixo: para quem (equipe ou uma pessoa), período e formato
 * quando há escolha, as duas ações (compartilhar imagem e imprimir) e o backup no rodapé.
 */
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
  /** Formato do mês: calendário de parede (padrão) ou a tabela por semana. O ciclo é sempre tabela. */
  const [format, setFormat] = useState<'calendar' | 'table'>('calendar');
  const calendar = !!monthModel && format === 'calendar';
  const teamCalendar = useMemo(() => (monthModel ? buildTeamCalendar(monthModel) : null), [monthModel]);
  const [justBackedUp, setJustBackedUp] = useState(false);

  // Por funcionário: o período segue a escolha acima (mês ou ciclo).
  const personalScope = useMemo<PersonalScope>(
    () => (month && scope === 'month' ? { kind: 'month', year: month.year, month: month.month } : { kind: 'cycle' }),
    [month, scope],
  );
  const personalModels = useMemo(() => buildPersonalModels(document_, personalScope), [document_, personalScope]);
  const [personId, setPersonId] = useState<string>(() => document_.employees[0]?.id ?? '');
  /** Para quem: a escala da equipe toda ou a de uma pessoa (para entregar a ela). */
  const [who, setWho] = useState<'team' | 'person'>('team');
  const person = personalModels.find((m) => m.employeeId === personId) ?? personalModels[0] ?? null;
  /** Folha que vai para a impressão: a da equipe, a da pessoa escolhida ou a de todos (uma página cada). */
  const [printTarget, setPrintTarget] = useState<'team' | 'person' | 'all'>('team');
  const printSheets = printTarget === 'all' ? personalModels : printTarget === 'person' && person ? [person] : [];
  const print = (target: 'team' | 'person' | 'all') => {
    // A folha certa precisa estar no DOM antes da janela de impressão abrir.
    flushSync(() => setPrintTarget(target));
    window.print();
  };

  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useModalDialog(onClose, closeRef);
  const titleId = useId();
  const whoId = useId();
  const scopeId = useId();
  const formatId = useId();
  const backupId = useId();
  const personSelectId = useId();

  const downloadBackup = () => {
    const doc = appStore.getState().document;
    const blob = new Blob([serializeBackup(doc)], { type: 'application/json' });
    downloadBlob(blob, backupFileName(doc));
    appStore.getState().markBackupDone();
    setJustBackedUp(true);
  };

  const forPerson = who === 'person' && !!person;
  const printButton = (
    <button type="button" className="btn" onClick={() => print(forPerson ? 'person' : 'team')}>
      Imprimir
    </button>
  );

  return (
    <dialog ref={panelRef} className="export-panel card" aria-labelledby={titleId} {...LIGHT_DISMISS}>
      <header className="export-head">
        <div>
          <h2 id={titleId} className="export-title">
            Exportar escala
          </h2>
          <p className="export-store">{model.storeName}</p>
        </div>
        <button ref={closeRef} type="button" className="btn btn-ghost export-close" onClick={onClose}>
          Fechar
        </button>
      </header>

      {model.hasSchedule ? (
        <>
          <section className="export-options" aria-label="O que exportar">
            {person && (
              <div className="export-option">
                <span id={whoId} className="label">
                  Para quem
                </span>
                <div className="seg" role="group" aria-labelledby={whoId}>
                  <button type="button" className="seg-btn" aria-pressed={!forPerson} onClick={() => setWho('team')}>
                    Equipe toda
                  </button>
                  <button type="button" className="seg-btn" aria-pressed={forPerson} onClick={() => setWho('person')}>
                    Uma pessoa
                  </button>
                </div>
              </div>
            )}
            {forPerson && person && (
              <div className="field export-option">
                <label htmlFor={personSelectId}>Funcionário</label>
                <select
                  id={personSelectId}
                  className="input"
                  value={person.employeeId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  {personalModels.map((m) => (
                    <option key={m.employeeId} value={m.employeeId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {month && (
              <div className="export-option">
                <span id={scopeId} className="label">
                  Período
                </span>
                <div className="seg" role="group" aria-labelledby={scopeId}>
                  <button type="button" className="seg-btn" aria-pressed={scope === 'month'} onClick={() => setScope('month')}>
                    {monthLabel(month.year, month.month)}
                  </button>
                  <button type="button" className="seg-btn" aria-pressed={scope === 'cycle'} onClick={() => setScope('cycle')}>
                    Ciclo de 3 semanas
                  </button>
                </div>
              </div>
            )}
            {monthModel && !forPerson && (
              <div className="export-option">
                <span id={formatId} className="label">
                  Formato
                </span>
                <div className="seg" role="group" aria-labelledby={formatId}>
                  <button
                    type="button"
                    className="seg-btn"
                    aria-pressed={format === 'calendar'}
                    onClick={() => setFormat('calendar')}
                  >
                    Calendário
                  </button>
                  <button type="button" className="seg-btn" aria-pressed={format === 'table'} onClick={() => setFormat('table')}>
                    Tabela por semana
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="export-actions" aria-label="Compartilhar ou imprimir">
            {forPerson && person ? (
              <>
                <PersonalImageExport model={person} secondary={printButton} />
                <button type="button" className="btn btn-ghost btn-sm export-print-all" onClick={() => print('all')}>
                  Imprimir todos (uma página por pessoa)
                </button>
              </>
            ) : calendar && teamCalendar ? (
              <TeamCalendarImageExport model={teamCalendar} secondary={printButton} />
            ) : (
              <ImageExport
                key={monthModel ? 'month' : 'cycle'}
                storeName={model.storeName}
                legend={model.legend}
                pages={pages}
                secondary={printButton}
              />
            )}
          </section>

          {calendar && teamCalendar ? (
            <TeamCalendarPrintSheet model={teamCalendar} skip={printTarget !== 'team'} />
          ) : monthModel ? (
            <MonthPrintSheet model={monthModel} skip={printTarget !== 'team'} />
          ) : (
            <PrintSheet model={model} skip={printTarget !== 'team'} />
          )}
          {printSheets.length > 0 && <PersonalPrintSheet models={printSheets} />}
        </>
      ) : (
        <p className="export-empty">Gere a escala para poder imprimir ou compartilhar a imagem.</p>
      )}

      <section className="export-backup" aria-labelledby={backupId}>
        <div className="export-backup-text">
          <h3 id={backupId} className="export-backup-title">
            Backup
          </h3>
          <p className="export-backup-status" aria-live="polite">
            {justBackedUp && lastBackupAt
              ? `Backup baixado em ${formatDateTime(lastBackupAt)}`
              : lastBackupAt
                ? `Último backup em ${formatDateTime(lastBackupAt)}`
                : 'Nenhum backup ainda. O iPhone pode apagar os dados do site depois de dias sem uso.'}
          </p>
        </div>
        <div className="export-backup-actions">
          <button type="button" className="btn btn-sm" onClick={downloadBackup}>
            Baixar backup
          </button>
          <RestoreBackupButton variant="ghost" className="export-restore" />
        </div>
      </section>
    </dialog>
  );
}
