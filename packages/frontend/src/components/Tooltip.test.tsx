import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Tooltip from './Tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders children', () => {
    render(
      <Tooltip label="Help text">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeInTheDocument();
  });

  test('does not show tooltip initially', () => {
    render(
      <Tooltip label="Tip">
        <button>Btn</button>
      </Tooltip>
    );
    expect(screen.queryByText('Tip')).not.toBeInTheDocument();
  });

  test('shows tooltip after hover delay', async () => {
    const { container } = render(
      <Tooltip label="Shown">
        <button>Hover</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(container.firstElementChild!);

    await waitFor(() => {
      expect(screen.getByText('Shown')).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  test('hides tooltip on mouse leave', async () => {
    const { container } = render(
      <Tooltip label="Gone">
        <button>Hover</button>
      </Tooltip>
    );

    const wrapper = container.firstElementChild!;
    fireEvent.mouseEnter(wrapper);

    await waitFor(() => {
      expect(screen.getByText('Gone')).toBeInTheDocument();
    }, { timeout: 1000 });

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
  });

  test('applies className to wrapper', () => {
    const { container } = render(
      <Tooltip label="Tip" className="custom-class">
        <span>Child</span>
      </Tooltip>
    );
    expect(container.firstElementChild?.className).toContain('custom-class');
  });
});
