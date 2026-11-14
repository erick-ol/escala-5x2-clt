import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renderiza o título', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /escala 5x2/i })).toBeInTheDocument();
});
