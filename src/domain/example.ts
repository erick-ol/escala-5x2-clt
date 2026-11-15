import { localToday, sundayOnOrBefore } from './dates';
import { defaultRegime } from './legal';
import type { AppDocument, Employee, Minimum, StoreConfig, StoreDay } from './types';
import { DEFAULT_LUNCH_FROM, SCHEMA_VERSION } from './types';

const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Dia aberto de `opens` a `closes` (horas cheias). */
const day = (opens: number, closes: number, extra: Partial<StoreDay> = {}): StoreDay => ({
  open: true,
  opensAt: h(opens),
  closesAt: h(closes),
  singleShift: false,
  ...extra,
});
const closed: StoreDay = { open: false, opensAt: h(8), closesAt: h(18), singleShift: false };

/** Mínimo por dia da semana na ordem seg, ter, qua, qui, sex, sáb, dom (índices de `Weekday`). */
const min = (roleId: string, shiftId: string, perWeekday: number[]): Minimum => ({ roleId, shiftId, perWeekday });
const every = (n: number) => [n, n, n, n, n, n, n];

const person = (id: string, name: string, roleId: string, shiftId: string, isWoman: boolean, extra: Partial<Employee> = {}): Employee => ({
  id,
  name,
  roleId,
  shiftId,
  isWoman,
  ...extra,
});

function document(config: Omit<StoreConfig, 'lunchFrom'>, employees: Employee[], today: Date): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: { ...config, lunchFrom: DEFAULT_LUNCH_FROM },
    employees,
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: sundayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };
}

export interface ExampleInfo {
  id: string;
  /** Nome curto do botão (ex.: "Mercado"). */
  label: string;
  /** Uma linha sobre o exemplo, mostrada na tela inicial. */
  summary: string;
  build(today: Date): AppDocument;
}

/**
 * Mercado de bairro: seg–sáb 07:00–21:00, domingo só de manhã (08:00–12:00, turno único, sem intervalo).
 * Um caixa por turno; os repositores não têm mínimo e cobrem o caixa (segunda área) no almoço e nas folgas.
 */
function mercado(today: Date): AppDocument {
  return document(
    {
      name: 'Mercado do exemplo',
      days: [day(7, 21), day(7, 21), day(7, 21), day(7, 21), day(7, 21), day(7, 21), day(8, 12, { singleShift: true })],
      shifts: [
        { id: 'manha', name: 'Manhã', start: h(7), end: h(16), breakMinutes: 60 },
        { id: 'tarde', name: 'Tarde', start: h(12), end: h(21), breakMinutes: 60 },
      ],
      roles: [
        { id: 'caixa', name: 'Caixa' },
        { id: 'repositor', name: 'Repositor' },
      ],
      minimums: [
        min('caixa', 'manha', every(1)),
        min('repositor', 'manha', every(0)),
        min('caixa', 'tarde', every(1)),
        min('repositor', 'tarde', every(0)),
      ],
      regime: defaultRegime(today),
      offPattern: 'together',
    },
    [
      person('ana', 'Ana', 'caixa', 'manha', true),
      person('bruno', 'Bruno', 'caixa', 'manha', false),
      person('carla', 'Carla', 'caixa', 'tarde', true),
      person('diego', 'Diego', 'caixa', 'tarde', false),
      person('eduardo', 'Eduardo', 'repositor', 'manha', false, { secondaryRoleId: 'caixa' }),
      person('fabio', 'Fábio', 'repositor', 'tarde', false, { secondaryRoleId: 'caixa' }),
    ],
    today,
  );
}

/**
 * Loja de roupas em shopping: seg–sáb 10:00–22:00, domingo 14:00–18:00 em turno único (sem intervalo).
 * Abertura e fechamento, com mais vendedores no fechamento. Dois vendedores cobrem o caixa (segunda área) e
 * uma vendedora sem turno fixo cobre as folgas.
 */
