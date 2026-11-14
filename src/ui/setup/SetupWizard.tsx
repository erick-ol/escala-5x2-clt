import { useRef, useState } from 'react';
import { appStore, useAppStore } from '../../state/store';
import { ConfirmDialog } from '../ConfirmDialog';
import { RolesStep } from './RolesStep';
import { STEP_VALIDATORS } from './setupLogic';
import { ShiftsStep } from './ShiftsStep';
import { StoreHoursStep } from './StoreHoursStep';
import { TeamStep } from './TeamStep';
import './setup.css';

export interface SetupWizardProps {
  /** Primeira configuração: gera a escala ao terminar. */
  onFinish(): void;
  initialStep?: number;
  /**
   * Modo de edição (já existe escala): as mudanças são salvas na hora e este botão volta direto para a escala,
   * ajustando-a à configuração nova sem regerar.
   */
  onBackToSchedule?(): void;
  /** Modo de edição: gera uma escala nova do zero (pede confirmação). */
  onRegenerate?(): void;
}

const STEPS = [
  { title: 'Loja', Component: StoreHoursStep },
  { title: 'Turnos', Component: ShiftsStep },
  { title: 'Funções', Component: RolesStep },
  { title: 'Equipe', Component: TeamStep },
] as const;

const LAST = STEPS.length - 1;

export function SetupWizard({ onFinish, initialStep = 0, onBackToSchedule, onRegenerate }: SetupWizardProps) {
  const editing = onBackToSchedule !== undefined;
  const document = useAppStore((s) => s.document);
  const resetToEmpty = useAppStore((s) => s.resetToEmpty);
  const [step, setStep] = useState(() => Math.min(LAST, Math.max(0, initialStep)));
  /** Etapa cujo erro está visível; a mensagem é recalculada ao vivo e some quando o problema é resolvido. */
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

  const error = errorStep === null ? null : STEP_VALIDATORS[errorStep](document);
  const { Component } = STEPS[step];

  const goTo = (target: number) => {
    // Para avançar, todas as etapas anteriores ao destino precisam estar válidas.
    for (let i = Math.min(step, target); i < target; i += 1) {
      if (STEP_VALIDATORS[i](appStore.getState().document)) {
        setStep(i);
        setErrorStep(i);
        return false;
      }
    }
    setStep(target);
    setErrorStep(null);
    headingRef.current?.focus();
    return true;
  };

  /** Confere todas as etapas; se alguma tiver problema, vai até ela e mostra o motivo. */
  const allValid = () => {
    for (let i = 0; i <= LAST; i += 1) {
      if (STEP_VALIDATORS[i](appStore.getState().document)) {
        setStep(i);
        setErrorStep(i);
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (step < LAST) {
      goTo(step + 1);
      return;
    }
    if (!allValid()) return;
    if (editing) onBackToSchedule?.();
    else onFinish();
  };

  const backToSchedule = () => {
    if (allValid()) onBackToSchedule?.();
  };

  const regenerate = () => {
    if (allValid()) onRegenerate?.();
  };

  return (
    <div className="setup">
      <header className="setup-header">
        {editing && (
          <button type="button" className="btn btn-sm setup-back" onClick={backToSchedule}>
            <span aria-hidden="true">←</span> Voltar à escala
          </button>
        )}
        <div className="setup-header-top">
          <h1 className="setup-title">Configurar a escala</h1>
          <button type="button" className="btn btn-ghost setup-reset" onClick={() => setConfirmReset(true)}>
            Começar do zero
          </button>
        </div>
        <nav aria-label="Etapas da configuração">
          <ol className="setup-steps">
            {STEPS.map((s, i) => {
              const done = i < step;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    className={`setup-step-btn${i === step ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                    aria-current={i === step ? 'step' : undefined}
                    onClick={() => goTo(i)}
                  >
                    <span className="setup-step-num mono" aria-hidden="true">
                      {done ? '✓' : i + 1}
                    </span>
                    <span className="setup-step-name">{s.title}</span>
                    <span className="visually-hidden">
                      {`, etapa ${i + 1} de ${STEPS.length}${done ? ', concluída' : ''}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div
            className="setup-progress"
            role="progressbar"
            aria-label="Progresso da configuração"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={step + 1}
            aria-valuetext={`Etapa ${step + 1} de ${STEPS.length}`}
          >
            <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </nav>
      </header>

      {editing && (
        <div className="setup-banner" role="status">
          <p>
            As mudanças são salvas na hora. Use <strong>Voltar à escala</strong> para ver a escala ajustada a elas — quem
            entrou na equipe é encaixado sem mexer nos demais.
          </p>
          {onRegenerate && (
            <button type="button" className="link-btn setup-regen" onClick={regenerate}>
              Gerar escala nova do zero
            </button>
          )}
        </div>
      )}

      <div ref={headingRef} tabIndex={-1} className="setup-body">
        <Component />
      </div>

      <footer className="setup-nav">
        {error && (
          <p role="alert" className="error-text setup-error">
            {error}
          </p>
        )}
        <div className="setup-nav-buttons">
          <button type="button" className="btn" disabled={step === 0} onClick={() => goTo(step - 1)}>
            Anterior
          </button>
          <button type="button" className="btn btn-primary" onClick={next}>
            {step < LAST ? 'Próximo' : editing ? 'Salvar e voltar' : 'Gerar escala'}
          </button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Apagar tudo?"
        confirmLabel="Apagar tudo e começar do zero"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          resetToEmpty();
          setConfirmReset(false);
          setStep(0);
          setErrorStep(null);
        }}
      >
        <p>Funcionamento, turnos, funções, equipe e a escala gerada serão apagados deste aparelho.</p>
      </ConfirmDialog>
    </div>
  );
}
