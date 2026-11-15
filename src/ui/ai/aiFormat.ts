import { localToday, sundayOnOrBefore } from '../../domain/dates';
import { defaultRegime } from '../../domain/legal';
import { defaultBreakFor } from '../../domain/time';
import {
  DEFAULT_LUNCH_FROM,
  SCHEMA_VERSION,
  type AppDocument,
  type Employee,
  type Minimum,
  type Role,
  type Shift,
  type StoreDay,
  type Weekday,
  type WorkHours,
} from '../../domain/types';
import { BACKUP_APP_ID, parseBackup } from '../../state/backup';
import { STEP_VALIDATORS, slugId } from '../setup/setupLogic';

/**
 * Formato "para IA": o texto que o ChatGPT, o Claude etc. devolvem para ser importado.
 * Pensado para ser fácil de a IA acertar: horários "HH:MM", dias pelo nome, turnos e funções ligados pelo nome.
 * O site converte para o documento interno e gera a escala com as regras (a IA não escreve a escala em si).
 */
export const AI_FORMAT_ID = 'escala-5x2-ia';
export const AI_FORMAT_VERSION = 1;

export type AiImportResult =
  | { ok: true; document: AppDocument; source: 'ia' | 'backup'; warnings: string[] }
  | { ok: false; errors: string[] };

/** Chaves aceitas para os dias (sem acento e sem "-feira"), na ordem de `Weekday` (0 = segunda … 6 = domingo). */
const DAY_KEYS: Record<string, Weekday> = {
  segunda: 0,
  terca: 1,
  quarta: 2,
  quinta: 3,
  sexta: 4,
  sabado: 5,
  domingo: 6,
};
const DAY_LABEL = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const;

const MAX_ERRORS = 8;

/** "Manhã" e "manha" viram a mesma chave. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dia da semana pelo nome ("Sábado", "segunda-feira", "terca"), ou undefined. */
function dayKey(text: string): Weekday | undefined {
  return DAY_KEYS[normalizeName(text).replace(/ feira$/, '')];
}

/** "7:30", "07:30", "7h30", "7h" → minutos desde 00:00. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*h?$/i.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Objeto `{ ... }` que começa em `start`, com as chaves balanceadas (ignorando as que estão dentro de textos). */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Tira o JSON do meio do texto colado: a IA costuma pôr explicação antes e depois e a cerca ```json.
 * Tenta primeiro os blocos ```json; depois, cada objeto `{ ... }` do texto, na ordem. Devolve o primeiro que for válido.
 */
export function extractJson(text: string): unknown {
  // Aspas “curvas” que alguns apps põem ao copiar.
  const clean = text.replace(/[“”]/g, '"');
  const candidates: string[] = [];
  for (const m of clean.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)) candidates.push(m[1]);
  for (let i = clean.indexOf('{'); i !== -1; i = clean.indexOf('{', i + 1)) {
    const obj = balancedObject(clean, i);
    if (obj) {
      candidates.push(obj);
      i += obj.length - 1;
    }
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isRecord(value)) return value;
    } catch {
      // Tenta o próximo.
    }
  }
  throw new Error('sem json');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class Collector {
  errors: string[] = [];
  warnings: string[] = [];
  error(message: string) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(message);
  }
}

function readTime(value: unknown, where: string, c: Collector): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    c.error(`${where}: informe o horário como "HH:MM" (ex.: "07:30").`);
    return null;
  }
  const t = parseClock(value);
  if (t === null) c.error(`${where}: "${value}" não é um horário válido (use "HH:MM", ex.: "07:30").`);
  return t;
}

function readBreak(value: unknown, start: number, end: number, where: string, c: Collector): number {
  if (value === undefined || value === null) return defaultBreakFor(start, end);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 240) {
    c.error(`${where}: "intervaloMin" deve ser um número de minutos entre 0 e 240.`);
    return 0;
  }
  return value;
}

function readBool(value: unknown, where: string, c: Collector): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  c.error(`${where}: use true ou false.`);
  return false;
}

function readName(value: unknown, where: string, c: Collector): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    c.error(`${where}: falta o "nome".`);
    return null;
  }
  return value.trim();
}

