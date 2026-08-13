import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import SelectionMenu from './SelectionMenu.js';

const options = [
  { value: 'unavailable', label: 'Unavailable', disabled: true },
  { value: 'first', label: 'First' },
  { value: 'second', label: 'Second' },
];

describe('SelectionMenu', () => {
  test('does not open when the whole field is disabled', () => {
    render(<SelectionMenu label="Example" value="first" options={options} onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Example' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('skips disabled options during keyboard navigation', () => {
    const onChange = vi.fn();
    render(<SelectionMenu label="Example" value="second" options={options} onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Example' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox', { name: 'Example options' });
    fireEvent.keyDown(listbox, { key: 'Home' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('first');
    expect(trigger).toHaveFocus();
  });

  test('moves focus without scrolling the surrounding view', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<SelectionMenu label="Example" value="first" options={options} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Example' }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  test('continues tab navigation from the trigger after closing', () => {
    render(<><button type="button">Before</button><SelectionMenu label="Example" value="first" options={options} onChange={vi.fn()} /><button type="button">After</button></>);
    const trigger = screen.getByRole('combobox', { name: 'Example' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  });

  test('keeps a long keyboard-navigated menu scrolled to the active option', () => {
    const longOptions = Array.from({ length: 12 }, (_, index) => ({ value: `option-${index}`, label: `Option ${index}` }));
    const onChange = vi.fn();
    render(<SelectionMenu label="Long menu" value="option-0" options={longOptions} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Long menu' }));
    const listbox = screen.getByRole('listbox');
    const menuOptions = screen.getAllByRole('option');
    Object.defineProperties(listbox, { clientHeight: { configurable: true, value: 68 }, scrollTop: { configurable: true, writable: true, value: 0 } });
    Object.defineProperties(menuOptions[11], { offsetTop: { configurable: true, value: 374 }, offsetHeight: { configurable: true, value: 34 } });
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(listbox.scrollTop).toBe(340);
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('option-11');
  });

  test('closes without changing the value on Escape and outside press', () => {
    const onChange = vi.fn();
    render(<><SelectionMenu label="Example" value="first" options={options} onChange={onChange} /><button type="button">Outside</button></>);
    const trigger = screen.getByRole('combobox', { name: 'Example' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
