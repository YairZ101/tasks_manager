import path from 'path';
import { spawn } from 'child_process';
import { parse } from 'shell-quote';
import type { CompiledFlowDefinition, CompiledFlowNode, DecisionNode, FlowConnection, ResultNode } from '@tasks-manager/flow-core';
import { getDb } from '../db/database.js';
import { CliAdapter, sanitizeLine } from '../agents/cli-adapter.js';
import { isGitRepo } from '../worktree/worktree.js';
import type { AgentConfig, Attempt, RunnerState, Task, WorkflowRun } from '../types.js';
import { emitEvent, emitRun } from './events.js';
import { getDefaultFlow, getFlowVersion, getRun, getTask } from './repository.js';
import { ensureWorkspace, finalizeWorkspace } from './workspaces.js';

type Execution = {
  attemptId: number;
  runId: number;
  taskId: number;
  taskKey: string;
  blockName: string;
  controller: AbortController;
  promise: Promise<void>;
};

let repoRoot = process.cwd();
let queueTimer: ReturnType<typeof setInterval> | null = null;
let pumping = false;
const executions = new Map<number, Execution>();

function definitionFor(run: WorkflowRun): CompiledFlowDefinition {
  const version = getFlowVersion(run.flow_version_id);
  if (!version?.compiled) throw new Error(`Published Flow version ${run.flow_version_id} is missing its compiled definition.`);
  return version.compiled;
}

function nodeFor(definition: CompiledFlowDefinition, blockId: string): CompiledFlowNode {
  const node = definition.nodes.find((candidate) => candidate.id === blockId);
  if (!node) throw new Error(`Flow block "${blockId}" no longer exists in the immutable version.`);
  return node;
}

function nextConnection(definition: CompiledFlowDefinition, blockId: string, outcomeId: string): FlowConnection | null {
  return definition.connections.find((connection) => connection.sourceNodeId === blockId && connection.sourceOutcomeId === outcomeId) ?? null;
}

