import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { emptyDocument, exampleDocument } from '../domain/example';
import {
  CYCLE_DAYS,
  type AppDocument,
  type Cell,
  type CoverageMark,
  type DateOverride,
  type ISODate,
  type LunchMark,
  type Employee,
  type Schedule,
  type StoreConfig,
} from '../domain/types';
import { reconcileDocument } from '../domain/reconcile';
import { weekdayOf } from '../domain/time';
import { isISODate, sundayOnOrBefore } from '../domain/dates';
import { parseDocument } from './schema';

export const STORAGE_KEY = 'escala-5x2-clt:v1';
/** Cópia do dado salvo que não pôde ser lido, preservada antes de qualquer nova gravação. */
export const UNREADABLE_KEY = `${STORAGE_KEY}:ilegivel`;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Devolve o storage se ele funciona de verdade (Safari privado, cookies bloqueados etc. lançam exceção). */
export function probeStorage(candidate: () => KeyValueStorage | undefined): KeyValueStorage | null {
  try {
    const storage = candidate();
    if (!storage) return null;
    const probe = '__escala_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export interface AppState {
  document: AppDocument;
  /** false quando nada está sendo salvo no aparelho (R19). */
  storageAvailable: boolean;
  /** true quando havia uma escala salva que não pôde ser lida (a cópia fica em UNREADABLE_KEY). */
  recoveredUnreadable: boolean;
  /** true quando já existe uma configuração salva (não é a primeira visita). */
  hasSavedData: boolean;
  lastBackupAt: string | null;

  replaceDocument(document: AppDocument): void;
  /** Carrega um dos exemplos da tela inicial (`EXAMPLES`); sem `id`, o mercado. */
  loadExample(id?: string): void;
  resetToEmpty(): void;
  updateConfig(patch: Partial<StoreConfig>): void;
  addEmployee(employee: Employee): void;
  updateEmployee(id: string, patch: Partial<Omit<Employee, 'id'>>): void;
  removeEmployee(id: string): void;
  setSchedule(schedule: Schedule | null): void;
  setRow(employeeId: string, cells: Cell[]): void;
  setCell(employeeId: string, day: number, cell: Cell): void;
  setMarks(marks: CoverageMark[]): void;
  setLunchMarks(lunchMarks: LunchMark[]): void;
  /** Visão Mês: domingo em que o ciclo começa (outra data é levada ao domingo anterior). */
  setCycleStart(date: ISODate): void;
  /** Visão Mês: loja fechada (feriado) só nesta data. */
  setClosedDate(date: ISODate, closed: boolean): void;
  /** Visão Mês: ajuste de uma pessoa só nesta data; null volta ao ciclo. */
  setDateOverride(date: ISODate, employeeId: string, cell: Cell | null): void;
  setDateOverrides(overrides: DateOverride[]): void;
  markBackupDone(when?: Date): void;
}

/** Linha padrão: trabalha em dias abertos, "loja fechada" nos demais. O gerador encaixa as folgas. */
export function defaultRow(config: StoreConfig): Cell[] {
  return Array.from({ length: CYCLE_DAYS }, (_, day) => ({
    status: config.days[weekdayOf(day)].open ? 'work' : 'closed',
  }));
}

function markInvolves(mark: CoverageMark, employeeId: string): boolean {
  return mark.coveredBy.kind === 'employee' && mark.coveredBy.employeeId === employeeId;
}

interface PersistedEnvelope {
  document: AppDocument;
  lastBackupAt: string | null;
}

export function createAppStore(storage: KeyValueStorage | null, now: () => Date = () => new Date()): StoreApi<AppState> {
  let initial: AppDocument = emptyDocument(now());
  let hasSavedData = false;
  let lastBackupAt: string | null = null;
  let recoveredUnreadable = false;

  const readEnvelope = (raw: string): { document: AppDocument; lastBackupAt: string | null } | null => {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedEnvelope>;
      const result = parseDocument(parsed.document);
      if (!result.ok) return null;
      return {
        document: reconcileDocument(result.document),
        lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
      };
    } catch {
      return null;
    }
  };

  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const envelope = readEnvelope(raw);
        if (envelope) {
          initial = envelope.document;
          hasSavedData = true;
          lastBackupAt = envelope.lastBackupAt;
        } else {
          // Dado ilegível: guarda uma cópia antes que a próxima gravação o substitua.
          storage.setItem(UNREADABLE_KEY, raw);
          recoveredUnreadable = true;
        }
      }
    } catch {
      // Sem acesso ao dado salvo: começa vazio.
    }
  }

  let remoteUpdate = false;
  const store = createStore<AppState>()((set, get) => {
    const setDocument = (next: AppDocument) => set({ document: next, hasSavedData: true });
    const doc = () => get().document;

    return {
      document: initial,
      storageAvailable: storage !== null,
      hasSavedData,
      lastBackupAt,
      recoveredUnreadable,

      replaceDocument: (document) => setDocument(reconcileDocument(document)),
      loadExample: (id) => setDocument(exampleDocument(now(), id)),
      resetToEmpty: () => set({ document: emptyDocument(now()), hasSavedData: false }),

      updateConfig: (patch) => setDocument({ ...doc(), config: { ...doc().config, ...patch } }),

      addEmployee: (employee) => {
        const d = doc();
        const schedule = d.schedule ? { ...d.schedule, [employee.id]: defaultRow(d.config) } : null;
        setDocument({ ...d, employees: [...d.employees, employee], schedule });
      },

      updateEmployee: (id, patch) => {
        const d = doc();
        setDocument({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
      },

      removeEmployee: (id) => {
        const d = doc();
        let schedule = d.schedule;
        if (schedule) {
          schedule = { ...schedule };
          delete schedule[id];
        }
        setDocument({
          ...d,
          employees: d.employees.filter((e) => e.id !== id),
          schedule,
          marks: d.marks.filter((m) => !markInvolves(m, id)),
          calendar: { ...d.calendar, dateOverrides: d.calendar.dateOverrides.filter((o) => o.employeeId !== id) },
        });
      },

      setSchedule: (schedule) =>
        setDocument({
          ...doc(),
          schedule,
          marks: schedule ? doc().marks : [],
          lunchMarks: schedule ? doc().lunchMarks : [],
        }),

      setRow: (employeeId, cells) => {
        const d = doc();
        if (!d.schedule) return;
        setDocument({ ...d, schedule: { ...d.schedule, [employeeId]: cells } });
      },

      setCell: (employeeId, day, cell) => {
        const d = doc();
        const row = d.schedule?.[employeeId];
        if (!d.schedule || !row) return;
        const nextRow = row.slice();
        nextRow[day] = cell;
        setDocument({ ...d, schedule: { ...d.schedule, [employeeId]: nextRow } });
      },

      setMarks: (marks) => setDocument({ ...doc(), marks }),
      setLunchMarks: (lunchMarks) => setDocument({ ...doc(), lunchMarks }),

      setCycleStart: (date) => {
        if (!isISODate(date)) return;
        const d = doc();
        const cycleStart = sundayOnOrBefore(date);
        if (cycleStart === d.calendar.cycleStart) return;
        setDocument({ ...d, calendar: { ...d.calendar, cycleStart } });
      },

      setClosedDate: (date, closed) => {
        if (!isISODate(date)) return;
        const d = doc();
        const others = d.calendar.closedDates.filter((x) => x !== date);
        const closedDates = closed ? [...others, date].sort() : others;
        setDocument({ ...d, calendar: { ...d.calendar, closedDates } });
      },

      setDateOverride: (date, employeeId, cell) => {
        const d = doc();
        const others = d.calendar.dateOverrides.filter((o) => !(o.date === date && o.employeeId === employeeId));
        const dateOverrides = cell ? [...others, { date, employeeId, cell }] : others;
        setDocument({ ...d, calendar: { ...d.calendar, dateOverrides } });
      },

      setDateOverrides: (dateOverrides) => {
        const d = doc();
        setDocument({ ...d, calendar: { ...d.calendar, dateOverrides } });
      },

      markBackupDone: (when) => set({ lastBackupAt: (when ?? now()).toISOString() }),
    };
  });

  if (storage) {
    store.subscribe((state, prev) => {
      if (remoteUpdate) return;
      if (state.document === prev.document && state.lastBackupAt === prev.lastBackupAt) return;
      try {
        if (!state.hasSavedData) {
          storage.removeItem(STORAGE_KEY);
          return;
        }
        const envelope: PersistedEnvelope = { document: state.document, lastBackupAt: state.lastBackupAt };
        storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      } catch {
        store.setState({ storageAvailable: false });
      }
    });
  }

  // Outra aba gravou: recarrega sem gravar de volta, para uma aba não apagar a edição da outra.
  if (storage && typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      const envelope = readEnvelope(event.newValue);
      if (!envelope) return;
      remoteUpdate = true;
      try {
        store.setState({ document: envelope.document, lastBackupAt: envelope.lastBackupAt, hasSavedData: true });
      } finally {
        remoteUpdate = false;
      }
    });
  }

  return store;
}

/** Pede ao navegador para não apagar os dados do site (KTD10). Sem efeito onde não há suporte. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignorado
  }
  return false;
}

export const appStore = createAppStore(
  probeStorage(() => (typeof window !== 'undefined' ? window.localStorage : undefined)),
);

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
