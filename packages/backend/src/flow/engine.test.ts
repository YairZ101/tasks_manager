import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compileFlow, type FlowDefinition } from '@flow/core';
import { closeDb, getDb, initDb } from '../db/database.js';
import { getRun, getTaskWithState } from './repository.js';
import { initEngine, shutdownEngine, snapshotAgentPrompts, startRun, stopRun } from './engine.js';

let root = '';

function seed(command: string): number {
  const db = getDb();
  db.query("INSERT INTO project_config(id,task_prefix,repo_name) VALUES(1,'TST','test')").run();
  db.query("INSERT INTO tasks(task_key,title) VALUES('TST-1','Execute check')").run();
  const definition: FlowDefinition = {
    schemaVersion: 1,
    nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Begin' } },
      { id: 'check', type: 'check', typeVersion: 1, position: { x: 1, y: 0 }, config: { name: 'Check', command, workingDirectory: '.', timeoutMs: 10_000 } },
      { id: 'done', type: 'result', typeVersion: 1, position: { x: 2, y: 0 }, config: { name: 'Done', category: 'completed' } },
      { id: 'paused', type: 'result', typeVersion: 1, position: { x: 2, y: 1 }, config: { name: 'Paused', category: 'paused' } },
    ],
    connections: [
      { id: 'a', sourceNodeId: 'begin', sourceOutcomeId: 'started', targetNodeId: 'check' },
      { id: 'b', sourceNodeId: 'check', sourceOutcomeId: 'passed', targetNodeId: 'done' },
      { id: 'c', sourceNodeId: 'check', sourceOutcomeId: 'failed', targetNodeId: 'paused' },
    ],
  };
  const compiled = compileFlow(definition);
  const flow = db.query("INSERT INTO flows(name,is_default) VALUES('Check flow',1)").run();
  const version = db.query("INSERT INTO flow_versions(flow_id,version,state,definition_json,compiled_json,published_at) VALUES(?,1,'published',?,?,datetime('now'))")
    .run(Number(flow.lastInsertRowid), JSON.stringify(definition), JSON.stringify(compiled));
  db.query('UPDATE flows SET active_version_id=? WHERE id=?').run(Number(version.lastInsertRowid), Number(flow.lastInsertRowid));
  return Number(flow.lastInsertRowid);
}

async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for engine state.');
    await Bun.sleep(20);
  }
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-engine-')); initDb(root); initEngine(root); });
afterEach(async () => { await shutdownEngine(); closeDb(); fs.rmSync(root, { recursive: true, force: true }); });

describe('persistent execution engine', () => {
  test('claims a queued Check, records output, and finishes through a Result', async () => {
    const flowId = seed("bun -e \"console.log('check-output')\"");
    const run = await startRun(1, flowId);
    await waitFor(() => getRun(run.id)?.status === 'finished');
    expect(getRun(run.id)?.result_category).toBe('completed');
    expect(getTaskWithState(1)?.operational_state).toBe('finished');
    expect(getDb().query<{ message: string }, []>('SELECT message FROM logs LIMIT 1').get()?.message).toBe('check-output');
  });

  test('persists stopped state before cancelling the operating-system process', async () => {
    const flowId = seed("bun -e \"setTimeout(() => {}, 5000)\"");
    const run = await startRun(1, flowId);
    await waitFor(() => getRun(run.id)?.status === 'running');
    await stopRun(run.id);
    expect(getRun(run.id)?.status).toBe('stopped');
    expect(getTaskWithState(1)?.operational_state).toBe('backlog');
    expect(getDb().query<{ status: string }, []>('SELECT status FROM attempts WHERE run_id=1 ORDER BY sequence DESC LIMIT 1').get()?.status).toBe('cancelled');
  });
});

describe('agent prompt resolution at run start', () => {
  const withAgent = (preset: string): FlowDefinition => ({
    schemaVersion: 1,
    nodes: [{ id: 'a', type: 'agent', typeVersion: 1, position: { x: 0, y: 0 }, config: { name: 'Worker', preset } }],
    connections: [],
  });

  test('snapshots each referenced agent prompt live from the library', () => {
    const snapshot = JSON.parse(snapshotAgentPrompts(withAgent('development'))) as Record<string, string>;
    expect(snapshot.development).toContain('Implement the task');
  });

  test('reflects a live edit to an agent, without any republish step', () => {
    getDb().query('UPDATE agent_presets SET system_prompt = ? WHERE preset_key = ?').run('Ship it carefully.', 'development');
    const snapshot = JSON.parse(snapshotAgentPrompts(withAgent('development'))) as Record<string, string>;
    expect(snapshot.development).toBe('Ship it carefully.');
  });

  test('refuses to start a Run that references an agent no longer in the library', () => {
    expect(() => snapshotAgentPrompts(withAgent('ghost-agent'))).toThrow(/no longer exists/);
  });
});