function readDays(value: unknown, c: Collector): StoreDay[] {
  const closed = (): StoreDay => ({ open: false, opensAt: 8 * 60, closesAt: 18 * 60, singleShift: false });
  const days: StoreDay[] = Array.from({ length: 7 }, closed);
  if (!isRecord(value)) {
    c.error('"funcionamento": informe os dias e horários em que o negócio abre (ex.: "segunda": { "abre": "08:00", "fecha": "18:00" }).');
    return days;
  }
  for (const [key, raw] of Object.entries(value)) {
    const weekday = dayKey(key);
    if (weekday === undefined) {
      c.error(`"funcionamento": "${key}" não é um dia da semana (use domingo, segunda, terca, quarta, quinta, sexta, sabado).`);
      continue;
    }
    if (raw === null || raw === false || (typeof raw === 'string' && normalizeName(raw) === 'fechado')) continue;
    const where = `Funcionamento (${DAY_LABEL[weekday]})`;
    if (!isRecord(raw)) {
      c.error(`${where}: use { "abre": "HH:MM", "fecha": "HH:MM" } ou null para fechado.`);
      continue;
    }
    if (raw.fechado === true) continue;
    const opensAt = readTime(raw.abre, `${where}, "abre"`, c);
    const closesAt = readTime(raw.fecha, `${where}, "fecha"`, c);
    const day: StoreDay = {
      open: true,
      opensAt: opensAt ?? 8 * 60,
      closesAt: closesAt ?? 18 * 60,
      singleShift: readBool(raw.turnoUnico, `${where}, "turnoUnico"`, c),
    };
    if (readBool(raw.semFolga, `${where}, "semFolga"`, c)) {
      if (weekday === 6) c.warnings.push('Domingo não pode ser "sem folga" (a lei exige folga em alguns domingos): a marca foi ignorada.');
      else day.noOff = true;
    }
    days[weekday] = day;
  }
  return days;
}

function readShifts(value: unknown, c: Collector): Shift[] {
  if (!Array.isArray(value) || value.length === 0) {
    c.error('"turnos": cadastre de 1 a 3 turnos (ex.: { "nome": "Manhã", "entrada": "07:00", "saida": "15:20" }).');
    return [];
  }
  if (value.length > 3) c.error('"turnos": use no máximo 3 turnos.');
  const shifts: Shift[] = [];
  value.slice(0, 3).forEach((raw, i) => {
    const where = `Turno ${i + 1}`;
    if (!isRecord(raw)) {
      c.error(`${where}: formato inválido.`);
      return;
    }
    const name = readName(raw.nome, where, c);
    if (!name) return;
    const label = `Turno "${name}"`;
    if (shifts.some((s) => normalizeName(s.name) === normalizeName(name))) {
      c.error(`${label}: há dois turnos com esse nome.`);
      return;
    }
    const start = readTime(raw.entrada, `${label}, "entrada"`, c);
    const end = readTime(raw.saida, `${label}, "saida"`, c);
    if (start === null || end === null) return;
    shifts.push({
      id: slugId(name, shifts.map((s) => s.id), 'turno'),
      name,
      start,
      end,
      breakMinutes: readBreak(raw.intervaloMin, start, end, label, c),
    });
  });
  return shifts;
}

function findBy<T extends { name: string }>(list: T[], name: unknown): T | undefined {
  if (typeof name !== 'string') return undefined;
  const key = normalizeName(name);
  return list.find((item) => normalizeName(item.name) === key);
}

/** Mínimo de um turno: um número (todos os dias) ou { "padrao": 1, "domingo": 0, ... }. */
function readPerWeekday(value: unknown, where: string, c: Collector): number[] | null {
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 50;
  if (isCount(value)) return Array.from({ length: 7 }, () => value);
  if (!isRecord(value)) {
    c.error(`${where}: use um número (ex.: 1) ou { "padrao": 1, "domingo": 0 }.`);
    return null;
  }
  const base = value.padrao ?? 0;
  if (!isCount(base)) {
    c.error(`${where}: "padrao" deve ser um número inteiro (0 ou mais).`);
    return null;
  }
  const per = Array.from({ length: 7 }, () => base);
  for (const [key, n] of Object.entries(value)) {
    if (normalizeName(key) === 'padrao') continue;
    const weekday = dayKey(key);
    if (weekday === undefined) {
      c.error(`${where}: "${key}" não é um dia da semana.`);
      continue;
    }
    if (!isCount(n)) {
      c.error(`${where}, ${DAY_LABEL[weekday]}: use um número inteiro (0 ou mais).`);
      continue;
    }
    per[weekday] = n;
  }
  return per;
}