function lojaDeRoupas(today: Date): AppDocument {
  return document(
    {
      name: 'Loja de roupas do exemplo',
      days: [day(10, 22), day(10, 22), day(10, 22), day(10, 22), day(10, 22), day(10, 22), day(14, 18, { singleShift: true })],
      shifts: [
        { id: 'abertura', name: 'Abertura', start: h(10), end: h(19), breakMinutes: 60 },
        { id: 'fechamento', name: 'Fechamento', start: h(13), end: h(22), breakMinutes: 60 },
      ],
      roles: [
        { id: 'vendedor', name: 'Vendedor(a)' },
        { id: 'caixa', name: 'Caixa' },
      ],
      minimums: [
        min('vendedor', 'abertura', every(1)),
        min('caixa', 'abertura', every(1)),
        min('vendedor', 'fechamento', [2, 2, 2, 2, 2, 2, 1]),
        min('caixa', 'fechamento', every(1)),
      ],
      regime: defaultRegime(today),
      offPattern: 'flexible',
    },
    [
      person('juliana', 'Juliana', 'vendedor', 'abertura', true, { secondaryRoleId: 'caixa' }),
      person('marcos', 'Marcos', 'vendedor', 'abertura', false),
      person('larissa', 'Larissa', 'caixa', 'abertura', true),
      person('patricia', 'Patrícia', 'vendedor', 'fechamento', true),
      person('renata', 'Renata', 'vendedor', 'fechamento', true),
      person('thiago', 'Thiago', 'vendedor', 'fechamento', false, { secondaryRoleId: 'caixa' }),
      person('gabriel', 'Gabriel', 'caixa', 'fechamento', false),
      person('camila', 'Camila', 'vendedor', 'fechamento', true, { floating: true }),
    ],
    today,
  );
}

/**
 * Padaria: todo dia 06:00–20:00. Os padeiros entram às 03:00 (horário próprio) e fazem o intervalo às 05:00,
 * antes de abrir; atendentes de manhã e à tarde, e uma atendente sem turno fixo cobre as folgas.
 */
function padaria(today: Date): AppDocument {
  const madrugada = { start: h(3), end: h(12), breakMinutes: 60, breakStart: h(5) };
  return document(
    {
      name: 'Padaria do exemplo',
      days: Array.from({ length: 7 }, () => day(6, 20)),
      shifts: [
        { id: 'manha', name: 'Manhã', start: h(6), end: h(15), breakMinutes: 60 },
        { id: 'tarde', name: 'Tarde', start: h(11), end: h(20), breakMinutes: 60 },
      ],
      roles: [
        { id: 'atendente', name: 'Atendente' },
        { id: 'padeiro', name: 'Padeiro(a)' },
      ],
      minimums: [
        min('atendente', 'manha', every(1)),
        min('padeiro', 'manha', every(1)),
        min('atendente', 'tarde', every(1)),
        min('padeiro', 'tarde', every(0)),
      ],
      regime: defaultRegime(today),
      offPattern: 'together',
    },
    [
      person('jose', 'José', 'padeiro', 'manha', false, { customHours: madrugada }),
      person('marcia', 'Márcia', 'padeiro', 'manha', true, { customHours: madrugada }),
      person('beatriz', 'Beatriz', 'atendente', 'manha', true),
      person('vinicius', 'Vinícius', 'atendente', 'manha', false),
      person('sandra', 'Sandra', 'atendente', 'tarde', true),
      person('rafael', 'Rafael', 'atendente', 'tarde', false),
      person('leticia', 'Letícia', 'atendente', 'manha', true, { floating: true }),
    ],
    today,
  );
}

/**
 * Farmácia: aberta todos os dias, 07:00–22:00, sem turno único. Sempre um farmacêutico e um balconista
 * por turno; um farmacêutico sem turno fixo cobre as folgas da manhã e da tarde.
 */
function farmacia(today: Date): AppDocument {
  return document(
    {
      name: 'Farmácia do exemplo',
      days: Array.from({ length: 7 }, () => day(7, 22)),
      shifts: [
        { id: 'manha', name: 'Manhã', start: h(7), end: h(16), breakMinutes: 60 },
        { id: 'tarde', name: 'Tarde', start: h(13), end: h(22), breakMinutes: 60 },
      ],
      roles: [
        { id: 'farmaceutico', name: 'Farmacêutico(a)' },
        { id: 'balconista', name: 'Balconista' },
      ],
      minimums: [
        min('farmaceutico', 'manha', every(1)),
        min('balconista', 'manha', every(1)),
        min('farmaceutico', 'tarde', every(1)),
        min('balconista', 'tarde', every(1)),
      ],
      regime: defaultRegime(today),
      offPattern: 'flexible',
    },
    [
      person('helena', 'Helena', 'farmaceutico', 'manha', true),
      person('roberto', 'Roberto', 'farmaceutico', 'tarde', false),
      person('otavio', 'Otávio', 'farmaceutico', 'tarde', false),
      person('marcio', 'Márcio', 'farmaceutico', 'manha', false, { floating: true }),
      person('igor', 'Igor', 'balconista', 'manha', false),
      person('natalia', 'Natália', 'balconista', 'manha', true),
      person('caio', 'Caio', 'balconista', 'tarde', false),
      person('priscila', 'Priscila', 'balconista', 'tarde', true),
    ],
    today,
  );
}