function insertAttempt(runId: number, blockId: string, parentAttemptId: number | null, connectionId: string | null, status: Attempt['status']): Attempt {
  const db = getDb();
  const counters = db.query<{ sequence: number; block_attempt: number }, [number, string]>(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence,
      COALESCE(MAX(CASE WHEN block_id = ? THEN block_attempt END), 0) + 1 AS block_attempt
    FROM attempts WHERE run_id = ?
  `).get(blockId, runId)!;
  const result = db.query(`
    INSERT INTO attempts (run_id, block_id, parent_attempt_id, incoming_connection_id, sequence, block_attempt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, blockId, parentAttemptId, connectionId, counters.sequence, counters.block_attempt, status);
  return db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(Number(result.lastInsertRowid))!;
}

async function enterBlock(runId: number, blockId: string, parentAttemptId: number | null, connectionId: string | null, hops = 0): Promise<void> {
  if (hops > 100) return putRunInAttention(runId, 'The Flow exceeded 100 automatic transitions. Add a Decision to bound the loop.');
  const db = getDb();
  const run = getRun(runId);
  if (!run || ['finished', 'stopped'].includes(run.status)) return;
  const definition = definitionFor(run);
  const node = nodeFor(definition, blockId);
  if (node.type === 'note') return putRunInAttention(runId, 'A Connection targets a Note block, which cannot execute.');

  if (node.type === 'begin') {
    const attempt = insertAttempt(runId, node.id, parentAttemptId, connectionId, 'succeeded');
    db.query("UPDATE attempts SET outcome_id = 'started', started_at = datetime('now'), finished_at = datetime('now') WHERE id = ?").run(attempt.id);
    const next = nextConnection(definition, node.id, 'started');
    if (!next) return putRunInAttention(runId, 'Begin has no connected Started outcome.');
    return enterBlock(runId, next.targetNodeId, attempt.id, next.id, hops + 1);
  }

  if (node.type === 'result') {
    const attempt = insertAttempt(runId, node.id, parentAttemptId, connectionId, 'succeeded');
    db.query("UPDATE attempts SET outcome_id = 'arrived', started_at = datetime('now'), finished_at = datetime('now') WHERE id = ?").run(attempt.id);
    await finishRun(run, node);
    return;
  }

  if (node.type === 'decision') {
    insertAttempt(runId, node.id, parentAttemptId, connectionId, 'waiting');
    db.query("UPDATE runs SET status = 'waiting', started_at = COALESCE(started_at, datetime('now')), reason = NULL WHERE id = ?").run(runId);
    emitRun(runId, run.task_id);
    return;
  }

  insertAttempt(runId, node.id, parentAttemptId, connectionId, 'queued');
  db.query("UPDATE runs SET status = 'queued', reason = NULL WHERE id = ?").run(runId);
  emitRun(runId, run.task_id);
  void pumpQueue();
}

async function followOutcome(attempt: Attempt, outcomeId: string): Promise<void> {
  const run = getRun(attempt.run_id);
  if (!run || ['finished', 'stopped'].includes(run.status)) return;
  const definition = definitionFor(run);
  const connection = nextConnection(definition, attempt.block_id, outcomeId);
  if (!connection) {
    return putRunInAttention(run.id, `Outcome "${outcomeId}" from "${nodeFor(definition, attempt.block_id).config && 'name' in nodeFor(definition, attempt.block_id).config ? nodeFor(definition, attempt.block_id).config.name : attempt.block_id}" is not connected.`);
  }
  await enterBlock(run.id, connection.targetNodeId, attempt.id, connection.id);
}

function putRunInAttention(runId: number, reason: string): void {
  const db = getDb();
  const run = getRun(runId);
  if (!run || ['finished', 'stopped'].includes(run.status)) return;
  db.query("UPDATE runs SET status = 'attention', reason = ? WHERE id = ?").run(reason, runId);
  emitRun(runId, run.task_id);
}

async function finishRun(run: WorkflowRun, resultNode: ResultNode): Promise<void> {
  const db = getDb();
  const category = resultNode.config.category;
  db.transaction(() => {
    db.query("UPDATE runs SET status = 'finished', result_category = ?, reason = ?, finished_at = datetime('now') WHERE id = ?")
      .run(category, resultNode.config.message ?? null, run.id);
    if (category === 'completed') {
      db.query("UPDATE tasks SET resolution = 'completed', queue_state = 'ready' WHERE id = ?").run(run.task_id);
    } else if (category === 'cancelled') {
      db.query("UPDATE tasks SET resolution = 'cancelled', queue_state = 'ready' WHERE id = ?").run(run.task_id);
    } else {
      db.query("UPDATE tasks SET resolution = 'open', queue_state = 'ready' WHERE id = ?").run(run.task_id);
    }
  })();
  if (run.workspace_id) await finalizeWorkspace(run.workspace_id, category === 'completed');
  emitRun(run.id, run.task_id);
  emitEvent('toast', { type: category === 'completed' ? 'success' : 'info', message: `${resultNode.config.name}: run finished.` }, 'run', run.id);
}

function createLogWriter(taskId: number, runId: number, attemptId: number) {
  const buffer: Array<{ level: string; message: string }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const rows = buffer.splice(0);
    if (!rows.length) return;
    const db = getDb();
    const insert = db.query('INSERT INTO logs (task_id, run_id, attempt_id, level, message) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      for (const row of rows) insert.run(taskId, runId, attemptId, row.level, row.message);
    })();
    for (const row of rows) emitEvent('attempt:log', { taskId, runId, attemptId, ...row }, 'attempt', attemptId);
  };
  return {
    write(level: 'info' | 'warn' | 'error' | 'agent', message: string) {
      buffer.push({ level, message: sanitizeLine(message) });
      if (!timer) timer = setTimeout(flush, 50);
    },
    flush,
  };
}

function buildPrompt(task: Task, node: Extract<CompiledFlowNode, { type: 'agent' }>, run: WorkflowRun): string {
  const db = getDb();
  const previous = db.query<{ block_id: string; outcome_id: string | null; decision_comment: string | null }, [number]>(
    'SELECT block_id, outcome_id, decision_comment FROM attempts WHERE run_id = ? AND status != \'queued\' ORDER BY sequence ASC'
  ).all(run.id);
  const history = previous.map((item) => `- ${item.block_id}: ${item.outcome_id ?? 'pending'}${item.decision_comment ? ` — ${item.decision_comment}` : ''}`).join('\n');
  return [
    node.config.compiledInstructions,
    '',
    `Task ${task.task_key}: ${task.title}`,
    task.description ? `\nDescription:\n${task.description}` : '',
    task.acceptance ? `\nAcceptance criteria:\n${task.acceptance}` : '',
    history ? `\nRun path so far:\n${history}` : '',
  ].join('\n');
}