function readRoles(value: unknown, shifts: Shift[], c: Collector): { roles: Role[]; minimums: Minimum[] } {
  const roles: Role[] = [];
  const minimums: Minimum[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    c.error('"funcoes": cadastre pelo menos uma função (ex.: { "nome": "Caixa", "minimo": { "Manhã": 1 } }).');
    return { roles, minimums };
  }
  value.forEach((raw, i) => {
    const where = `Função ${i + 1}`;
    if (!isRecord(raw)) {
      c.error(`${where}: formato inválido.`);
      return;
    }
    const name = readName(raw.nome, where, c);
    if (!name) return;
    const label = `Função "${name}"`;
    if (findBy(roles, name)) {
      c.error(`${label}: há duas funções com esse nome.`);
      return;
    }
    const role: Role = { id: slugId(name, roles.map((r) => r.id), 'funcao'), name };
    roles.push(role);
    const perShift = new Map<string, number[]>();
    if (raw.minimo !== undefined && raw.minimo !== null) {
      if (typeof raw.minimo === 'number' && shifts.length === 1) {
        // Atalho com um turno só: "minimo": 2.
        const per = readPerWeekday(raw.minimo, `${label}, mínimo`, c);
        if (per) perShift.set(shifts[0].id, per);
      } else if (!isRecord(raw.minimo)) {
        c.error(`${label}: "minimo" deve dizer quantas pessoas por turno (ex.: { "Manhã": 1, "Tarde": 2 }).`);
      } else {
        for (const [shiftName, count] of Object.entries(raw.minimo)) {
          const shift = findBy(shifts, shiftName);
          if (!shift) {
            c.error(`${label}: o turno "${shiftName}" do mínimo não existe em "turnos".`);
            continue;
          }
          const per = readPerWeekday(count, `${label}, mínimo no turno ${shift.name}`, c);
          if (per) perShift.set(shift.id, per);
        }
      }
    }
    for (const shift of shifts) {
      minimums.push({ roleId: role.id, shiftId: shift.id, perWeekday: perShift.get(shift.id) ?? [0, 0, 0, 0, 0, 0, 0] });
    }
  });
  return { roles, minimums };
}

function readTeam(value: unknown, shifts: Shift[], roles: Role[], c: Collector): Employee[] {
  const team: Employee[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    c.error('"equipe": cadastre pelo menos uma pessoa (ex.: { "nome": "Ana", "funcao": "Caixa", "turno": "Manhã" }).');
    return team;
  }
  value.forEach((raw, i) => {
    const where = `Pessoa ${i + 1}`;
    if (!isRecord(raw)) {
      c.error(`${where}: formato inválido.`);
      return;
    }
    const name = readName(raw.nome, where, c);
    if (!name) return;
    const role = findBy(roles, raw.funcao);
    if (!role) {
      c.error(
        typeof raw.funcao === 'string'
          ? `${name}: a função "${raw.funcao}" não existe em "funcoes".`
          : `${name}: falta a "funcao" da pessoa.`,
      );
      return;
    }
    const floating = readBool(raw.semTurnoFixo, `${name}, "semTurnoFixo"`, c);
    let shift = findBy(shifts, raw.turno);
    if (!shift && (floating || shifts.length === 1) && (raw.turno === undefined || raw.turno === null)) shift = shifts[0];
    if (!shift) {
      c.error(
        typeof raw.turno === 'string'
          ? `${name}: o turno "${raw.turno}" não existe em "turnos".`
          : `${name}: falta o "turno" da pessoa.`,
      );
      return;
    }
    const employee: Employee = {
      id: slugId(name, team.map((e) => e.id), 'pessoa'),
      name,
      roleId: role.id,
      shiftId: shift.id,
      isWoman: readBool(raw.mulher, `${name}, "mulher"`, c),
    };
    if (raw.segundaFuncao !== undefined && raw.segundaFuncao !== null && raw.segundaFuncao !== '') {
      const second = findBy(roles, raw.segundaFuncao);
      if (!second) c.error(`${name}: a segunda função "${String(raw.segundaFuncao)}" não existe em "funcoes".`);
      else if (second.id !== role.id) employee.secondaryRoleId = second.id;
    }
    if (floating) {
      if (shifts.length > 1) employee.floating = true;
    }
    if (raw.entrada !== undefined || raw.saida !== undefined) {
      const start = readTime(raw.entrada, `${name}, "entrada"`, c);
      const end = readTime(raw.saida, `${name}, "saida"`, c);
      if (start !== null && end !== null) {
        const hours: WorkHours = { start, end, breakMinutes: readBreak(raw.intervaloMin, start, end, name, c) };
        employee.customHours = hours;
      }
    }
    team.push(employee);
  });
  return team;
}

