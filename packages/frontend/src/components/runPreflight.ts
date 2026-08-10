import type { Flow } from '../domain.js';

export function buildRunPreflight(flow: Flow | undefined) {
  if (!flow?.activeVersion) return null;
  const blocks = flow.activeVersion.definition.nodes.filter((node) => node.type !== 'note');
  return {
    name: flow.name,
    version: flow.activeVersion.version,
    blockNames: blocks.slice(0, 4).map((node) => 'name' in node.config ? node.config.name : node.type),
    remainingBlocks: Math.max(0, blocks.length - 4),
    workspace: 'Task-scoped workspace · reused by future Runs',
  };
}