async function executeAgent(attempt: Attempt, run: WorkflowRun, task: Task, node: Extract<CompiledFlowNode, { type: 'agent' }>, signal: AbortSignal) {
  const db = getDb();
  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  if (!config) throw new Error('Agent configuration is missing.');
  const workspace = db.query<{ worktree_path: string }, [number]>('SELECT worktree_path FROM workspaces WHERE id = ?').get(run.workspace_id!);
  if (!workspace) throw new Error('Run workspace is missing.');
  const logger = createLogWriter(task.id, run.id, attempt.id);
  try {
    const adapter = new CliAdapter(config);
    const result = await adapter.execute({
      task,
      prompt: buildPrompt(task, node, run),
      workingDir: workspace.worktree_path,
      onOutput: (line) => logger.write('agent', line),
      signal,
      onPid: (pid) => db.query("UPDATE attempts SET pid = ?, process_started_at = datetime('now') WHERE id = ?").run(pid, attempt.id),
    });
    return { outcome: result.success ? 'completed' : 'failed', result };
  } finally {
    logger.flush();
  }
}

async function executeCheck(attempt: Attempt, run: WorkflowRun, task: Task, node: Extract<CompiledFlowNode, { type: 'check' }>, signal: AbortSignal) {
  const db = getDb();
  const workspace = db.query<{ worktree_path: string }, [number]>('SELECT worktree_path FROM workspaces WHERE id = ?').get(run.workspace_id!);
  if (!workspace) throw new Error('Run workspace is missing.');
  const parsed = parse(node.config.command);
  if (!parsed.length || parsed.some((part) => typeof part !== 'string')) throw new Error('Check commands may contain arguments but not shell operators.');
  const argv = parsed as string[];
  const cwd = path.resolve(workspace.worktree_path, node.config.workingDirectory || '.');
  if (cwd !== workspace.worktree_path && !cwd.startsWith(`${workspace.worktree_path}${path.sep}`)) throw new Error('Check working directory escapes the Workspace.');
  const logger = createLogWriter(task.id, run.id, attempt.id);
  const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) db.query("UPDATE attempts SET pid = ?, process_started_at = datetime('now') WHERE id = ?").run(child.pid, attempt.id);
  const consume = (stream: NodeJS.ReadableStream | null, level: 'info' | 'error') => {
    let pending = '';
    stream?.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) logger.write(level, line);
    });
    stream?.on('end', () => { if (pending) logger.write(level, pending); });
  };
  consume(child.stdout, 'info');
  consume(child.stderr, 'error');
  const abort = () => {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    try { child.kill('SIGTERM'); } catch {}
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { outcome: code === 0 ? 'passed' : 'failed', result: { exitCode: code } };
  } finally {
    signal.removeEventListener('abort', abort);
    logger.flush();
  }
}

async function executeAttempt(attempt: Attempt): Promise<void> {
  const db = getDb();
  const run = getRun(attempt.run_id);
  if (!run) return;
  const task = getTask(run.task_id);
  if (!task) return;
  const node = nodeFor(definitionFor(run), attempt.block_id);
  if (node.type !== 'agent' && node.type !== 'check') return;
  const controller = new AbortController();
  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get()!;
  const timeoutMs = node.type === 'check' ? node.config.timeoutMs : config.timeout_ms;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const promise = (async () => {
    try {
      const executionResult = node.type === 'agent'
        ? await executeAgent(attempt, run, task, node, controller.signal)
        : await executeCheck(attempt, run, task, node, controller.signal);
      const freshRun = getRun(run.id);
      if (!freshRun || freshRun.status === 'stopped') return;
      db.query("UPDATE attempts SET status = ?, outcome_id = ?, result_json = ?, pid = NULL, finished_at = datetime('now') WHERE id = ?")
        .run(executionResult.outcome === 'completed' || executionResult.outcome === 'passed' ? 'succeeded' : 'failed', executionResult.outcome, JSON.stringify(executionResult.result), attempt.id);
      await followOutcome(db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(attempt.id)!, executionResult.outcome);
    } catch (error) {
      const freshRun = getRun(run.id);
      if (!freshRun || freshRun.status === 'stopped') return;
      const outcome = timedOut ? 'timed_out' : 'error';
      const status = timedOut ? 'timed_out' : 'failed';
      db.query("UPDATE attempts SET status = ?, outcome_id = ?, result_json = ?, pid = NULL, finished_at = datetime('now') WHERE id = ?")
        .run(status, node.type === 'agent' && outcome === 'error' ? 'failed' : outcome, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), attempt.id);
      await followOutcome(db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(attempt.id)!, node.type === 'agent' && outcome === 'error' ? 'failed' : outcome);
    } finally {
      clearTimeout(timer);
      executions.delete(attempt.id);
      void pumpQueue();
    }
  })();
  executions.set(attempt.id, { attemptId: attempt.id, runId: run.id, taskId: task.id, taskKey: task.task_key, blockName: node.config.name, controller, promise });
  emitRun(run.id, task.id);
}

