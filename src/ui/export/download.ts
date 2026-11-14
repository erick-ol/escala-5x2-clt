/** Baixa um Blob como arquivo, via URL temporária. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari precisa da URL viva um instante depois do clique.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'escala'
  );
}

/** "14/11/2026 às 09:05" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Compartilha o arquivo pela folha do sistema (WhatsApp etc.) quando o navegador aceita arquivos;
 * senão, ou se o compartilhamento falhar, baixa o arquivo. Chame direto no toque (gesto do usuário).
 */
export async function shareOrDownload(file: File, title: string): Promise<ShareOutcome> {
  let canShareFiles = false;
  try {
    canShareFiles = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    canShareFiles = false;
  }
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      // Usuário fechou a folha de compartilhamento: nada a fazer.
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}

export const DOWNLOADED_NOTICE = 'Imagem baixada. Envie pelo WhatsApp a partir dos seus arquivos ou fotos.';
