import type { AppDocument } from '../domain/types';
import { parseDocument, type ParseResult } from './schema';

export const BACKUP_APP_ID = 'escala-5x2-clt';

export function serializeBackup(document: AppDocument): string {
  return JSON.stringify({ app: BACKUP_APP_ID, ...document }, null, 2);
}

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um backup válido da escala.' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== BACKUP_APP_ID) {
    return { ok: false, error: 'O arquivo não é um backup válido da escala.' };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { app, ...rest } = raw as Record<string, unknown>;
  return parseDocument(rest);
}

export function backupFileName(document: AppDocument, today: Date = new Date()): string {
  const slug =
    document.config.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'escala';
  return `backup-${slug}-${today.toISOString().slice(0, 10)}.json`;
}