export function initEngine(root: string): void {
  repoRoot = root;
  if (!queueTimer) {
    queueTimer = setInterval(() => { void pumpQueue(); }, 1000);
    queueTimer.unref?.();
  }
  void pumpQueue();
}

export async function shutdownEngine(): Promise<void> {
  if (queueTimer) clearInterval(queueTimer);
  queueTimer = null;
  const current = [...executions.values()];
  for (const execution of current) execution.controller.abort();
  await Promise.allSettled(current.map((execution) => execution.promise));
}

export function getRunnerState(): RunnerState {
  const db = getDb();
  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  const maxConcurrent = isGitRepo(repoRoot) ? (config?.max_concurrent_executions ?? 3) : 1;
  const queuedCount = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM attempts WHERE status = 'queued'").get()?.count ?? 0;
  return {
    activeCount: executions.size,
    queuedCount,
    maxConcurrent,
    executions: [...executions.values()].map(({ attemptId, runId, taskId, taskKey, blockName }) => ({ attemptId, runId, taskId, taskKey, blockName })),
  };
}

export async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const db = getDb();
    const state = getRunnerState();
    const capacity = state.maxConcurrent - state.activeCount;
    if (capacity <= 0) return;
    const queued = db.query<Attempt, [number]>(`
      SELECT a.* FROM attempts a JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'queued' AND r.status IN ('queued', 'running')
      ORDER BY a.id ASC LIMIT ?
    `).all(capacity);
    for (const attempt of queued) {
      const claimed = db.query("UPDATE attempts SET status = 'running', started_at = datetime('now') WHERE id = ? AND status = 'queued'").run(attempt.id);
      if (!claimed.changes) continue;
      db.query("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(attempt.run_id);
      const fresh = db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(attempt.id)!;
      await executeAttempt(fresh);
    }
  } finally {
    pumping = false;
  }
}

export async function startRun(taskId: number, flowId?: number): Promise<WorkflowRun> {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (task.resolution !== 'open') throw Object.assign(new Error('Finished tasks cannot start a Run. Reopen the task first.'), { status: 409 });
  const active = db.query<WorkflowRun, [number]>("SELECT * FROM runs WHERE task_id = ? AND status IN ('queued','running','waiting','attention')").get(taskId);
  if (active) throw Object.assign(new Error('Task already has an active Run.'), { status: 409, runId: active.id });
  const flow = flowId
    ? db.query<{ active_version_id: number | null }, [number]>('SELECT active_version_id FROM flows WHERE id = ?').get(flowId)
    : getDefaultFlow();
  const versionId = flow?.active_version_id;
  if (!versionId) throw Object.assign(new Error('Choose a Flow with a published version before starting.'), { status: 409 });
  const version = getFlowVersion(versionId);
  if (!version?.compiled) throw Object.assign(new Error('The selected Flow version is not published.'), { status: 409 });
  const workspace = await ensureWorkspace(task, repoRoot);
  const result = db.query("INSERT INTO runs (task_id, flow_version_id, workspace_id, status) VALUES (?, ?, ?, 'queued')")
    .run(task.id, version.id, workspace.id);
  const run = getRun(Number(result.lastInsertRowid))!;
  const begin = version.compiled.nodes.find((node) => node.type === 'begin')!;
  await enterBlock(run.id, begin.id, null, null);
  return getRun(run.id)!;
}

