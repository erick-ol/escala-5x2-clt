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
  onFinish(): void;
  initialStep?: number;
}

const STEPS = [
  { title: 'Loja', Component: StoreHoursStep },
  { title: 'Turnos', Component: ShiftsStep },
  { title: 'Funções', Component: RolesStep },
  { title: 'Equipe', Component: TeamStep },
] as const;

const LAST = STEPS.length - 1;

export function SetupWizard({ onFinish, initialStep = 0 }: SetupWizardProps) {
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

  const next = () => {
    if (step < LAST) {
      goTo(step + 1);
      return;
    }
    for (let i = 0; i <= LAST; i += 1) {
      if (STEP_VALIDATORS[i](appStore.getState().document)) {
        setStep(i);
        setErrorStep(i);
        return;
      }
    }
    onFinish();
  };

  return (
    <div className="setup">
      <header className="setup-header">
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

      {document.schedule !== null && (
        <p className="setup-banner" role="status">
          A escala já foi gerada. Ao terminar, você poderá gerar de novo com as mudanças.
        </p>
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
            Voltar
          </button>
          <button type="button" className="btn btn-primary" onClick={next}>
            {step === LAST ? 'Gerar escala' : 'Próximo'}
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
