import { useEffect, useState } from 'react';
import { appStore, requestPersistentStorage, useAppStore } from './state/store';
import { fitAddedEmployees, runGenerate } from './state/useDerived';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ExportPanel } from './ui/export/ExportPanel';
import { LegalNotice } from './ui/LegalNotice';
import { ScheduleView, type MonthRef } from './ui/schedule/ScheduleView';
import { FirstVisit } from './ui/setup/FirstVisit';
import { SetupWizard } from './ui/setup/SetupWizard';
import { StorageWarning } from './ui/StorageWarning';
import './ui/schedule/schedule.css';

type View = 'first' | 'wizard' | 'schedule';

function initialView(): View {
  const { hasSavedData, document } = appStore.getState();
  if (!hasSavedData) return 'first';
  return document.schedule || document.employees.length > 0 ? 'schedule' : 'wizard';
}

export function App() {
  const [view, setView] = useState<View>(initialView);
  const [exportOpen, setExportOpen] = useState(false);
  /** Mês mostrado na visão Mês quando "Exportar" foi tocado (a exportação oferece a folha do mês). */
  const [exportMonth, setExportMonth] = useState<MonthRef | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  /** Quem já tinha linha na escala quando a configuração foi aberta (para encaixar quem entrar depois). */
  const [idsBefore, setIdsBefore] = useState<ReadonlySet<string>>(() => new Set());
  /** Remonta a tela da escala após uma geração vinda da configuração (erro inicial novo). */
  const [scheduleKey, setScheduleKey] = useState(0);
  const storeName = useAppStore((s) => s.document.config.name);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  const openWizard = () => {
    setIdsBefore(new Set(Object.keys(appStore.getState().document.schedule ?? {})));
    setView('wizard');
  };

  const showSchedule = (error: string | null) => {
    setGenError(error);
    setScheduleKey((k) => k + 1);
    setView('schedule');
  };

  const onWizardFinish = () => {
    showSchedule(runGenerate());
  };

  /** Volta da configuração para a escala existente, ajustando-a à configuração nova sem regerar. */
  const backToSchedule = () => {
    // Dias abertos/fechados, turnos removidos etc.; depois encaixa quem entrou na equipe.
    appStore.getState().replaceDocument(appStore.getState().document);
    fitAddedEmployees(idsBefore);
    showSchedule(null);
  };

  const hasSchedule = useAppStore((s) => s.document.schedule !== null);

  return (
    <div className="app">
      <StorageWarning />

      {view === 'first' && (
        <main className="container app-main">
          <FirstVisit onStart={() => openWizard()} />
        </main>
      )}

      {view === 'wizard' && (
        <main className="container app-main">
          <SetupWizard
            onFinish={onWizardFinish}
            onBackToSchedule={hasSchedule ? backToSchedule : undefined}
            onRegenerate={hasSchedule ? () => setConfirmRegen(true) : undefined}
          />
        </main>
      )}

      {view === 'schedule' && (
        <>
          <header className="app-header">
            <div className="container app-header-inner">
              <div className="app-brand">
                <span className="app-brand-mark" aria-hidden="true">
                  5×2
                </span>
                <div>
                  <p className="app-brand-kicker">Quadro de escala</p>
                  <h1 className="app-title">{storeName.trim() || 'Escala 5x2'}</h1>
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={openWizard}>
                Configurar
              </button>
            </div>
          </header>
          <main className="container app-main">
            <ScheduleView
              key={scheduleKey}
              initialError={genError}
              onExport={(month) => {
                setExportMonth(month ?? null);
                setExportOpen(true);
              }}
            />
          </main>
        </>
      )}

      <div className="container app-footer">
        <LegalNotice />
      </div>

      {exportOpen && <ExportPanel month={exportMonth ?? undefined} onClose={() => setExportOpen(false)} />}

      <ConfirmDialog
        open={confirmRegen}
        title="Gerar uma escala nova do zero?"
        confirmLabel="Gerar escala nova"
        cancelLabel="Cancelar"
        danger
        onCancel={() => setConfirmRegen(false)}
        onConfirm={() => {
          setConfirmRegen(false);
          showSchedule(runGenerate());
        }}
      >
        <p>
          Some: trocas de folga, horários ajustados só num dia, ajustes de datas do mês e marcações de cobertura. Fica:
          os horários do cadastro de cada pessoa, o início do ciclo no calendário e os feriados.
        </p>
      </ConfirmDialog>
    </div>
  );
}
