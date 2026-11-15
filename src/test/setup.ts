import '@testing-library/jest-dom/vitest';

/**
 * O jsdom não implementa showModal()/close(). Este shim imita o que os testes conferem do <dialog> modal nativo:
 * atributo `open`, Esc fecha o diálogo de cima (evento `cancel` e depois `close`) e o foco volta para quem abriu.
 * O foco preso e a página inerte são do navegador e não dá para imitar aqui.
 */
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  const stack: { dialog: HTMLDialogElement; opener: Element | null }[] = [];

  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) return;
    stack.push({ dialog: this, opener: document.activeElement });
    this.open = true;
  };

  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    const index = stack.findIndex((entry) => entry.dialog === this);
    const [entry] = index >= 0 ? stack.splice(index, 1) : [];
    const opener = entry?.opener;
    if (opener instanceof HTMLElement && opener.isConnected && this.contains(document.activeElement)) opener.focus();
    // No navegador o evento é assíncrono; aqui é síncrono para os testes não precisarem esperar.
    this.dispatchEvent(new Event('close'));
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const top = stack[stack.length - 1]?.dialog;
    if (!top) return;
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
  });
}
