import { exampleDocument } from '../domain/example';
import { backupFileName, parseBackup, serializeBackup } from './backup';

describe('backup', () => {
  const doc = exampleDocument(new Date('2026-11-14'));

  test('exportar e reimportar devolve o mesmo documento', () => {
    const result = parseBackup(serializeBackup(doc));
    expect(result).toEqual({ ok: true, document: doc });
  });

  test('JSON inválido retorna erro', () => {
    expect(parseBackup('{nao é json').ok).toBe(false);
  });

  test('JSON de outro app retorna erro', () => {
    expect(parseBackup(JSON.stringify({ foo: 1 })).ok).toBe(false);
  });

  test('esquema de versão desconhecida retorna erro específico', () => {
    const text = JSON.stringify({ app: 'escala-5x2-clt', ...doc, schemaVersion: 99 });
    const result = parseBackup(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/versão/);
  });

  test('documento com campo corrompido retorna erro', () => {
    const text = JSON.stringify({ app: 'escala-5x2-clt', ...doc, employees: [{ id: '' }] });
    expect(parseBackup(text).ok).toBe(false);
  });

  test('nome do arquivo usa o nome da loja sem acentos', () => {
    expect(backupFileName({ ...doc, config: { ...doc.config, name: 'Mercado São João' } }, new Date('2026-11-14'))).toBe(
      'backup-mercado-sao-joao-2026-11-14.json',
    );
  });
});

describe('backup antigo sem marcações de almoço', () => {
  test('é aceito com lista vazia de marcações de almoço', () => {
    const doc = exampleDocument(new Date('2026-11-14'));
    const { lunchMarks: _drop, ...old } = doc;
    void _drop;
    const result = parseBackup(JSON.stringify({ app: 'escala-5x2-clt', ...old }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.lunchMarks).toEqual([]);
  });
});
