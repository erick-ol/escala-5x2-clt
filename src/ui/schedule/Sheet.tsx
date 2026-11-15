import { useEffect, useId, type ReactNode } from 'react';
import { LIGHT_DISMISS, useModalDialog } from '../useModalDialog';

export interface SheetProps {
  title: string;
  /** Linha pequena acima do título (ex.: "Semana 1 · terça"). */
  kicker?: string;
  onClose(): void;
  children: ReactNode;
  /** Botões fixos no rodapé do painel. */
  footer?: ReactNode;
  tone?: 'default' | 'gap' | 'alert';
}

/** Painel inferior (bottom sheet) em `<dialog>` modal: o navegador prende o foco, fecha com Esc e devolve o foco. */
export function Sheet({ title, kicker, onClose, children, footer, tone = 'default' }: SheetProps) {
  const ref = useModalDialog(onClose);
  const titleId = useId();

  // Um botão que some ao ser clicado (ex.: "Só este dia") joga o foco para o body; traz de volta para o painel.
  useEffect(() => {
    const node = ref.current;
    if (node && (document.activeElement === null || document.activeElement === document.body)) node.focus();
  });

  return (
    <dialog
      ref={ref}
      className={`sheet sheet-${tone}`}
      aria-labelledby={titleId}
      tabIndex={-1}
      {...LIGHT_DISMISS}
    >
      <div className="sheet-grip" aria-hidden="true" />
      <header className="sheet-header">
        {kicker && <p className="sheet-kicker">{kicker}</p>}
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
      </header>
      <div className="sheet-body">{children}</div>
      {footer && <footer className="sheet-footer">{footer}</footer>}
    </dialog>
  );
}
