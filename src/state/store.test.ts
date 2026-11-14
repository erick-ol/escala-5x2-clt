import { exampleDocument } from '../domain/example';
import { CYCLE_DAYS } from '../domain/types';
import { createAppStore, defaultRow, probeStorage, STORAGE_KEY, type KeyValueStorage } from './store';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const now = () => new Date('2026-11-14');

describe('store', () => {
  test('salva e recarrega o documento', () => {
    const storage = memoryStorage();
    const a = createAppStore(storage, now);
    a.getState().loadExample();
    const b = createAppStore(storage, now);
    expect(b.getState().document.employees).toHaveLength(6);
    expect(b.getState().hasSavedData).toBe(true);
  });

  test('primeira visita não tem dados salvos', () => {
    const s = createAppStore(memoryStorage(), now);
    expect(s.getState().hasSavedData).toBe(false);
    expect(s.getState().storageAvailable).toBe(true);
  });

  test('localStorage que lança exceção sinaliza armazenamento indisponível e segue em memória', () => {
    const broken = probeStorage(() => ({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    }));
    expect(broken).toBeNull();
    const s = createAppStore(broken, now);
    expect(s.getState().storageAvailable).toBe(false);
    s.getState().loadExample();
    expect(s.getState().document.employees).toHaveLength(6);
  });

  test('falha ao gravar depois marca o armazenamento como indisponível', () => {
    const storage = memoryStorage();
    const s = createAppStore(storage, now);
    storage.setItem = () => {
      throw new Error('quota');
    };
    s.getState().loadExample();
    expect(s.getState().storageAvailable).toBe(false);
  });

  test('dado salvo corrompido é ignorado', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{"document": {"schemaVersion": 1}}');
    const s = createAppStore(storage, now);
    expect(s.getState().hasSavedData).toBe(false);
  });

  test('remover funcionário apaga a linha e as marcações "coberto por" dele', () => {
    const s = createAppStore(memoryStorage(), now);
    s.getState().loadExample();
    const doc = s.getState().document;
    const schedule = Object.fromEntries(doc.employees.map((e) => [e.id, defaultRow(doc.config)]));
    s.getState().setSchedule(schedule);
    s.getState().setMarks([
      { day: 2, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'employee', employeeId: 'joao' } },
      { day: 3, shiftId: 'tarde', roleId: 'balconista', slot: 0, coveredBy: { kind: 'owner' } },
    ]);
    s.getState().removeEmployee('joao');
    const after = s.getState().document;
    expect(after.employees.map((e) => e.id)).not.toContain('joao');
    expect(after.schedule?.joao).toBeUndefined();
    expect(after.marks).toHaveLength(1);
    expect(after.marks[0].coveredBy.kind).toBe('owner');
  });

  test('adicionar funcionário depois de gerar mantém as folgas dos demais', () => {
    const s = createAppStore(memoryStorage(), now);
    s.getState().loadExample();
    const doc = s.getState().document;
    const schedule = Object.fromEntries(doc.employees.map((e) => [e.id, defaultRow(doc.config)]));
    schedule.rosa[0] = { status: 'off' };
    s.getState().setSchedule(schedule);
    s.getState().addEmployee({ id: 'nova', name: 'Nova', roleId: 'balconista', shiftId: 'tarde', isWoman: true });
    const after = s.getState().document.schedule!;
    expect(after.rosa[0].status).toBe('off');
    expect(after.nova).toHaveLength(CYCLE_DAYS);
  });

  test('linha padrão marca dias fechados como "loja fechada"', () => {
    const doc = exampleDocument(now());
    doc.config.days[6] = { ...doc.config.days[6], open: false };
    const row = defaultRow(doc.config);
    expect(row[6].status).toBe('closed');
    expect(row[13].status).toBe('closed');
    expect(row[0].status).toBe('work');
  });

  test('começar do zero limpa tudo', () => {
    const storage = memoryStorage();
    const s = createAppStore(storage, now);
    s.getState().loadExample();
    s.getState().resetToEmpty();
    expect(s.getState().document.employees).toHaveLength(0);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
  });
});
