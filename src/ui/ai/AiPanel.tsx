import { useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { AppDocument } from '../../domain/types';
import { appStore } from '../../state/store';
import { ConfirmDialog } from '../ConfirmDialog';
import { LIGHT_DISMISS, useModalDialog } from '../useModalDialog';
import { parseAiImport } from './aiFormat';
import { buildAiPrompt } from './aiPrompt';
import '../help/help.css';
import './ai.css';

export type AiImportSource = 'ia' | 'backup';

export interface AiPanelProps {
  onClose(): void;
  /** Chamado depois de o documento importado substituir o atual. */
  onImported(source: AiImportSource): void;
}

const AI_LINKS = [
  { name: 'ChatGPT', href: 'https://chatgpt.com/' },
  { name: 'Claude', href: 'https://claude.ai/new' },
  { name: 'Gemini', href: 'https://gemini.google.com/' },
] as const;

/** Copia para a área de transferência; sem a API (ou sem permissão), seleciona o campo e usa o comando antigo. */
async function copyText(text: string, fallback?: () => HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = fallback?.();
    if (!field) return false;
    field.focus();
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** "Gerar com IA": texto para colar no ChatGPT/Claude/Gemini e importação do código que a IA devolve. */
export function AiPanel({ onClose, onImported }: AiPanelProps) {
  const ref = useModalDialog(onClose);
  const titleId = useId();
  const pasteId = useId();
  const prompt = useMemo(() => buildAiPrompt(), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptDetails = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<'prompt' | 'errors' | null>(null);
  /** O navegador não deixou copiar: o texto aparece selecionado para copiar à mão. */
  const [manualCopy, setManualCopy] = useState(false);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState<{ document: AppDocument; source: AiImportSource } | null>(null);

  const flash = (what: 'prompt' | 'errors') => {
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500);
  };

  const copyPrompt = async () => {
    setManualCopy(false);
    // Plano B: abre "Ver o texto" para o campo ficar visível e selecionável.
    const ok = await copyText(prompt, () => {
      if (promptDetails.current) promptDetails.current.open = true;
      return promptRef.current;
    });
    if (ok) flash('prompt');
    else {
      // Não deu para copiar sozinho: o texto fica aberto e selecionado para a pessoa copiar.
      promptRef.current?.select();
      setManualCopy(true);
    }
  };

  const copyErrors = async () => {
    const text = `O site Escala 5x2 mostrou estes erros ao importar o código:\n${errors.map((e) => `- ${e}`).join('\n')}\n\nCorrija e me mande o código completo de novo.`;
    if (await copyText(text)) flash('errors');
  };

  const apply = (document: AppDocument, source: AiImportSource) => {
    appStore.getState().replaceDocument(document);
    setPending(null);
    onImported(source);
  };

  const importText = (text: string) => {
    const result = parseAiImport(text);
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      return;
    }
    setErrors([]);
    setWarnings(result.warnings);
    if (appStore.getState().document.employees.length > 0) setPending({ document: result.document, source: result.source });
    else apply(result.document, result.source);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setCode(text);
      importText(text);
    } catch {
      setErrors(['Não foi possível ler o arquivo.']);
    }
  };

  return (
    <dialog ref={ref} className="help-panel ai-panel" aria-labelledby={titleId} {...LIGHT_DISMISS}>
      <header className="help-header">
        <div>
          <p className="help-kicker">Gerar com IA</p>
          <h2 id={titleId} className="help-title">
            Monte a escala conversando com uma IA
          </h2>
        </div>
        <button type="button" className="help-close" aria-label="Fechar" onClick={() => ref.current?.close()}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="help-body ai-body">
        <p className="ai-lead">
          Use o ChatGPT, o Claude, o Gemini ou a IA que você preferir. Ela faz as perguntas, mostra um rascunho da escala e
          entrega um código para você trazer de volta para cá.
        </p>

        <ol className="ai-steps">
          <li className="ai-step">
            <span className="help-step-num" aria-hidden="true">
              1
            </span>
            <div className="ai-step-content">
              <h3 className="help-step-title">Copie o texto para a IA</h3>
              <p className="help-step-body">
                Ele explica para a IA as regras da CLT, o que perguntar a você e como entregar o resultado.
              </p>
              <div className="ai-row">
                <button type="button" className="btn btn-primary" onClick={copyPrompt}>
                  {copied === 'prompt' ? 'Copiado!' : 'Copiar texto para a IA'}
                </button>
                <span className="visually-hidden" role="status">
                  {copied === 'prompt' ? 'Texto copiado.' : ''}
                </span>
              </div>
              {manualCopy && (
                <p className="hint ai-manual" role="status">
                  O navegador não deixou copiar sozinho. O texto está selecionado abaixo: copie com Ctrl+C (ou ⌘+C), ou
                  segure o dedo sobre ele no celular.
                </p>
              )}
              <details ref={promptDetails} className="ai-details">
                <summary>Ver o texto</summary>
                <textarea
                  ref={promptRef}
                  className="input ai-textarea ai-prompt"
                  readOnly
                  value={prompt}
                  aria-label="Texto para a IA"
                  rows={8}
                />
              </details>
            </div>
          </li>

          <li className="ai-step">
            <span className="help-step-num" aria-hidden="true">
              2
            </span>
            <div className="ai-step-content">
              <h3 className="help-step-title">Cole numa IA e responda às perguntas</h3>
              <p className="help-step-body">
                Abra a IA, cole o texto e converse. No fim, ela mostra um rascunho da escala para você ver e entrega um
                código. Funciona no celular também.
              </p>
              <div className="ai-links">
                {AI_LINKS.map((link) => (
                  <a key={link.name} className="btn btn-sm" href={link.href} target="_blank" rel="noopener noreferrer">
                    Abrir o {link.name}
                  </a>
                ))}
              </div>
            </div>
          </li>

          <li className="ai-step">
            <span className="help-step-num" aria-hidden="true">
              3
            </span>
            <div className="ai-step-content">
              <h3 className="help-step-title">Cole aqui o código que a IA entregou</h3>
              <p className="help-step-body">
                Pode colar a resposta inteira: o site acha o código sozinho. Ao importar, ele gera a escala oficial com
                as regras, e você ajusta o que quiser.
              </p>
              <label htmlFor={pasteId} className="visually-hidden">
                Código da IA
              </label>
              <textarea
                id={pasteId}
                className="input ai-textarea"
                rows={6}
                placeholder={'{\n  "formato": "escala-5x2-ia",\n  ...\n}'}
                value={code}
                spellCheck={false}
                aria-invalid={errors.length > 0 || undefined}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (errors.length) setErrors([]);
                }}
              />
              <div className="ai-row">
                <button type="button" className="btn btn-primary" onClick={() => importText(code)}>
                  Importar e gerar a escala
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                  Enviar arquivo .json
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json,text/plain"
                  className="visually-hidden"
                  tabIndex={-1}
                  aria-label="Arquivo com o código da IA"
                  onChange={onFile}
                />
              </div>

              {errors.length > 0 && (
                <div className="ai-errors" role="alert">
                  <p className="ai-errors-title">Não deu para importar. Nada foi alterado.</p>
                  <ul>
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <p className="ai-errors-hint">Dica: mande estes erros para a IA, que ela corrige o código.</p>
                  <button type="button" className="btn btn-sm" onClick={copyErrors}>
                    {copied === 'errors' ? 'Copiado!' : 'Copiar erros para a IA'}
                  </button>
                </div>
              )}
              {warnings.length > 0 && (
                <ul className="ai-warnings">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        </ol>

        <p className="ai-privacy">
          A conversa fica na sua conta da IA, não neste site. Para as pessoas da equipe, basta o primeiro nome.
        </p>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Substituir a escala atual?"
        confirmLabel="Substituir pelo código da IA"
        danger
        onConfirm={() => pending && apply(pending.document, pending.source)}
        onCancel={() => setPending(null)}
      >
        <p>A configuração, a equipe e a escala salvas neste aparelho serão trocadas pelas do código.</p>
      </ConfirmDialog>
    </dialog>
  );
}
