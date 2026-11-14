import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Painel inferior (bottom sheet): foco preso, Esc fecha e o foco volta para quem abriu. */
export function Sheet({ title, kicker, onClose, children, footer, tone = 'default' }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
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
    if (event.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`sheet sheet-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
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
      </div>
    </div>,
    document.body,
  );
}
