import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../hooks/useTaskStore.js';
import PageHeader from './PageHeader.js';

test('renders the shared page hierarchy, capacity, and action slot', () => {
  useAppStore.setState({ runner: { activeCount: 2, queuedCount: 1, maxConcurrent: 4, executions: [] } });

  render(<PageHeader title="Flow library" description="Design and publish reusable execution paths.">
    <button type="button">New flow</button>
  </PageHeader>);

  expect(screen.getByRole('heading', { level: 1, name: 'Flow library' })).toBeVisible();
  expect(document.querySelector('.page-header .eyebrow')).not.toBeInTheDocument();
  expect(screen.getByText('Design and publish reusable execution paths.')).toBeVisible();
  expect(screen.getByText('Capacity 2/4')).toBeVisible();
  expect(screen.getByRole('button', { name: 'New flow' })).toBeVisible();
});
