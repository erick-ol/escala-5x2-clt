import { useLayoutEffect, useRef, type RefObject } from 'react';

/** `closedby="any"` (fechar tocando fora) ainda não existe no Safari: lá o toque fora é tratado à mão. */
const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

/** `closedby="any"`: Esc, gesto de voltar e toque fora fecham. Ainda não está nos tipos do React, vai como atributo cru. */
export const LIGHT_DISMISS = { closedby: 'any' } as Record<string, string>;

const FIRST_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isOutside(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  // Pela posição, não pelo alvo: o próprio <dialog> também é o alvo dos cliques no seu espaço interno.
  const r = dialog.getBoundingClientRect();
  return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
}

/**
 * Abre um `<dialog>` nativo como modal enquanto o componente estiver montado.
 * O navegador cuida do resto: página inerte, foco preso, Esc/gesto de voltar e o foco de volta para quem abriu.
 * Use com `closedby="any"` no `<dialog>` para fechar tocando fora.
 *
 * `onClose` roda quando o navegador fecha o diálogo (Esc, voltar, toque fora); o pai deve então desmontá-lo.
 * `initialFocus`: elemento que recebe o foco ao abrir (padrão: o primeiro focável, ou o próprio diálogo).
 */
export function useModalDialog(onClose: () => void, initialFocus?: RefObject<HTMLElement>) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Layout effect: a limpeza roda antes de o nó sair do DOM, então close() ainda devolve o foco a quem abriu.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // O evento "close" é assíncrono: se o diálogo já reabriu (StrictMode monta duas vezes), ignora.
    const handleClose = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('close', handleClose);

    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e, dialog);
    };
    // Exige apertar e soltar fora, para não fechar ao terminar uma seleção de texto sobre o fundo.
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e, dialog)) dialog.close();
      pressedOutside = false;
    };
    const lightDismissFallback = !supportsClosedBy && dialog.getAttribute('closedby') === 'any';
    if (lightDismissFallback) {
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
    }

    if (!dialog.open) dialog.showModal();
    // O React não repassa `autofocus` ao DOM, então o foco inicial é explícito.
    (initialFocus?.current ?? dialog.querySelector<HTMLElement>(FIRST_FOCUSABLE) ?? dialog).focus();

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (lightDismissFallback) {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      }
      if (dialog.open) dialog.close();
    };
    // Abre uma vez por montagem; onClose atual fica no ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
