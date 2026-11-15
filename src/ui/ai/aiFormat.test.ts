import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../domain/example';
import { generateSchedule } from '../../domain/generator';
import { serializeBackup } from '../../state/backup';
import { AI_FORMAT_ID, parseAiImport, parseClock } from './aiFormat';
import { buildAiPrompt } from './aiPrompt';

const TODAY = new Date(2026, 10, 14);

const padaria = {
  formato: AI_FORMAT_ID,
  versao: 1,
  negocio: 'Padaria Pão Quente',
  regime: '42h',
  folgas: 'separadas',
  funcionamento: {
    domingo: { abre: '07:00', fecha: '13:00', turnoUnico: true },
    'segunda-feira': { abre: '06:00', fecha: '20:00' },
    terca: { abre: '06:00', fecha: '20:00' },
    Quarta: { abre: '06:00', fecha: '20:00' },
    quinta: { abre: '06:00', fecha: '20:00' },
    sexta: { abre: '06:00', fecha: '20:00' },
    sábado: { abre: '06:00', fecha: '20:00', semFolga: true },
  },
  turnos: [
    { nome: 'Manhã', entrada: '06:00', saida: '14:20', intervaloMin: 60 },
    { nome: 'Tarde', entrada: '11:40', saida: '20:00' },
  ],
  funcoes: [
    { nome: 'Atendente', minimo: { manha: 1, Tarde: { padrao: 2, segunda: 1 } } },
    { nome: 'Padeiro', minimo: { Manhã: 1 } },
  ],
  equipe: [
    { nome: 'Rosa', funcao: 'padeiro', turno: 'Manhã', mulher: true, entrada: '05:45', saida: '14:05' },
    { nome: 'João', funcao: 'Padeiro', turno: 'Manhã', mulher: false },
    { nome: 'Ana', funcao: 'Atendente', turno: 'Manhã', mulher: true, segundaFuncao: 'Padeiro' },
    { nome: 'Bia', funcao: 'Atendente', turno: 'Tarde', mulher: true },
    { nome: 'Caio', funcao: 'Atendente', turno: 'Tarde', mulher: false },
    { nome: 'Duda', funcao: 'Atendente', semTurnoFixo: true, mulher: true },
  ],
};

describe('parseClock', () => {
  it('aceita os jeitos comuns de escrever hora', () => {
    expect(parseClock('07:30')).toBe(450);
    expect(parseClock('7:30')).toBe(450);
    expect(parseClock('7h30')).toBe(450);
    expect(parseClock('7h')).toBe(420);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('manhã')).toBeNull();
  });
});

describe('parseAiImport', () => {
  it('converte o formato da IA num documento que o gerador aceita', () => {
    const result = parseAiImport(JSON.stringify(padaria), TODAY);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const { config, employees } = result.document;

    expect(result.source).toBe('ia');
    expect(config.name).toBe('Padaria Pão Quente');
    expect(config.offPattern).toBe('flexible');
    // Weekday: 0 = segunda … 6 = domingo.
    expect(config.days[6]).toMatchObject({ open: true, opensAt: 420, closesAt: 780, singleShift: true });
    expect(config.days[5].noOff).toBe(true);
    expect(config.shifts.map((s) => s.id)).toEqual(['manha', 'tarde']);
    // Intervalo ausente: o padrão pela jornada.
    expect(config.shifts[1].breakMinutes).toBe(60);
    // Mínimo com "padrao" e exceção por dia; turno sem mínimo vira zero.
    const tarde = config.minimums.find((m) => m.roleId === 'atendente' && m.shiftId === 'tarde');
    expect(tarde?.perWeekday).toEqual([1, 2, 2, 2, 2, 2, 2]);
    const padeiroTarde = config.minimums.find((m) => m.roleId === 'padeiro' && m.shiftId === 'tarde');
    expect(padeiroTarde?.perWeekday).toEqual([0, 0, 0, 0, 0, 0, 0]);

    const rosa = employees.find((e) => e.name === 'Rosa');
    expect(rosa).toMatchObject({ roleId: 'padeiro', isWoman: true, customHours: { start: 345, end: 845, breakMinutes: 60 } });
    expect(employees.find((e) => e.name === 'Ana')?.secondaryRoleId).toBe('padeiro');
    expect(employees.find((e) => e.name === 'Duda')).toMatchObject({ floating: true, shiftId: 'manha' });

    const schedule = generateSchedule({ config, employees });
    expect(Object.keys(schedule)).toHaveLength(employees.length);
  });

  it('acha o código no meio da conversa colada, com cerca ```json', () => {
    const text = `Pronto! Aqui está:\n\n\`\`\`json\n${JSON.stringify(padaria, null, 2)}\n\`\`\`\n\nCopie e cole no site.`;
    expect(parseAiImport(text, TODAY).ok).toBe(true);
  });

  it('explica em português o que está errado', () => {
    const broken = {
      ...padaria,
      equipe: [{ nome: 'Rosa', funcao: 'Confeiteira', turno: 'Manhã' }, { nome: 'Leo', funcao: 'Padeiro', turno: 'Madrugada' }],
    };
    const result = parseAiImport(JSON.stringify(broken), TODAY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('Rosa: a função "Confeiteira" não existe em "funcoes".');
    expect(result.errors).toContain('Leo: o turno "Madrugada" não existe em "turnos".');
  });

  it('roda as checagens da configuração (ex.: fechamento antes da abertura)', () => {
    const broken = { ...padaria, funcionamento: { ...padaria.funcionamento, terca: { abre: '20:00', fecha: '06:00' } } };
    const result = parseAiImport(JSON.stringify(broken), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Terça: o fechamento precisa ser depois da abertura/);
  });

  it('aceita também um backup do próprio site', () => {
    const result = parseAiImport(serializeBackup(exampleDocument(TODAY)), TODAY);
    expect(result.ok && result.source).toBe('backup');
  });

  it('o exemplo do texto para a IA importa sem erro (prompt e formato andam juntos)', () => {
    const result = parseAiImport(buildAiPrompt(TODAY), TODAY);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.document.employees).toHaveLength(5);
  });

  it('recusa texto sem código ou de outro formato', () => {
    expect(parseAiImport('oi, tudo bem?', TODAY).ok).toBe(false);
    expect(parseAiImport('{"nome": "x"}', TODAY).ok).toBe(false);
  });
});
