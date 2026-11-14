import { weekdayOfDate } from '../domain/dates';
import { exampleDocument } from '../domain/example';
import { generateSchedule } from '../domain/generator';
import { weekdayOf } from '../domain/time';
import type { AppDocument, Cell } from '../domain/types';
import { backupFileName, parseBackup, serializeBackup } from './backup';
import { parseDocument } from './schema';

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

describe('documento antigo sem "Almoço a partir de"', () => {
  test('lê com 11:30', () => {
    const doc = exampleDocument(new Date('2026-11-14'));
    const { lunchFrom: _drop, ...config } = doc.config;
    void _drop;
    const result = parseBackup(JSON.stringify({ app: 'escala-5x2-clt', ...doc, config }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.config.lunchFrom).toBe(11 * 60 + 30);
  });

  test('mantém o horário gravado', () => {
    const doc = exampleDocument(new Date('2026-11-14'));
    const result = parseBackup(JSON.stringify({ app: 'escala-5x2-clt', ...doc, config: { ...doc.config, lunchFrom: 12 * 60 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.config.lunchFrom).toBe(12 * 60);
  });
});

describe('documento da versão 1 (semana de segunda a domingo)', () => {
  /** Weekday (0 = segunda … 6 = domingo) de um dia do ciclo na versão 1, em que o dia 0 era uma segunda. */
  const v1Weekday = (day: number) => day % 7;

  /** Um documento v1: linhas com o dia da semana gravado no ajuste de horário, para conferir após a conversão. */
  function v1Document() {
    const doc = exampleDocument(new Date('2026-11-14'));
    const schedule = generateSchedule({ config: doc.config, employees: doc.employees });
    const tagged: Record<string, Cell[]> = {};
    for (const [id, row] of Object.entries(schedule)) {
      // Marca cada célula com o índice antigo (no intervalo) para saber de onde ela veio.
      tagged[id] = row.map((c, i) => (c.status === 'work' ? { ...c, hours: { start: 480, end: 1020, breakMinutes: i } } : c));
    }
    return {
      ...doc,
      schemaVersion: 1,
      schedule: tagged,
      marks: [{ day: 0, shiftId: 'manha', roleId: 'caixa', slot: 0, coveredBy: { kind: 'owner' } }, { day: 20, shiftId: '__dia6', roleId: 'caixa', slot: 0, coveredBy: { kind: 'owner' } }],
      lunchMarks: [{ day: 6, roleId: 'caixa', from: 600, to: 660 }],
      calendar: { cycleStart: '2026-11-30', closedDates: ['2026-12-25'], dateOverrides: [{ date: '2026-12-02', employeeId: 'rosa', cell: { status: 'off' } }] },
    };
  }

  test('cada célula mantém o dia da semana; marcações andam junto e o ciclo começa no domingo anterior', () => {
    const old = v1Document();
    const result = parseBackup(JSON.stringify({ app: 'escala-5x2-clt', ...old }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc: AppDocument = result.document;
    expect(doc.schemaVersion).toBe(2);
    for (const [id, row] of Object.entries(doc.schedule!)) {
      const oldRow = old.schedule[id];
      row.forEach((cell, day) => {
        const from = (day + 20) % 21;
        expect(cell).toEqual(oldRow[from]);
        expect(weekdayOf(day)).toBe(v1Weekday(from));
      });
    }
    // Dia 0 (segunda da semana 1) vira o dia 1; dia 20 (domingo da semana 3) vira o dia 0.
    expect(doc.marks.map((m) => m.day)).toEqual([1, 0]);
    expect(doc.lunchMarks.map((m) => m.day)).toEqual([7]);
    expect(doc.calendar.cycleStart).toBe('2026-11-29');
    expect(weekdayOfDate(doc.calendar.cycleStart)).toBe(6);
    // Datas reais não mudam.
    expect(doc.calendar.closedDates).toEqual(['2026-12-25']);
    expect(doc.calendar.dateOverrides).toEqual(old.calendar.dateOverrides);
  });

  test('cada data real continua com a mesma célula do ciclo', () => {
    const old = v1Document();
    const result = parseDocument(JSON.parse(JSON.stringify(old)));
    if (!result.ok) throw new Error(result.error);
    const doc = result.document;
    for (let n = 0; n < 42; n++) {
      // Data n dias depois da segunda 30/11/2026: no v1 era o dia n % 21; no v2, (n + 1) % 21 a partir de 29/11.
      for (const id of Object.keys(old.schedule)) expect(doc.schedule![id][(n + 1) % 21]).toEqual(old.schedule[id][n % 21]);
    }
  });

  test('início do ciclo fora de segunda (v1 o levava à segunda anterior) vai para o domingo antes dela', () => {
    const old = { ...v1Document(), calendar: { cycleStart: '2026-12-03', closedDates: [], dateOverrides: [] } };
    const result = parseDocument(JSON.parse(JSON.stringify(old)));
    expect(result.ok && result.document.calendar.cycleStart).toBe('2026-11-29');
  });

  test('documento v1 sem calendário nem escala também é lido', () => {
    const { calendar: _c, ...old } = { ...v1Document(), schedule: null };
    void _c;
    const result = parseDocument(JSON.parse(JSON.stringify(old)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(weekdayOfDate(result.document.calendar.cycleStart)).toBe(6);
  });
});