/**
 * Restaurante: fecha na segunda; terça a sábado 11:00–23:00, domingo só almoço (11:00–15:00, turno único).
 * Turno do dia (preparo e almoço) e da noite. Sábado é dia de movimento: ninguém folga (marca "Sem folga").
 */
function restaurante(today: Date): AppDocument {
  return document(
    {
      name: 'Restaurante do exemplo',
      days: [closed, day(11, 23), day(11, 23), day(11, 23), day(11, 23), day(11, 23, { noOff: true }), day(11, 15, { singleShift: true })],
      shifts: [
        { id: 'dia', name: 'Dia', start: h(10), end: h(19), breakMinutes: 60 },
        { id: 'noite', name: 'Noite', start: h(14), end: h(23), breakMinutes: 60 },
      ],
      roles: [
        { id: 'cozinha', name: 'Cozinha' },
        { id: 'salao', name: 'Garçom/Garçonete' },
      ],
      minimums: [
        min('cozinha', 'dia', [0, 1, 1, 1, 1, 1, 1]),
        min('salao', 'dia', [0, 1, 1, 1, 1, 1, 2]),
        min('cozinha', 'noite', [0, 1, 1, 1, 1, 1, 0]),
        min('salao', 'noite', [0, 1, 1, 1, 2, 2, 0]),
      ],
      regime: defaultRegime(today),
      offPattern: 'flexible',
    },
    [
      person('cristina', 'Cristina', 'cozinha', 'dia', true),
      person('wagner', 'Wagner', 'cozinha', 'dia', false),
      person('paulo', 'Paulo', 'cozinha', 'noite', false),
      person('aline', 'Aline', 'cozinha', 'noite', true),
      person('mateus', 'Mateus', 'salao', 'dia', false),
      person('bianca', 'Bianca', 'salao', 'dia', true),
      person('felipe', 'Felipe', 'salao', 'noite', false),
      person('tatiane', 'Tatiane', 'salao', 'noite', true),
      person('leandro', 'Leandro', 'salao', 'noite', false, { floating: true }),
    ],
    today,
  );
}

/** Exemplos da tela inicial, na ordem em que aparecem. O primeiro é o padrão (`exampleDocument`). */
export const EXAMPLES: readonly ExampleInfo[] = [
  { id: 'mercado', label: 'Mercado', summary: '6 pessoas · caixa e reposição · domingo só de manhã', build: mercado },
  { id: 'loja-de-roupas', label: 'Loja de roupas', summary: '8 pessoas · vendas e caixa · horário de shopping', build: lojaDeRoupas },
  { id: 'padaria', label: 'Padaria', summary: '7 pessoas · padeiros de madrugada e atendimento', build: padaria },
  { id: 'farmacia', label: 'Farmácia', summary: '8 pessoas · aberta todo dia, farmacêutico sempre presente', build: farmacia },
  { id: 'restaurante', label: 'Restaurante', summary: '9 pessoas · cozinha e salão · fecha na segunda', build: restaurante },
];

/** Exemplo pré-carregado (R7). Sem `id` (ou com um desconhecido), o mercado. */
export function exampleDocument(today: Date = new Date(), id: string = EXAMPLES[0].id): AppDocument {
  return (EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0]).build(today);
}

export function emptyDocument(today: Date = new Date()): AppDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: {
      name: '',
      days: Array.from({ length: 7 }, () => ({ open: true, opensAt: h(8), closesAt: h(18), singleShift: false })),
      shifts: [],
      roles: [],
      minimums: [],
      regime: defaultRegime(today),
      offPattern: 'together',
      lunchFrom: DEFAULT_LUNCH_FROM,
    },
    employees: [],
    schedule: null,
    marks: [],
    lunchMarks: [],
    calendar: { cycleStart: sundayOnOrBefore(localToday(today)), closedDates: [], dateOverrides: [] },
  };
}
