import { computeCoverage } from './coverage';
import { exampleDocument } from './example';
import { generateSchedule } from './generator';
import { suggestAll, suggestFor } from './suggestions';
import type { Employee, StoreConfig } from './types';

/**
 * Mercado do exemplo. Por padrão sem segunda área: com ela, o João (caixa) cobre o balcão à tarde e
 * o exemplo deixa de ter buraco de balconista à tarde, que é o cenário destes testes.
 */
function marketInput(opts: { secondary?: boolean } = {}) {
  const doc = exampleDocument(new Date('2026-11-14'));
  const config = withoutSingleShift(doc.config);
  const employees = opts.secondary ? doc.employees : doc.employees.map((e) => ({ ...e, secondaryRoleId: undefined }));
  const schedule = generateSchedule({ config, employees });
  return { config, employees, schedule };
}

/** O exemplo com o domingo igual aos outros dias (sem turno único): estes testes não são sobre o turno único. */
function withoutSingleShift(config: StoreConfig): StoreConfig {
  return { ...config, days: config.days.map(() => ({ open: true, opensAt: 6 * 60 + 30, closesAt: 20 * 60 + 30, singleShift: false })) };
}

describe('sugestões', () => {
  test('Covers AE2: mercado sugere contratar balconista e não sugere mover a Rosa para a tarde', () => {
    const input = marketInput();
    const { summary } = computeCoverage({ ...input, marks: [] });
    const tardeBalcao = summary.find((s) => s.roleId === 'balconista' && s.shiftId === 'tarde');
    expect(tardeBalcao).toBeDefined();
    const list = suggestFor(input, tardeBalcao!);
    const hire = list.find((s) => s.kind === 'hire');
    expect(hire?.text).toMatch(/Contratar 1 balconista à tarde/);
    expect(hire!.gapsAfter).toBeLessThan(hire!.gapsBefore);
    expect(list.some((s) => s.kind === 'move-shift' && s.employeeId === 'rosa')).toBe(false);
  });

  test('sugere mover um caixa de um turno com sobra para outro com falta, mostrando o efeito', () => {
    const base = marketInput();
    const config: StoreConfig = {
      ...base.config,
      minimums: [
        { roleId: 'caixa', shiftId: 'manha', perWeekday: [1, 1, 1, 1, 1, 1, 1] },
        { roleId: 'caixa', shiftId: 'tarde', perWeekday: [2, 2, 2, 2, 2, 2, 2] },
      ],
    };
    // 3 caixas de manhã (sobra) e 1 à tarde (falta)
    const employees: Employee[] = [
      { id: 'a', name: 'Ana', roleId: 'caixa', shiftId: 'manha', isWoman: false },
      { id: 'b', name: 'Bia', roleId: 'caixa', shiftId: 'manha', isWoman: false },
      { id: 'c', name: 'Caio', roleId: 'caixa', shiftId: 'manha', isWoman: false },
      { id: 'd', name: 'Davi', roleId: 'caixa', shiftId: 'tarde', isWoman: false },
    ];
    const schedule = generateSchedule({ config, employees });
    const input = { config, employees, schedule };
    const { summary } = computeCoverage({ ...input, marks: [] });
    const tarde = summary.find((s) => s.shiftId === 'tarde')!;
    const move = suggestFor(input, tarde).find((s) => s.kind === 'move-shift');
    expect(move).toBeDefined();
    expect(move!.text).toMatch(/^Passar .+ para o turno tarde$/);
    expect(move!.gapsAfter).toBeLessThan(move!.gapsBefore);
  });

  test('sugere reduzir o mínimo nos dias com buraco', () => {
    const input = marketInput();
    const { summary } = computeCoverage({ ...input, marks: [] });
    const item = summary[0];
    const reduce = suggestFor(input, item).find((s) => s.kind === 'reduce-minimum');
    expect(reduce?.text).toMatch(/Aceitar ficar sem balconista/);
  });

  test('sem buracos, nenhuma sugestão', () => {
    const base = marketInput();
    const config: StoreConfig = { ...base.config, minimums: [] };
    const input = { ...base, config };
    const { summary } = computeCoverage({ ...input, marks: [] });
    expect(summary).toHaveLength(0);
    expect(suggestAll(input, summary).size).toBe(0);
  });

  test('com a segunda área, as sugestões usam a mesma contagem de buracos da cobertura', () => {
    const input = marketInput({ secondary: true });
    const { summary, gaps } = computeCoverage({ ...input, marks: [] });
    expect(summary.length).toBeGreaterThan(0);
    for (const item of summary) {
      for (const s of suggestFor(input, item)) {
        expect(s.gapsBefore).toBe(gaps.length);
        expect(s.gapsAfter).toBeLessThan(s.gapsBefore);
      }
    }
  });
});
