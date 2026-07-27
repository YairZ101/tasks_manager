import { describe, expect, test } from 'vitest';
import type { Flow } from '../domain.js';
import { buildRunPreflight } from './TaskPanel.js';

const flow = (effectLevel: 'read_only' | 'workspace_write' | 'external_write'): Flow => ({
  id: 1, name: 'Delivery', is_default: 1, active_version_id: 3, created_at: '', updated_at: '',
  activeVersion: {
    id: 3, flow_id: 1, version: 4, state: 'published', draft_revision: 0, compiled: null, published_at: '',
    definition: { schemaVersion: 1, nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'agent', type: 'agent', typeVersion: 1, position: { x: 10, y: 0 }, config: { name: 'Implement', preset: 'development', instructions: '', effectLevel } },
      { id: 'check', type: 'check', typeVersion: 1, position: { x: 20, y: 0 }, config: { name: 'Verify', command: 'bun test', workingDirectory: '.', timeoutMs: 1000, effectLevel: 'read_only' } },
      { id: 'result', type: 'result', typeVersion: 1, position: { x: 30, y: 0 }, config: { name: 'Done', category: 'completed', message: '' } },
    ], connections: [] },
  },
});

describe('buildRunPreflight', () => {
  test('summarizes the published Flow and its strongest effect level', () => {
    const result = buildRunPreflight(flow('workspace_write'));
    expect(result).toMatchObject({ name: 'Delivery', version: 4, effectCopy: 'May change this task’s workspace', blockNames: ['Begin', 'Implement', 'Verify', 'Done'] });
  });
  test('requires a published default Flow', () => {
    expect(buildRunPreflight(undefined)).toBeNull();
    expect(buildRunPreflight({ ...flow('read_only'), activeVersion: null })).toBeNull();
  });
});
