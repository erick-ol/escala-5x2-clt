import sansUrl from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import serifUrl from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2?url';
import serifItalicUrl from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2?url';

/**
 * CSS das fontes embutidas no PNG. Sem isto, o html-to-image embute todas as @font-face da página
 * (todos os alfabetos, ~19 arquivos) a cada imagem. Aqui vão só os 3 arquivos latinos que a imagem usa,
 * baixados uma vez. Se falhar, a imagem sai com as fontes do sistema.
 */
const FACES = [
  { family: 'Source Sans 3 Variable', style: 'normal', weight: '200 900', url: sansUrl },
  { family: 'Source Serif 4 Variable', style: 'normal', weight: '200 900', url: serifUrl },
  { family: 'Source Serif 4 Variable', style: 'italic', weight: '200 900', url: serifItalicUrl },
];

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function buildFontCss(): Promise<string> {
  const faces = await Promise.all(
    FACES.map(async (f) => {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`fonte ${f.url}: ${res.status}`);
      const data = await toDataUrl(await res.blob());
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};src:url(${data}) format('woff2');}`;
    }),
  );
  return faces.join('\n');
}

let cached: Promise<string> | null = null;

/** CSS das fontes para `fontEmbedCSS`; string vazia (sem fontes embutidas) se não der para baixar. */
export function imageFontCss(): Promise<string> {
  cached ??= buildFontCss().catch(() => {
    cached = null; // tenta de novo na próxima imagem
    return '';
  });
  return cached;
}