/** Converte o objeto no formato da IA para o documento do site. Não gera a escala (o site faz isso depois). */
export function fromAiFormat(raw: Record<string, unknown>, today: Date = new Date()): AiImportResult {
  const c = new Collector();

  let regime = defaultRegime(today);
  if (raw.regime !== undefined && raw.regime !== null) {
    const r = String(raw.regime).replace(/\s/g, '').toLowerCase();
    if (r === '42h' || r === '42') regime = '42h';
    else if (r === '40h' || r === '40') regime = '40h';
    else c.error('"regime": use "42h" ou "40h".');
  }

  let offPattern: 'together' | 'flexible' = 'together';
  if (raw.folgas !== undefined && raw.folgas !== null) {
    const f = normalizeName(String(raw.folgas));
    if (f === 'separadas') offPattern = 'flexible';
    else if (f !== 'juntas') c.error('"folgas": use "juntas" ou "separadas".');
  }

  let lunchFrom = DEFAULT_LUNCH_FROM;
  if (raw.almocoAPartirDe !== undefined && raw.almocoAPartirDe !== null) {
    lunchFrom = readTime(raw.almocoAPartirDe, '"almocoAPartirDe"', c) ?? DEFAULT_LUNCH_FROM;
  }

  const days = readDays(raw.funcionamento, c);
  const shifts = readShifts(raw.turnos, c);
  const { roles, minimums } = readRoles(raw.funcoes, shifts, c);
  const employees = readTeam(raw.equipe, shifts, roles, c);

  const document: AppDocument = {
    schemaVersion: SCHEMA_VERSION,
    config: {
      name: typeof raw.negocio === 'string' ? raw.negocio.trim() : '',
      days,
      shifts,
      roles,
      minimums,
      regime,
      offPattern,
      lunchFrom,
    },
    employees,
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: sundayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };

  // As mesmas checagens dos quatro passos da configuração (só se a leitura em si deu certo).
  if (c.errors.length === 0) {
    for (const validate of STEP_VALIDATORS) {
      const problem = validate(document);
      if (problem) c.error(problem);
    }
  }

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, document, source: 'ia', warnings: c.warnings };
}

/**
 * Lê o texto colado: o código da IA (formato acima) ou um backup do próprio site.
 * Erros vêm em português, prontos para mostrar (e para devolver à IA corrigir).
 */
export function parseAiImport(text: string, today: Date = new Date()): AiImportResult {
  if (!text.trim()) return { ok: false, errors: ['Cole aqui o código que a IA entregou.'] };
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return {
      ok: false,
      errors: ['Não encontrei um código válido no texto colado. Copie o código inteiro que a IA entregou, do primeiro { ao último }.'],
    };
  }
  if (!isRecord(raw)) return { ok: false, errors: ['O código colado não está no formato esperado.'] };

  if (raw.app === BACKUP_APP_ID) {
    const backup = parseBackup(JSON.stringify(raw));
    return backup.ok ? { ok: true, document: backup.document, source: 'backup', warnings: [] } : { ok: false, errors: [backup.error] };
  }

  const looksLikeOurs = raw.formato === AI_FORMAT_ID || 'funcionamento' in raw || 'equipe' in raw;
  if (!looksLikeOurs) {
    return {
      ok: false,
      errors: ['Este código não parece ser da escala. Use o texto do botão "Copiar texto para a IA" para a IA entregar no formato certo.'],
    };
  }
  return fromAiFormat(raw, today);
}
