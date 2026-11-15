import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DateInput, brToISO, isoToBR } from './DateInput';

function Harness({ onChange }: { onChange(iso: string): void }) {
  const [value, setValue] = useState('2026-11-15');
  return (
    <>
      <label htmlFor="d">Data</label>
      <DateInput
        id="d"
        min="2020-01-05"
        value={value}
        onChange={(iso) => {
          onChange(iso);
          setValue(iso);
        }}
      />
    </>
  );
}

describe('DateInput', () => {
  test('converte entre ISO e DD/MM/AAAA', () => {
    expect(isoToBR('2026-12-06')).toBe('06/12/2026');
    expect(brToISO('06/12/2026')).toBe('2026-12-06');
    expect(brToISO('31/02/2026')).toBeNull();
    expect(brToISO('6/12/2026')).toBeNull();
  });

  test('mostra DD/MM/AAAA, põe as barras sozinho e só grava data completa e válida', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByLabelText('Data');
    expect(field).toHaveValue('15/11/2026');
    expect(field).toHaveAttribute('placeholder', 'DD/MM/AAAA');

    await user.clear(field);
    await user.type(field, '2512');
    expect(field).toHaveValue('25/12');
    expect(onChange).not.toHaveBeenCalled();
    await user.type(field, '2026');
    expect(onChange).toHaveBeenCalledWith('2026-12-25');
    expect(field).toHaveValue('25/12/2026');

    await user.clear(field);
    await user.type(field, '31022026');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Data inválida/)).toBeInTheDocument();
  });
});
