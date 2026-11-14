import { maskTime } from './timeMask';

describe('máscara de horário 24h', () => {
  test.each([
    ['0545', '05:45'],
    ['1745', '17:45'],
    ['17', '17'],
    ['174', '17:4'],
    ['5:45', '5:45'],
    ['17:45pm', '17:45'],
    ['12345', '12:34'],
  ])('%s -> %s', (raw, out) => {
    expect(maskTime(raw)).toBe(out);
  });
});
