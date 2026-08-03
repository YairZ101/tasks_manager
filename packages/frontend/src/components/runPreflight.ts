import type { Flow } from '../domain.js';

export function buildRunPreflight(flow: Flow | undefined) {
  if (!flow?.activeVersion) return null;
  const blocks = flow.activeVersion.definition.nodes.filter((node) => node.type !== 'note');
  const agentBlocks = blocks.filter((node) => node.type === 'agent');
  const effectLevel = agentBlocks.some((node) => node.config.effectLevel === 'external_write') ? 'external_write'
    : agentBlocks.some((node) => node.config.effectLevel === 'workspace_write') ? 'workspace_write'
      : 'read_only';
  const effectCopy = {
    read_only: 'Read-only analysis and checks',
    workspace_write: 'May change this task’s workspace',
    external_write: 'May change the workspace and external services',
  }[effectLevel];
  return {
    name: flow.name,
    version: flow.activeVersion.version,
    blockNames: blocks.slice(0, 4).map((node) => 'name' in node.config ? node.config.name : node.type),
    remainingBlocks: Math.max(0, blocks.length - 4),
    workspace: 'Task-scoped workspace · reused by future Runs',
    effectCopy,
  };
}
