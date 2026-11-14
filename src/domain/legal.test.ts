import { defaultRegime, LEGAL_DATES } from './legal';

describe('regime padrão', () => {
  test('42h até a véspera da virada e 40h a partir dela (data local)', () => {
    expect(defaultRegime(new Date(2027, 11, 14, 23, 59))).toBe('42h');
    expect(defaultRegime(new Date(2027, 11, 15, 0, 1))).toBe('40h');
    expect(LEGAL_DATES.switch40h).toBe('2027-12-15');
  });
});
