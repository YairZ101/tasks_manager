import { AGENT_PRESET_MAP } from './catalog.js';
import type { FlowDefinition, FlowNode, ValidationProblem, ValidationResult } from './types.js';

const MAX_NODES = 200;
const MAX_CONNECTIONS = 400;

export function getNodeOutcomes(node: FlowNode): string[] {
  switch (node.type) {
    case 'begin': return ['started'];
    case 'agent': return ['completed', 'failed', 'timed_out'];
    case 'check': return ['passed', 'failed', 'error', 'timed_out'];
    case 'decision': return node.config.choices.map((choice) => choice.id);
    case 'result':
    case 'note':
      return [];
  }
}

function add(problems: ValidationProblem[], code: string, message: string, detail: Partial<ValidationProblem> = {}) {
  problems.push({ code, message, ...detail });
}

/**
 * `knownAgentKeys` is the set of Agent library keys that currently exist. When omitted (for example
 * in unit tests), the built-in catalog keys are used. An Agent block is valid only if it references
 * an agent that exists, because its prompt is resolved live from that agent at run start.
 */
export function validateFlow(definition: FlowDefinition, knownAgentKeys?: Set<string>): ValidationResult {
  const problems: ValidationProblem[] = [];
  const agentKeys = knownAgentKeys ?? new Set(AGENT_PRESET_MAP.keys());

  if (definition.schemaVersion !== 1) {
    add(problems, 'schema_version', `Unsupported Flow schema version ${definition.schemaVersion}.`);
  }
  if (definition.nodes.length > MAX_NODES) add(problems, 'node_limit', `A Flow can contain at most ${MAX_NODES} nodes.`);
  if (definition.connections.length > MAX_CONNECTIONS) add(problems, 'connection_limit', `A Flow can contain at most ${MAX_CONNECTIONS} connections.`);

  const nodeMap = new Map<string, FlowNode>();
  for (const node of definition.nodes) {
    if (nodeMap.has(node.id)) add(problems, 'duplicate_node', `Node ID "${node.id}" is duplicated.`, { nodeId: node.id });
    nodeMap.set(node.id, node);
    if (node.typeVersion !== 1) add(problems, 'type_version', `Node "${node.id}" uses an unsupported type version.`, { nodeId: node.id });
  }

  const begins = definition.nodes.filter((node) => node.type === 'begin');
  const results = definition.nodes.filter((node) => node.type === 'result');
  if (begins.length !== 1) add(problems, 'begin_count', 'A published Flow must contain exactly one Begin block.');
  if (results.length === 0) add(problems, 'result_count', 'A published Flow must contain at least one Result block.');

  const connectionIds = new Set<string>();
  const outgoing = new Map<string, typeof definition.connections>();
  const incoming = new Map<string, typeof definition.connections>();
  for (const connection of definition.connections) {
    if (connectionIds.has(connection.id)) add(problems, 'duplicate_connection', `Connection ID "${connection.id}" is duplicated.`, { connectionId: connection.id });
    connectionIds.add(connection.id);
    const source = nodeMap.get(connection.sourceNodeId);
    const target = nodeMap.get(connection.targetNodeId);
    if (!source) add(problems, 'missing_source', 'A Connection references a missing source Block.', { connectionId: connection.id });
    if (!target) add(problems, 'missing_target', 'A Connection references a missing target Block.', { connectionId: connection.id });
    if (source && !getNodeOutcomes(source).includes(connection.sourceOutcomeId)) {
      add(problems, 'missing_outcome', `Outcome "${connection.sourceOutcomeId}" does not exist on "${source.config && 'name' in source.config ? source.config.name : source.id}".`, { nodeId: source.id, connectionId: connection.id });
    }
    const key = `${connection.sourceNodeId}:${connection.sourceOutcomeId}`;
    const sourceList = outgoing.get(key) ?? [];
    sourceList.push(connection);
    outgoing.set(key, sourceList);
    const targetList = incoming.get(connection.targetNodeId) ?? [];
    targetList.push(connection);
    incoming.set(connection.targetNodeId, targetList);
  }

  for (const [key, connections] of outgoing) {
    if (connections.length > 1) add(problems, 'fan_out', `Outcome "${key}" has more than one target.`, { connectionId: connections[1].id });
  }

  for (const node of definition.nodes) {
    if (node.type === 'note') {
      if ((incoming.get(node.id)?.length ?? 0) > 0 || definition.connections.some((connection) => connection.sourceNodeId === node.id)) {
        add(problems, 'note_connection', 'Notes are canvas annotations and cannot be connected.', { nodeId: node.id });
      }
      continue;
    }
    if (node.type === 'begin') {
      if ((incoming.get(node.id)?.length ?? 0) > 0) add(problems, 'begin_input', 'Begin cannot have an incoming Connection.', { nodeId: node.id });
      if ((outgoing.get(`${node.id}:started`)?.length ?? 0) !== 1) add(problems, 'begin_output', 'Begin must connect its Started outcome.', { nodeId: node.id });
    }
    if (node.type === 'agent') {
      if (!agentKeys.has(node.config.preset)) add(problems, 'agent_preset', `Agent "${node.config.name || node.config.preset}" is not in the Agent library. Pick an existing agent.`, { nodeId: node.id });
      if (!node.config.name.trim()) add(problems, 'node_name', 'Agent name is required.', { nodeId: node.id });
      if ((outgoing.get(`${node.id}:completed`)?.length ?? 0) !== 1) add(problems, 'agent_completed', `Agent "${node.config.name}" must connect Completed.`, { nodeId: node.id });
    }
    if (node.type === 'check') {
      if (!node.config.name.trim()) add(problems, 'node_name', 'Check name is required.', { nodeId: node.id });
      if (!node.config.command.trim()) add(problems, 'check_command', `Check "${node.config.name}" needs a command.`, { nodeId: node.id });
      if (node.config.timeoutMs < 1000) add(problems, 'check_timeout', 'Check timeout must be at least one second.', { nodeId: node.id });
      const cwd = node.config.workingDirectory.trim();
      if (cwd.startsWith('/') || cwd.split(/[\\/]/).includes('..')) add(problems, 'check_working_directory', 'Check working directory must stay inside the Workspace.', { nodeId: node.id });
      for (const outcome of ['passed', 'failed']) {
        if ((outgoing.get(`${node.id}:${outcome}`)?.length ?? 0) !== 1) add(problems, 'check_outcome', `Check "${node.config.name}" must connect ${outcome}.`, { nodeId: node.id });
      }
    }
    if (node.type === 'decision') {
      if (!node.config.name.trim()) add(problems, 'node_name', 'Decision name is required.', { nodeId: node.id });
      if (node.config.choices.length < 1 || node.config.choices.length > 5) add(problems, 'decision_choices', 'A Decision needs between one and five choices.', { nodeId: node.id });
      const choiceIds = new Set<string>();
      const labels = new Set<string>();
      for (const choice of node.config.choices) {
        if (!choice.id || choiceIds.has(choice.id)) add(problems, 'decision_choice_id', 'Decision choice IDs must be unique and non-empty.', { nodeId: node.id });
        choiceIds.add(choice.id);
        const normalized = choice.label.trim().toLowerCase();
        if (!normalized || labels.has(normalized)) add(problems, 'decision_choice_label', 'Decision choice labels must be distinct and non-empty.', { nodeId: node.id });
        labels.add(normalized);
        if ((outgoing.get(`${node.id}:${choice.id}`)?.length ?? 0) !== 1) add(problems, 'decision_connection', `Decision choice "${choice.label || choice.id}" must be connected.`, { nodeId: node.id });
      }
    }
    if (node.type === 'result' && getNodeOutcomes(node).some((outcome) => outgoing.has(`${node.id}:${outcome}`))) {
      add(problems, 'terminal_output', 'Result cannot have outgoing Connections.', { nodeId: node.id });
    }
  }

  const executable = definition.nodes.filter((node) => node.type !== 'note');
  const begin = begins[0];
  if (begin) {
    const reachable = new Set<string>();
    const stack = [begin.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const connection of definition.connections) if (connection.sourceNodeId === id) stack.push(connection.targetNodeId);
    }
    for (const node of executable) if (!reachable.has(node.id)) add(problems, 'unreachable', `Block "${'name' in node.config ? node.config.name : node.id}" is unreachable.`, { nodeId: node.id });
  }

  const canReachResult = new Set(results.map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const connection of definition.connections) {
      if (canReachResult.has(connection.targetNodeId) && !canReachResult.has(connection.sourceNodeId)) {
        canReachResult.add(connection.sourceNodeId);
        changed = true;
      }
    }
  }
  for (const node of executable) if (!canReachResult.has(node.id)) add(problems, 'dead_end', `Block "${'name' in node.config ? node.config.name : node.id}" cannot reach a Result.`, { nodeId: node.id });

  const automaticIds = new Set(executable.filter((node) => node.type !== 'decision').map((node) => node.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const connection of definition.connections) {
      if (connection.sourceNodeId === id && automaticIds.has(connection.targetNodeId) && hasCycle(connection.targetNodeId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of automaticIds) {
    if (hasCycle(id)) {
      add(problems, 'automatic_cycle', 'Every cycle must pass through a Decision block.', { nodeId: id });
      break;
    }
  }

  return { valid: problems.length === 0, problems };
}
