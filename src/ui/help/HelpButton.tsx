import { useId, useState } from 'react';
import { LIGHT_DISMISS, useModalDialog } from '../useModalDialog';
import { FAQ, INSTAGRAM_HANDLE, INSTAGRAM_URL, TUTORIAL } from './helpContent';
import './help.css';

type Tab = 'faq' | 'tutorial';

export interface HelpButtonProps {
  /** Sobe o balão para ficar acima de uma barra fixa no rodapé (configuração e escala). */
  aboveBar?: boolean;
  /** Abre o painel "Gerar com IA" (a ajuda fecha antes). */
  onOpenAi?(): void;
}

/** Balão flutuante "?" no canto inferior direito que abre as perguntas frequentes e o tutorial. */
export function HelpButton({ aboveBar = false, onOpenAi }: HelpButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`help-fab${aboveBar ? ' help-fab-raised' : ''}`}
        aria-label="Ajuda: perguntas frequentes e como usar"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <HelpPanel
          onClose={() => setOpen(false)}
          onOpenAi={
            onOpenAi &&
            (() => {
              setOpen(false);
              onOpenAi();
            })
          }
        />
      )}
    </>
  );
}

function HelpPanel({ onClose, onOpenAi }: { onClose(): void; onOpenAi?: () => void }) {
  const ref = useModalDialog(onClose);
  const titleId = useId();
  const [tab, setTab] = useState<Tab>('faq');

  return (
    <dialog ref={ref} className="help-panel" aria-labelledby={titleId} {...LIGHT_DISMISS}>
      <header className="help-header">
        <div>
          <p className="help-kicker">Ajuda</p>
          <h2 id={titleId} className="help-title">
            Dúvidas e como usar
          </h2>
        </div>
        <button type="button" className="help-close" aria-label="Fechar ajuda" onClick={() => ref.current?.close()}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="help-tabs" role="group" aria-label="Seção da ajuda">
        {(
          [
            ['faq', 'Perguntas frequentes'],
            ['tutorial', 'Como usar'],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            className="help-tab"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="help-body">
        {tab === 'faq' ? (
          FAQ.map((group) => (
            <section key={group.title} className="help-group" aria-label={group.title}>
              <h3 className="help-group-title">{group.title}</h3>
              {group.items.map((item) => (
                <details key={item.q} className="help-q">
                  <summary>{item.q}</summary>
                  <div className="help-a">{item.a}</div>
                </details>
              ))}
            </section>
          ))
        ) : (
          <ol className="help-steps">
            {TUTORIAL.map((step, i) => (
              <li key={step.title} className="help-step">
                <span className="help-step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="help-step-title">{step.title}</h3>
                  <p className="help-step-body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {onOpenAi && (
          <aside className="help-ai" aria-label="Gerar com IA">
            <p className="help-ai-title">Quer montar conversando com uma IA?</p>
            <p>
              O ChatGPT, o Claude ou outra IA faz as perguntas e entrega um código que você importa aqui.
            </p>
            <button type="button" className="btn btn-primary help-ai-btn" onClick={onOpenAi}>
              Gerar com IA
            </button>
          </aside>
        )}

        <aside className="help-contact" aria-label="Falar comigo">
          <p className="help-contact-title">Ficou alguma dúvida?</p>
          <p>
            Ah, qualquer coisa, me chama lá no Instagram! Não sei se vou conseguir te responder a tempo, porque pode acabar
            sendo muita gente chamando e eu não conseguir ajudar todo mundo, sabe? Mas, sempre que der, eu respondo. Vou
            fazer o que eu puder.
          </p>
          <a className="btn help-contact-link" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
            @{INSTAGRAM_HANDLE} no Instagram
          </a>
        </aside>
      </div>
    </dialog>
  );
}
