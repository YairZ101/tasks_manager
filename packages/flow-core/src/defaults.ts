import { createAgentConfig } from './catalog.js';
import type { FlowConnection, FlowDefinition, FlowNode } from './types.js';

function connection(id: string, sourceNodeId: string, sourceOutcomeId: string, targetNodeId: string): FlowConnection {
  return { id, sourceNodeId, sourceOutcomeId, targetNodeId };
}

export function createMinimalFlow(): FlowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 40, y: 160 }, config: { name: 'Begin' } },
      { id: 'development', type: 'agent', typeVersion: 1, position: { x: 330, y: 160 }, config: createAgentConfig('development') },
      { id: 'completed', type: 'result', typeVersion: 1, position: { x: 650, y: 160 }, config: { name: 'Completed', category: 'completed' } },
    ],
    connections: [
      connection('begin-development', 'begin', 'started', 'development'),
      connection('development-completed', 'development', 'completed', 'completed'),
    ],
    viewport: { x: 30, y: 150, zoom: 0.9 },
  };
}

export function createBlankFlow(): FlowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 70, y: 160 }, config: { name: 'Begin' } },
      { id: 'completed', type: 'result', typeVersion: 1, position: { x: 390, y: 160 }, config: { name: 'Completed', category: 'completed' } },
    ],
    connections: [connection('begin-completed', 'begin', 'started', 'completed')],
    viewport: { x: 70, y: 180, zoom: 1 },
  };
}

export function createRecommendedFlow(): FlowDefinition {
  const nodes: FlowNode[] = [
    { id: 'begin', type: 'begin', typeVersion: 1, position: { x: 20, y: 250 }, config: { name: 'Begin' } },
    { id: 'planning', type: 'agent', typeVersion: 1, position: { x: 270, y: 250 }, config: createAgentConfig('planning') },
    {
      id: 'plan-decision', type: 'decision', typeVersion: 1, position: { x: 560, y: 250 }, config: {
        name: 'Plan review', instructions: 'Review the proposed plan before implementation.', choices: [
          { id: 'approved', label: 'Approved', commentRequired: false, tone: 'positive' },
          { id: 'changes', label: 'Changes requested', commentRequired: true, tone: 'warning' },
        ],
      },
    },
    { id: 'development', type: 'agent', typeVersion: 1, position: { x: 870, y: 250 }, config: createAgentConfig('development') },
    { id: 'tests', type: 'check', typeVersion: 1, position: { x: 1160, y: 250 }, config: { name: 'Project checks', command: 'bun run test', workingDirectory: '.', timeoutMs: 180000, effectLevel: 'read_only' } },
    {
      id: 'test-decision', type: 'decision', typeVersion: 1, position: { x: 1160, y: 520 }, config: {
        name: 'Failed checks', instructions: 'Choose whether to send the task back for fixes or pause the run.', choices: [
          { id: 'retry', label: 'Fix and retry', commentRequired: false, tone: 'warning' },
          { id: 'pause', label: 'Pause run', commentRequired: false, tone: 'neutral' },
        ],
      },
    },
    {
      id: 'final-decision', type: 'decision', typeVersion: 1, position: { x: 1450, y: 250 }, config: {
        name: 'Final review', instructions: 'Review the completed work before publishing it.', choices: [
          { id: 'approved', label: 'Approved', commentRequired: false, tone: 'positive' },
          { id: 'changes', label: 'Changes requested', commentRequired: true, tone: 'warning' },
        ],
      },
    },
    { id: 'open-pr', type: 'agent', typeVersion: 1, position: { x: 1760, y: 250 }, config: createAgentConfig('open-pr') },
    { id: 'completed', type: 'result', typeVersion: 1, position: { x: 2060, y: 190 }, config: { name: 'Completed', category: 'completed' } },
    { id: 'paused', type: 'result', typeVersion: 1, position: { x: 1450, y: 540 }, config: { name: 'Paused', category: 'paused' } },
  ];

  return {
    schemaVersion: 1,
    nodes,
    connections: [
      connection('c1', 'begin', 'started', 'planning'),
      connection('c2', 'planning', 'completed', 'plan-decision'),
      connection('c3', 'plan-decision', 'approved', 'development'),
      connection('c4', 'plan-decision', 'changes', 'planning'),
      connection('c5', 'development', 'completed', 'tests'),
      connection('c6', 'tests', 'passed', 'final-decision'),
      connection('c7', 'tests', 'failed', 'test-decision'),
      connection('c8', 'test-decision', 'retry', 'development'),
      connection('c9', 'test-decision', 'pause', 'paused'),
      connection('c10', 'final-decision', 'approved', 'open-pr'),
      connection('c11', 'final-decision', 'changes', 'development'),
      connection('c12', 'open-pr', 'completed', 'completed'),
    ],
    viewport: { x: 30, y: 120, zoom: 0.86 },
  };
}