export async function decide(attemptId: number, outcomeId: string, comment?: string): Promise<WorkflowRun> {
  const db = getDb();
  const attempt = db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  if (!attempt) throw Object.assign(new Error('Attempt not found'), { status: 404 });
  const run = getRun(attempt.run_id)!;
  const node = nodeFor(definitionFor(run), attempt.block_id);
  if (node.type !== 'decision') throw Object.assign(new Error('This Attempt is not waiting for a Decision.'), { status: 409 });
  const choice = (node as DecisionNode).config.choices.find((candidate) => candidate.id === outcomeId);
  if (!choice) throw Object.assign(new Error('Unknown Decision choice.'), { status: 400 });
  if (choice.commentRequired && !comment?.trim()) throw Object.assign(new Error('A comment is required for this choice.'), { status: 400 });
  if (attempt.status !== 'waiting') {
    if (attempt.outcome_id === outcomeId && (attempt.decision_comment ?? '') === (comment?.trim() ?? '')) return run;
    throw Object.assign(new Error('This Decision has already been resolved.'), { status: 409 });
  }
  const updated = db.query("UPDATE attempts SET status = 'succeeded', outcome_id = ?, decision_comment = ?, started_at = COALESCE(started_at, datetime('now')), finished_at = datetime('now') WHERE id = ? AND status = 'waiting'")
    .run(outcomeId, comment?.trim() || null, attempt.id);
  if (!updated.changes) throw Object.assign(new Error('This Decision was resolved by another request.'), { status: 409 });
  await followOutcome(db.query<Attempt, [number]>('SELECT * FROM attempts WHERE id = ?').get(attempt.id)!, outcomeId);
  return getRun(run.id)!;
}

export async function stopRun(runId: number): Promise<WorkflowRun> {
  const db = getDb();
  const run = getRun(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (['finished', 'stopped'].includes(run.status)) return run;
  db.transaction(() => {
    db.query("UPDATE runs SET status = 'stopped', reason = 'Stopped by user', finished_at = datetime('now') WHERE id = ?").run(run.id);
    db.query("UPDATE attempts SET status = 'cancelled', outcome_id = 'cancelled', pid = NULL, finished_at = datetime('now') WHERE run_id = ? AND status IN ('queued','running','waiting')").run(run.id);
    db.query("UPDATE tasks SET queue_state = 'ready', resolution = 'open' WHERE id = ?").run(run.task_id);
  })();
  for (const execution of executions.values()) if (execution.runId === run.id) execution.controller.abort();
  if (run.workspace_id) await finalizeWorkspace(run.workspace_id, false);
  emitRun(run.id, run.task_id);
  return getRun(run.id)!;
}

export async function retryRun(runId: number): Promise<WorkflowRun> {
  const db = getDb();
  const run = getRun(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (run.status !== 'attention') throw Object.assign(new Error('Only a Run that needs attention can be retried.'), { status: 409 });
  const latest = db.query<Attempt, [number]>('SELECT * FROM attempts WHERE run_id = ? ORDER BY sequence DESC LIMIT 1').get(run.id);
  if (!latest) throw Object.assign(new Error('Run has no Attempt to retry.'), { status: 409 });
  db.query("UPDATE runs SET status = 'queued', reason = NULL WHERE id = ?").run(run.id);
  await enterBlock(run.id, latest.block_id, latest.parent_attempt_id, latest.incoming_connection_id);
  return getRun(run.id)!;
}

export function recoverInterruptedRuns(): number {
  const db = getDb();
  const interrupted = db.query<{ id: number; run_id: number }, []>("SELECT id, run_id FROM attempts WHERE status = 'running'").all();
  db.transaction(() => {
    for (const attempt of interrupted) {
      db.query("UPDATE attempts SET status = 'interrupted', outcome_id = 'interrupted', pid = NULL, finished_at = datetime('now') WHERE id = ?").run(attempt.id);
      db.query("UPDATE runs SET status = 'attention', reason = 'Server restarted while this block was running.' WHERE id = ? AND status != 'finished'").run(attempt.run_id);
    }
  })();
  return interrupted.length;
}
