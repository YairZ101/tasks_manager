import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  addEdge, BaseEdge, getSmoothStepPath, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createAgentConfig, getNodeOutcomes, validateFlow, type FlowDefinition, type FlowNode } from '@flow/core';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { AgentPreset } from '../domain.js';
import type { FlowVersion, FlowVersionAction } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { connectorSourcePortTop, routeFlowConnectors } from './flowRouting.js';
import { BlockIcon, Icon } from './Icon.js';
import SelectionMenu from './SelectionMenu.js';

type CanvasNode = Node<{ flowNode: FlowNode }, 'flowBlock'>;
type EditorViewport = NonNullable<FlowDefinition['viewport']>;
type EditorPanel = 'palette' | 'inspector' | 'history' | null;
type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type VersionChangeKind = 'initial' | 'added' | 'removed' | 'changed' | 'connected' | 'disconnected';
export type VersionChange = { kind: VersionChangeKind; title: string; detail?: string; blockType?: FlowNode['type']; timestamp?: string };
export type FlowZoomMode = 'overview' | 'compact' | 'detail';
export const MIN_FLOW_ZOOM = 0.2;
export const COMPACT_ZOOM_THRESHOLD = 0.35;
export const DETAIL_ZOOM_THRESHOLD = 0.55;
export const FLOW_NODE_HEIGHTS: Record<Exclude<FlowNode['type'], 'note'>, number> = {
  begin: 136,
  agent: 224,
  check: 224,
  decision: 154,
  result: 142,
};
export const FLOW_LAYOUT_NODE_WIDTH = 244;
export const FLOW_LAYOUT_COLUMN_GAP = 148;
export const FLOW_LAYOUT_ROW_GAP = 84;
const FLOW_LAYOUT_MARGIN = 80;
const FLOW_LAYOUT_NOTE_GAP = 28;
const resultCategoryOptions = [
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];
const noteColorOptions = [
  { value: 'slate', label: 'Slate' },
  { value: 'blue', label: 'Blue' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
];

const defaultViewport: EditorViewport = { x: 30, y: 120, zoom: 0.86 };

export function getFlowZoomMode(zoom: number): FlowZoomMode {
  if (zoom < COMPACT_ZOOM_THRESHOLD) return 'overview';
  if (zoom < DETAIL_ZOOM_THRESHOLD) return 'compact';
  return 'detail';
}

function sameViewport(a: EditorViewport, b: EditorViewport): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.zoom - b.zoom) < 0.001;
}

const typeMeta: Record<FlowNode['type'], { label: string; description: string }> = {
  begin: { label: 'Begin', description: 'One entry point' },
  agent: { label: 'Agent', description: 'Autonomous work' },
  check: { label: 'Check', description: 'Deterministic command' },
  decision: { label: 'Decision', description: 'Human choice' },
  result: { label: 'Result', description: 'Explicit outcome' },
  note: { label: 'Note', description: 'Canvas annotation' },
};

const configFieldLabels: Record<string, string> = {
  category: 'result category',
  choices: 'decision choices',
  color: 'note color',
  command: 'command',
  height: 'note height',
  instructions: 'instructions',
  message: 'result message',
  preset: 'agent preset',
  systemPrompt: 'system prompt',
  text: 'note text',
  timeoutMs: 'timeout',
  width: 'note width',
  workingDirectory: 'working directory',
};

function nodeName(node: FlowNode | undefined, fallback = 'block'): string {
  if (!node) return fallback;
  if ('name' in node.config && node.config.name) return node.config.name;
  if (node.type === 'note' && node.config.text) return node.config.text.length > 42 ? `${node.config.text.slice(0, 39)}…` : node.config.text;
  return typeMeta[node.type].label;
}

function humanizeOutcome(outcome: string): string {
  return outcome.replaceAll('_', ' ');
}

function configFieldLabel(field: string): string {
  return configFieldLabels[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

export function getVersionChanges(current: FlowDefinition, previous?: FlowDefinition): VersionChange[] {
  if (!previous) return [{
    kind: 'initial',
    title: 'Created the first version',
    detail: `${current.nodes.length} block${current.nodes.length === 1 ? '' : 's'} · ${current.connections.length} connection${current.connections.length === 1 ? '' : 's'}`,
  }];

  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const changes: VersionChange[] = [];

  current.nodes.filter((node) => !previousNodes.has(node.id)).forEach((node) => changes.push({
    kind: 'added', title: `Added ${typeMeta[node.type].label} block`, detail: nodeName(node), blockType: node.type,
  }));
  previous.nodes.filter((node) => !currentNodes.has(node.id)).forEach((node) => changes.push({
    kind: 'removed', title: `Removed ${typeMeta[node.type].label} block`, detail: nodeName(node), blockType: node.type,
  }));

  current.nodes.forEach((node) => {
    const before = previousNodes.get(node.id);
    if (!before) return;
    if (before.type !== node.type) {
      changes.push({ kind: 'changed', title: `Changed ${nodeName(before)} to a ${typeMeta[node.type].label} block`, blockType: node.type });
      return;
    }
    const beforeName = nodeName(before);
    const afterName = nodeName(node);
    if ('name' in before.config && 'name' in node.config && beforeName !== afterName) {
      changes.push({ kind: 'changed', title: `Renamed ${beforeName} to ${afterName}`, blockType: node.type });
    }
    const beforeConfig = before.config as Record<string, unknown>;
    const afterConfig = node.config as Record<string, unknown>;
    const fields = new Set([...Object.keys(beforeConfig), ...Object.keys(afterConfig)]);
    fields.delete('name');
    fields.forEach((field) => {
      if (JSON.stringify(beforeConfig[field]) !== JSON.stringify(afterConfig[field])) {
        changes.push({ kind: 'changed', title: `Changed ${configFieldLabel(field)}`, detail: `On ${afterName}`, blockType: node.type });
      }
    });
  });

  const currentConnections = new Map(current.connections.map((connection) => [connection.id, connection]));
  const previousConnections = new Map(previous.connections.map((connection) => [connection.id, connection]));
  current.connections.forEach((connection) => {
    const before = previousConnections.get(connection.id);
    const source = nodeName(currentNodes.get(connection.sourceNodeId), connection.sourceNodeId);
    const target = nodeName(currentNodes.get(connection.targetNodeId), connection.targetNodeId);
    if (!before) {
      changes.push({ kind: 'connected', title: `Connected ${source}`, detail: `${humanizeOutcome(connection.sourceOutcomeId)} → ${target}` });
      return;
    }
    if (JSON.stringify(before) !== JSON.stringify(connection)) {
      const beforeSource = nodeName(previousNodes.get(before.sourceNodeId), before.sourceNodeId);
      const beforeTarget = nodeName(previousNodes.get(before.targetNodeId), before.targetNodeId);
      changes.push({ kind: 'changed', title: `Changed connection from ${source}`, detail: `${beforeSource}: ${humanizeOutcome(before.sourceOutcomeId)} → ${beforeTarget}; now ${humanizeOutcome(connection.sourceOutcomeId)} → ${target}` });
    }
  });
  previous.connections.filter((connection) => !currentConnections.has(connection.id)).forEach((connection) => {
    const source = nodeName(previousNodes.get(connection.sourceNodeId), connection.sourceNodeId);
    const target = nodeName(previousNodes.get(connection.targetNodeId), connection.targetNodeId);
    changes.push({ kind: 'disconnected', title: `Removed connection from ${source}`, detail: `${humanizeOutcome(connection.sourceOutcomeId)} → ${target}` });
  });

  return changes;
}

// Layout is not behaviour, so moving a block is never a history entry. The panel still reports it as
// context when a draft differs from the published version by position alone.
export function hasLayoutChange(current: FlowDefinition, previous?: FlowDefinition): boolean {
  if (!previous) return false;
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  return current.nodes.some((node) => {
    const before = previousNodes.get(node.id);
    return before !== undefined && (before.position.x !== node.position.x || before.position.y !== node.position.y);
  });
}

export function formatActionTimestamp(timestamp: string | undefined) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return 'Just now';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}

function SemanticSummary({ type, name }: { type: FlowNode['type']; name: string }) {
  return <span className={`node-zoom-summary type-${type}`} aria-hidden="true">
    <span className="node-zoom-icon" data-block-icon={type}><BlockIcon type={type} /></span>
    <span className="node-zoom-copy"><em>{typeMeta[type].label}</em><strong>{name}</strong></span>
  </span>;
}

function BlockNode({ data, selected }: NodeProps<CanvasNode>) {
  const flowNode = data.flowNode;
  if (flowNode.type === 'note') {
    const text = flowNode.config.text || 'Note';
    return <div className={`canvas-note ${flowNode.config.color} ${selected ? 'selected' : ''}`} title={`Note: ${text}`} aria-label={`Note: ${text}`}>
      <span className="note-content">{text}</span>
      <SemanticSummary type="note" name={text} />
    </div>;
  }
  const outcomes = getNodeOutcomes(flowNode);
  const name = 'name' in flowNode.config ? flowNode.config.name : flowNode.type;
  const nodeHeight = FLOW_NODE_HEIGHTS[flowNode.type];
  const outcomeRows = outcomes.map((outcome, index) => ({ outcome, top: connectorSourcePortTop(index, outcomes.length, nodeHeight) }));
  return <div className={`canvas-node type-${flowNode.type} ${selected ? 'selected' : ''}`} title={`${typeMeta[flowNode.type].label}: ${name}`} aria-label={`${typeMeta[flowNode.type].label} block: ${name}`}>
    {flowNode.type !== 'begin' && <Handle id="input" type="target" position={Position.Left} className="input-handle" style={{ top: '50%' }} />}
    {outcomeRows.map(({ outcome, top }) => <Handle key={outcome} id={outcome} type="source" position={Position.Right} className="output-handle" style={{ top: `${top}%` }} />)}
    <div className="node-cap"><span><BlockIcon type={flowNode.type} /></span><em>{typeMeta[flowNode.type].label}</em></div>
    <strong>{name}</strong>
    {flowNode.type === 'agent' && <small className="node-detail">{flowNode.config.preset.replace('-', ' ')}</small>}
    {flowNode.type === 'check' && <code className="node-detail">{flowNode.config.command || 'No command yet'}</code>}
    {flowNode.type === 'result' && <small className="node-detail">{flowNode.config.category}</small>}
    <div className="node-outcomes" style={{ '--outcome-count': outcomeRows.length } as CSSProperties}>{outcomeRows.map(({ outcome, top }) => <span key={outcome} className="node-outcome-row" style={{ top: `${top}%` }}><span className="node-outcome-label">{outcome.replace('_', ' ')}</span></span>)}</div>
    <SemanticSummary type={flowNode.type} name={name} />
  </div>;
}

const nodeTypes = { flowBlock: BlockNode };

function FlowConnector({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, markerStart, style, interactionWidth, data }: EdgeProps) {
  const routedPath = typeof data?.routePath === 'string' ? data.routePath : null;
  const path = routedPath ?? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} markerStart={markerStart} style={style} interactionWidth={interactionWidth} />;
}

const edgeTypes = { flowConnector: FlowConnector };

function routeCanvasGraph(nodes: CanvasNode[], edges: Edge[]): { nodes: CanvasNode[]; edges: Edge[] } {
  const plan = routeFlowConnectors(nodes.map((node) => {
    const flowNode = node.data.flowNode;
    return {
      id: node.id,
      position: node.position,
      width: flowNode.type === 'note' ? flowNode.config.width ?? 220 : FLOW_LAYOUT_NODE_WIDTH,
      height: flowNode.type === 'note' ? flowNode.config.height ?? 120 : FLOW_NODE_HEIGHTS[flowNode.type],
      flowNode,
    };
  }), edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target })));

  let edgesChanged = false;
  const nextEdges = edges.map((edge) => {
    const route = plan.routes.get(edge.id);
    if (!route) return edge;
    if (edge.targetHandle === route.targetHandle && edge.data?.routePath === route.path) return edge;
    edgesChanged = true;
    return { ...edge, targetHandle: route.targetHandle, data: { ...edge.data, routePath: route.path } };
  });
  return { nodes, edges: edgesChanged ? nextEdges : edges };
}

export function toCanvas(definition: FlowDefinition): { nodes: CanvasNode[]; edges: Edge[] } {
  const nodes = definition.nodes.map((flowNode) => ({ id: flowNode.id, type: 'flowBlock' as const, position: flowNode.position, data: { flowNode }, style: flowNode.type === 'note' ? { width: flowNode.config.width ?? 220, height: flowNode.config.height ?? 120 } : { height: FLOW_NODE_HEIGHTS[flowNode.type] } }));
  const edges = definition.connections.map((connection) => ({ id: connection.id, source: connection.sourceNodeId, sourceHandle: connection.sourceOutcomeId, target: connection.targetNodeId, type: 'flowConnector', animated: false }));
  return routeCanvasGraph(nodes, edges);
}

/**
 * Produces a deterministic left-to-right topology without adding a layout
 * dependency. Back edges keep their source rank, so review loops remain easy
 * to trace while the primary path stays forward-facing.
 */
export function createFlowAutoLayout(definition: FlowDefinition): Map<string, { x: number; y: number }> {
  const executableNodes = definition.nodes.filter((node): node is Exclude<FlowNode, { type: 'note' }> => node.type !== 'note');
  const notes = definition.nodes.filter((node) => node.type === 'note');
  const nodeById = new Map(executableNodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const connectionsBySource = new Map<string, FlowDefinition['connections']>();
  const incomingCount = new Map(executableNodes.map((node) => [node.id, 0]));

  for (const connection of definition.connections) {
    if (!nodeById.has(connection.sourceNodeId) || !nodeById.has(connection.targetNodeId)) continue;
    const targets = outgoing.get(connection.sourceNodeId) ?? [];
    targets.push(connection.targetNodeId);
    outgoing.set(connection.sourceNodeId, targets);
    const sourceConnections = connectionsBySource.get(connection.sourceNodeId) ?? [];
    sourceConnections.push(connection);
    connectionsBySource.set(connection.sourceNodeId, sourceConnections);
    incomingCount.set(connection.targetNodeId, (incomingCount.get(connection.targetNodeId) ?? 0) + 1);
  }

  const primaryOutcomes = ['started', 'completed', 'passed', 'approved'];
  const primaryPath = new Set<string>();
  let primaryCursor = executableNodes.find((node) => node.type === 'begin')?.id;
  while (primaryCursor && !primaryPath.has(primaryCursor)) {
    primaryPath.add(primaryCursor);
    const candidates = connectionsBySource.get(primaryCursor) ?? [];
    const next = [...candidates].sort((a, b) => {
      const aPriority = primaryOutcomes.indexOf(a.sourceOutcomeId);
      const bPriority = primaryOutcomes.indexOf(b.sourceOutcomeId);
      return (aPriority < 0 ? primaryOutcomes.length : aPriority) - (bPriority < 0 ? primaryOutcomes.length : bPriority);
    })[0];
    primaryCursor = next?.targetNodeId;
  }

  const ranks = new Map<string, number>();
  const queue: string[] = [];
  const enqueue = (id: string, rank: number) => {
    if (ranks.has(id)) return;
    ranks.set(id, rank);
    queue.push(id);
  };

  for (const node of executableNodes) if (node.type === 'begin') enqueue(node.id, 0);
  for (const node of executableNodes) if ((incomingCount.get(node.id) ?? 0) === 0) enqueue(node.id, 0);

  let cursor = 0;
  const drainQueue = () => {
    while (cursor < queue.length) {
      const id = queue[cursor++];
      const nextRank = (ranks.get(id) ?? 0) + 1;
      for (const targetId of outgoing.get(id) ?? []) enqueue(targetId, nextRank);
    }
  };
  drainQueue();

  for (const node of executableNodes) {
    if (ranks.has(node.id)) continue;
    enqueue(node.id, Math.max(0, ...ranks.values()) + 1);
    drainQueue();
  }

  const columns = new Map<number, FlowNode[]>();
  for (const node of executableNodes) {
    const rank = ranks.get(node.id) ?? 0;
    const column = columns.get(rank) ?? [];
    column.push(node);
    columns.set(rank, column);
  }

  const positions = new Map<string, { x: number; y: number }>();
  let graphBottom = FLOW_LAYOUT_MARGIN;
  for (const [rank, column] of [...columns.entries()].sort(([a], [b]) => a - b)) {
    let y = FLOW_LAYOUT_MARGIN;
    const orderedColumn = [...column].sort((a, b) => Number(primaryPath.has(b.id)) - Number(primaryPath.has(a.id)));
    for (const node of orderedColumn) {
      if (node.type === 'note') continue;
      positions.set(node.id, { x: FLOW_LAYOUT_MARGIN + rank * (FLOW_LAYOUT_NODE_WIDTH + FLOW_LAYOUT_COLUMN_GAP), y });
      y += FLOW_NODE_HEIGHTS[node.type] + FLOW_LAYOUT_ROW_GAP;
    }
    graphBottom = Math.max(graphBottom, y - FLOW_LAYOUT_ROW_GAP);
  }

  let noteX = FLOW_LAYOUT_MARGIN;
  for (const note of notes) {
    const width = note.config.width ?? 220;
    positions.set(note.id, { x: noteX, y: graphBottom + FLOW_LAYOUT_NOTE_GAP });
    noteX += width + FLOW_LAYOUT_NOTE_GAP;
  }

  return positions;
}

function definitionFrom(nodes: CanvasNode[], edges: Edge[], viewport?: FlowDefinition['viewport']): FlowDefinition {
  return {
    schemaVersion: 1,
    nodes: nodes.map((node) => ({ ...node.data.flowNode, position: node.position } as FlowNode)),
    connections: edges.map((edge) => ({ id: edge.id, sourceNodeId: edge.source, sourceOutcomeId: edge.sourceHandle ?? 'completed', targetNodeId: edge.target })),
    viewport,
  };
}

function uniqueId(type: string): string {
  return `${type}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
}

export function agentConfigFromPreset(preset: AgentPreset, name = preset.name) {
  return { name, preset: preset.preset_key };
}

function makeNode(type: FlowNode['type'], x: number, y: number, agentPresets: AgentPreset[] = []): FlowNode {
  const base = { id: uniqueId(type), typeVersion: 1 as const, position: { x, y } };
  switch (type) {
    case 'begin': return { ...base, type, config: { name: 'Begin' } };
    case 'agent': {
      const preset = agentPresets.find((candidate) => candidate.preset_key === 'development') ?? agentPresets[0];
      return { ...base, type, config: preset ? agentConfigFromPreset(preset) : createAgentConfig('development', 'Development') };
    }
    case 'check': return { ...base, type, config: { name: 'Project checks', command: 'bun run test', workingDirectory: '.', timeoutMs: 180000 } };
    case 'decision': return { ...base, type, config: { name: 'Review', instructions: '', choices: [{ id: 'approved', label: 'Approved', commentRequired: false, tone: 'positive' }, { id: 'changes', label: 'Changes requested', commentRequired: true, tone: 'warning' }] } };
    case 'result': return { ...base, type, config: { name: 'Completed', category: 'completed', message: '' } };
    case 'note': return { ...base, type, config: { text: 'Add context for collaborators…', color: 'amber', width: 220, height: 120 } };
  }
}

function PanelCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="icon-button editor-panel-close" aria-label={label} onClick={onClick}><Icon name="close" size={17} /></button>;
}

function BlockPalette({ nodes, open, add }: { nodes: CanvasNode[]; open: boolean; add: (type: FlowNode['type']) => void }) {
  return <aside id="flow-block-library" className={`palette editor-panel ${open ? 'panel-open' : ''}`} aria-label="Block library">
    <header className="editor-panel-head"><div><span className="eyebrow">BLOCK LIBRARY</span><strong>Add to canvas</strong></div></header>
    {(Object.keys(typeMeta) as FlowNode['type'][]).map((type) => <button type="button" key={type} draggable onClick={() => add(type)} onDragStart={(event) => { event.dataTransfer.setData('application/flow-block', type); event.dataTransfer.effectAllowed = 'move'; }} disabled={type === 'begin' && nodes.some((node) => node.data.flowNode.type === 'begin')} aria-label={`Add ${typeMeta[type].label} block`}><span className={type}><BlockIcon type={type} /></span><div><strong>{typeMeta[type].label}</strong><small>{typeMeta[type].description}</small></div></button>)}
    <div className="palette-tip"><strong>Click or drag</strong><p>Click to place a block in view, or drag it to an exact canvas position.</p></div>
  </aside>;
}

function Inspector({ node, nodes, edges, presets, open, update, connectOutcome, remove, close, openAgent }: { node: CanvasNode; nodes: CanvasNode[]; edges: Edge[]; presets: AgentPreset[]; open: boolean; update: (next: FlowNode) => void; connectOutcome: (outcome: string, target: string) => void; remove: () => void; close: () => void; openAgent: (presetKey: string) => void }) {
  const flowNode = node.data.flowNode;
  const config: any = flowNode.config;
  const patch = (changes: any) => update({ ...flowNode, config: { ...flowNode.config, ...changes } } as FlowNode);
  const selectedPreset = flowNode.type === 'agent' ? presets.find((preset) => preset.preset_key === config.preset) : undefined;
  const presetMissing = flowNode.type === 'agent' && presets.length > 0 && !selectedPreset;
  const executableTargets = nodes.filter((candidate) => candidate.id !== node.id && candidate.data.flowNode.type !== 'note' && candidate.data.flowNode.type !== 'begin');
  const agentOptions = [
    ...(presetMissing ? [{ value: config.preset as string, label: `${config.preset} · not in library` }] : []),
    ...presets.map((preset) => ({ value: preset.preset_key, label: preset.name })),
  ];
  const connectionOptions = [
    { value: '', label: 'Not connected' },
    ...executableTargets.map((target) => ({ value: target.id, label: 'name' in target.data.flowNode.config ? target.data.flowNode.config.name : target.id })),
  ];
  return <aside id="flow-block-inspector" className={`inspector editor-panel ${open ? 'panel-open' : ''}`} aria-label="Block inspector">
    <header><div><span className={`block-glyph ${flowNode.type}`}><BlockIcon type={flowNode.type} /></span><div><span className="eyebrow">{typeMeta[flowNode.type].label.toUpperCase()} BLOCK</span><h3>{config.name || typeMeta[flowNode.type].label}</h3></div></div><PanelCloseButton label="Close block inspector" onClick={close} /></header>
    <div className="inspector-scroll">
      {flowNode.type !== 'note' && <label>Name<input value={config.name} onChange={(e) => patch({ name: e.target.value })} /></label>}
      {flowNode.type === 'agent' && <>
        <SelectionMenu label="Agent" value={config.preset} options={agentOptions} onChange={(value) => patch({ preset: value })} className="form-selection inspector-selection" />
        <div className="agent-block-summary">
          {selectedPreset?.description ? <p>{selectedPreset.description}</p> : presetMissing
            ? <p className="agent-block-note">This agent is no longer in the library. Pick another so the block can run.</p>
            : <p className="agent-block-note">This agent runs with its current prompt from the Agents tab.</p>}
          <button type="button" className="agent-block-open" onClick={() => openAgent(config.preset)}><Icon name="agent" size={13} />{presetMissing ? 'Open Agents tab' : 'Edit agent'}</button>
        </div>
      </>}
      {flowNode.type === 'check' && <>
        <label>Command<input className="mono" value={config.command} onChange={(e) => patch({ command: e.target.value })} /></label>
        <label>Working directory<input className="mono" value={config.workingDirectory} onChange={(e) => patch({ workingDirectory: e.target.value })} /></label>
        <label>Timeout (seconds)<input type="number" min="1" value={config.timeoutMs / 1000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) * 1000 })} /></label>
      </>}
      {flowNode.type === 'decision' && <>
        <label>Review prompt<textarea value={config.instructions ?? ''} onChange={(e) => patch({ instructions: e.target.value })} /></label>
        <fieldset><legend>Choices</legend>{config.choices.map((choice: any, index: number) => <div className="choice-editor" key={choice.id}><input value={choice.label} onChange={(e) => patch({ choices: config.choices.map((item: any, i: number) => i === index ? { ...item, label: e.target.value } : item) })} /><label className="mini-check"><input type="checkbox" checked={choice.commentRequired} onChange={(e) => patch({ choices: config.choices.map((item: any, i: number) => i === index ? { ...item, commentRequired: e.target.checked } : item) })} />Require comment</label></div>)}{config.choices.length < 5 && <button className="text-button" onClick={() => patch({ choices: [...config.choices, { id: uniqueId('choice'), label: 'Another choice', commentRequired: false, tone: 'neutral' }] })}>+ Add choice</button>}</fieldset>
      </>}
      {flowNode.type === 'result' && <><SelectionMenu label="Result category" value={config.category} options={resultCategoryOptions} onChange={(value) => patch({ category: value })} className="form-selection inspector-selection" /><label>Message<textarea value={config.message ?? ''} onChange={(e) => patch({ message: e.target.value })} /></label></>}
      {flowNode.type === 'note' && <><label>Note<textarea value={config.text} onChange={(e) => patch({ text: e.target.value })} /></label><SelectionMenu label="Color" value={config.color} options={noteColorOptions} onChange={(value) => patch({ color: value })} className="form-selection inspector-selection" /></>}
      {flowNode.type !== 'result' && flowNode.type !== 'note' && <fieldset className="connections"><legend>Outcome connections</legend><p>Keyboard-accessible alternative to drawing wires.</p>{getNodeOutcomes(flowNode).map((outcome) => <div className="connection-field" key={outcome}><span>{outcome.replace('_', ' ')}</span><SelectionMenu label={`Connect ${outcome}`} value={edges.find((edge) => edge.source === node.id && edge.sourceHandle === outcome)?.target ?? ''} options={connectionOptions} onChange={(value) => connectOutcome(outcome, value)} hideLabel className="inspector-selection" /></div>)}</fieldset>}
    </div>
    {flowNode.type !== 'begin' && <footer><button className="text-danger" onClick={remove}><Icon name="trash" size={15} />Delete block</button></footer>}
  </aside>;
}

function VersionChangeIcon({ change }: { change: VersionChange }) {
  if (change.blockType) return <BlockIcon type={change.blockType} size={15} />;
  const icon = change.kind === 'added' ? 'plus'
    : change.kind === 'removed' ? 'trash'
      : change.kind === 'connected' || change.kind === 'disconnected' ? 'branch'
        : change.kind === 'changed' ? 'edit'
          : 'history';
  return <Icon name={icon} size={15} />;
}

function VersionHistoryPanel({ open, title, comparisonLabel, comparisonName, subject, changes, layoutOnly, close }: { open: boolean; title: string; comparisonLabel: string; comparisonName: string; subject: string; changes: VersionChange[]; layoutOnly: boolean; close: () => void }) {
  return <aside id="flow-version-history" className={`version-history-panel editor-panel ${open ? 'panel-open' : ''}`} aria-label="Version history">
    <header><div><span className="block-glyph history"><Icon name="history" size={18} /></span><div><span className="eyebrow">VERSION HISTORY</span><h3>{title}</h3></div></div><PanelCloseButton label="Close version history" onClick={close} /></header>
    <div className="version-history-scroll">
      <div className="version-history-context"><strong>{changes.length} {changes.length === 1 ? 'change' : 'changes'}</strong><span>{comparisonLabel}</span></div>
      {changes.length ? <ol className="version-change-list">
        {changes.map((change, index) => <li key={`${change.kind}-${change.title}-${index}`} className={`change-${change.kind}`} data-block-type={change.blockType}>
          <span className="version-change-marker"><VersionChangeIcon change={change} /></span>
          <div><strong>{change.title}</strong><small>{formatActionTimestamp(change.timestamp)}</small></div>
        </li>)}
      </ol> : <div className="version-history-empty"><Icon name="check" size={19} />
        <strong>No changes to how this Flow runs</strong>
        <p>{layoutOnly ? `Only block positions differ from ${comparisonName}.` : `${subject} matches ${comparisonName}.`}</p>
      </div>}
    </div>
  </aside>;
}

function EditorCanvas({ flowId, versionId }: { flowId: number; versionId: number | null }) {
  const readOnly = versionId !== null;
  const flow = useAppStore((state) => state.flows.find((candidate) => candidate.id === flowId));
  const back = useAppStore((state) => state.editFlow);
  const viewFlowVersion = useAppStore((state) => state.viewFlowVersion);
  const openAgent = useAppStore((state) => state.openAgent);
  const refreshFlows = useAppStore((state) => state.refreshFlows);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [revision, setRevision] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [flowName, setFlowName] = useState(flow?.name ?? 'Flow');
  const [nameDraft, setNameDraft] = useState(flow?.name ?? 'Flow');
  const [renaming, setRenaming] = useState(false);
  const [renamingSaving, setRenamingSaving] = useState(false);
  const [openPanel, setOpenPanel] = useState<EditorPanel>(null);
  const [editorViewport, setEditorViewport] = useState<EditorViewport>(defaultViewport);
  const [viewportReady, setViewportReady] = useState(false);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [displayedVersion, setDisplayedVersion] = useState<FlowVersion | null>(null);
  const [draftVersionNumber, setDraftVersionNumber] = useState<number | null>(null);
  const [actionHistory, setActionHistory] = useState<VersionChange[]>([]);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const savedViewport = useRef<EditorViewport | null>(null);
  const viewportChangedByUser = useRef(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const { fitView, getViewport, screenToFlowPosition } = useReactFlow();
  const definition = useMemo(() => definitionFrom(nodes, edges, editorViewport), [nodes, edges, editorViewport]);
  // Validate against the current Agent library once it has loaded; before then, fall back to the
  // built-in defaults so seeded agents are not briefly flagged as missing.
  const knownAgentKeys = useMemo(() => agentPresets.length ? new Set(agentPresets.map((preset) => preset.preset_key)) : undefined, [agentPresets]);
  const validation = useMemo(() => validateFlow(definition, knownAgentKeys), [definition, knownAgentKeys]);
  const zoomMode = getFlowZoomMode(editorViewport.zoom);
  const changeSequence = useRef(0);
  const dirtyRef = useRef(false);
  const definitionRef = useRef(definition);
  const revisionRef = useRef(revision);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const actionDefinitionRef = useRef<FlowDefinition | null>(null);
  const pendingActionsRef = useRef<VersionChange[]>([]);
  definitionRef.current = definition;
  revisionRef.current = revision;

  const markDirty = useCallback(() => {
    changeSequence.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveStatus('unsaved');
  }, []);

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    void api.listAgentPresets().then(({ presets }) => { if (!cancelled) setAgentPresets(presets); }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? `Agent presets could not be loaded: ${error.message}` : 'Agent presets could not be loaded.');
    });
    return () => { cancelled = true; };
  }, [readOnly]);

  useEffect(() => {
    let cancelled = false;
    let viewportFrame = 0;
    setViewportReady(false);
    const request = readOnly
      ? api.getFlow(flowId).then(({ versions: availableVersions }) => {
        const selected = availableVersions.find((version) => version.id === versionId);
        if (!selected) throw new Error('Flow version not found.');
        setVersions(availableVersions.filter((version) => version.state !== 'draft').sort((a, b) => b.version - a.version));
        setDraftVersionNumber(availableVersions.find((version) => version.state === 'draft')?.version ?? null);
        setDisplayedVersion(selected);
        return selected;
      })
      : Promise.all([api.getDraft(flowId), api.getFlow(flowId)]).then(([{ draft }, { versions: availableVersions }]) => {
        setVersions(availableVersions.filter((version) => version.state !== 'draft').sort((a, b) => b.version - a.version));
        setDraftVersionNumber(draft.version);
        setDisplayedVersion(draft);
        return draft;
      });
    void request.then((draft) => {
      if (cancelled) return;
      const canvas = toCanvas(draft.definition);
      const nextViewport = draft.definition.viewport ?? defaultViewport;
      savedViewport.current = nextViewport;
      setEditorViewport(nextViewport);
      revisionRef.current = draft.draft_revision;
      actionDefinitionRef.current = draft.definition;
      pendingActionsRef.current = [];
      setActionHistory((draft.action_history ?? []) as VersionChange[]);
      dirtyRef.current = false;
      setNodes(canvas.nodes); setEdges(canvas.edges); setRevision(draft.draft_revision); setDirty(false); setSaveStatus('saved');
      viewportFrame = requestAnimationFrame(() => {
        void fitView({ padding: 0.12, duration: 0 });
        viewportFrame = requestAnimationFrame(() => {
          if (cancelled) return;
          const fittedViewport = getViewport();
          savedViewport.current = fittedViewport;
          setEditorViewport(fittedViewport);
          dirtyRef.current = false;
          setDirty(false);
          setSaveStatus('saved');
          setViewportReady(true);
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(viewportFrame); };
  }, [fitView, flowId, getViewport, readOnly, setEdges, setNodes, versionId]);

  useEffect(() => {
    if (renaming) return;
    const nextName = flow?.name ?? 'Flow';
    setFlowName(nextName);
    setNameDraft(nextName);
  }, [flow?.name, renaming]);

  useEffect(() => {
    if (!renaming) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming]);

  useEffect(() => {
    if (!openPanel) return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [openPanel]);

  useEffect(() => {
    const previous = actionDefinitionRef.current;
    actionDefinitionRef.current = definition;
    if (readOnly || !previous) return;
    const timestamp = new Date().toISOString();
    const actions = getVersionChanges(definition, previous).map((change) => ({ ...change, timestamp }));
    if (!actions.length) return;
    setActionHistory((current) => [...current, ...actions]);
    pendingActionsRef.current = [...pendingActionsRef.current, ...actions];
  }, [definition, readOnly]);

  useEffect(() => {
    const routed = routeCanvasGraph(nodes, edges);
    if (routed.nodes !== nodes) setNodes(routed.nodes);
    if (routed.edges !== edges) setEdges(routed.edges);
  }, [edges, nodes, setEdges, setNodes]);

  const changeNodes = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    if (changes.some((change) => ['position', 'remove', 'add', 'replace'].includes(change.type))) markDirty();
  }, [markDirty, onNodesChange]);
  const changeEdges = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    onEdgesChange(changes);
    if (changes.some((change) => change.type !== 'select')) markDirty();
  }, [markDirty, onEdgesChange]);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle) return;
    setEdges((current) => addEdge({ ...connection, id: uniqueId('connection'), type: 'flowConnector' }, current.filter((edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)))); markDirty();
  }, [markDirty, setEdges]);
  const insertNode = useCallback((type: FlowNode['type'], position: { x: number; y: number }) => {
    if (type === 'begin' && nodes.some((node) => node.data.flowNode.type === 'begin')) return;
    const flowNode = makeNode(type, position.x, position.y, agentPresets);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id: flowNode.id, type: 'flowBlock', position, data: { flowNode }, style: flowNode.type === 'note' ? { width: flowNode.config.width ?? 220, height: flowNode.config.height ?? 120 } : { height: FLOW_NODE_HEIGHTS[flowNode.type] }, selected: true }]);
    setSelectedId(flowNode.id);
    setOpenPanel(null);
    markDirty();
  }, [agentPresets, markDirty, nodes, setNodes]);
  const addFromPalette = useCallback((type: FlowNode['type']) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const offset = (nodes.length % 4) * 24;
    const screenPosition = bounds
      ? { x: bounds.left + bounds.width / 2 + offset, y: bounds.top + bounds.height / 2 + offset }
      : { x: window.innerWidth / 2 + offset, y: window.innerHeight / 2 + offset };
    insertNode(type, screenToFlowPosition(screenPosition));
  }, [insertNode, nodes.length, screenToFlowPosition]);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); const type = event.dataTransfer.getData('application/flow-block') as FlowNode['type'];
    if (!type) return;
    insertNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const updateSelected = (next: FlowNode) => { setNodes((current) => current.map((node) => node.id === next.id ? { ...node, data: { flowNode: next } } : node)); markDirty(); };
  const selected = nodes.find((node) => node.id === selectedId);
  const inspectorVisible = selected !== undefined && openPanel === 'inspector';
  const connectOutcome = (outcome: string, target: string) => {
    if (!selected) return;
    setEdges((current) => {
      const remaining = current.filter((edge) => !(edge.source === selected.id && edge.sourceHandle === outcome));
      return target ? [...remaining, { id: uniqueId('connection'), source: selected.id, sourceHandle: outcome, target, type: 'flowConnector' }] : remaining;
    }); markDirty();
  };
  const removeSelected = () => { if (!selected) return; setNodes((current) => current.filter((node) => node.id !== selected.id)); setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedId(null); setOpenPanel(null); markDirty(); };
  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
    setSelectedId(null);
    setOpenPanel(null);
  }, [setNodes]);
  const autoArrange = useCallback(() => {
    const positions = createFlowAutoLayout(definitionRef.current);
    if (positions.size === 0) return;
    const arrangedNodes = nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    });
    const routed = routeCanvasGraph(arrangedNodes, edges);
    setNodes(routed.nodes);
    setEdges(routed.edges);
    markDirty();
    requestAnimationFrame(() => {
      void fitView({ padding: 0.16, duration: 220 }).then(() => setEditorViewport(getViewport()));
    });
  }, [edges, fitView, getViewport, markDirty, nodes, setEdges, setNodes]);
  const saveDraftNow = useCallback((): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!dirtyRef.current) return Promise.resolve(true);
    const savingSequence = changeSequence.current;
    const definitionToSave = definitionRef.current;
    const revisionToSave = revisionRef.current;
    const actionsToSave = pendingActionsRef.current;
    pendingActionsRef.current = [];
    setSaving(true);
    setSaveStatus('saving');
    const request = api.saveDraft(flowId, definitionToSave, revisionToSave, actionsToSave as FlowVersionAction[]).then((result) => {
      revisionRef.current = result.draft.draft_revision;
      setRevision(result.draft.draft_revision);
      setActionHistory([...(result.draft.action_history ?? []) as VersionChange[], ...pendingActionsRef.current]);
      savedViewport.current = definitionToSave.viewport ?? defaultViewport;
      if (changeSequence.current === savingSequence) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveStatus('saved');
      } else {
        setSaveStatus('unsaved');
      }
      return true;
    }).catch((error: any) => {
      pendingActionsRef.current = [...actionsToSave, ...pendingActionsRef.current];
      setSaveStatus('error');
      toast.error(error.data?.reason === 'revision_conflict' ? 'This draft changed elsewhere. Reload before editing again.' : `Autosave failed: ${error.message}`);
      return false;
    }).finally(() => {
      savePromiseRef.current = null;
      setSaving(false);
    });
    savePromiseRef.current = request;
    return request;
  }, [flowId]);
  const flushPendingSave = useCallback(async () => {
    while (dirtyRef.current || savePromiseRef.current) {
      if (!(await saveDraftNow())) return false;
    }
    return true;
  }, [saveDraftNow]);
  const openAgentInLibrary = useCallback((presetKey: string) => {
    void flushPendingSave().then((saved) => { if (saved) openAgent(presetKey); });
  }, [flushPendingSave, openAgent]);

  useEffect(() => {
    if (readOnly || !dirty || saving || saveStatus === 'error') return;
    const timer = window.setTimeout(() => { void saveDraftNow(); }, 600);
    return () => window.clearTimeout(timer);
  }, [definition, dirty, readOnly, saveDraftNow, saveStatus, saving]);

  const publish = async () => {
    if (!validation.valid) { toast.error('Resolve validation problems before publishing.'); return; }
    if (!(await flushPendingSave())) return;
    setPublishing(true);
    try {
      const result = await api.publishFlow(flowId);
      await refreshFlows();
      viewFlowVersion(flowId, result.version.id);
      toast.success(`Version v${result.version.version} is live. A new draft is ready to edit.`);
    }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not publish this Flow version.'); }
    finally { setPublishing(false); }
  };
  const commitName = async () => {
    if (renamingSaving) return;
    const name = nameDraft.trim();
    if (!name) { toast.error('Flow name is required.'); setNameDraft(flowName); return; }
    if (name === flowName) { setRenaming(false); return; }
    setRenamingSaving(true);
    try {
      const result = await api.updateFlow(flowId, { name });
      setFlowName(result.flow.name);
      setNameDraft(result.flow.name);
      setRenaming(false);
      await refreshFlows();
      toast.success('Flow name updated.');
    } catch (error: any) { toast.error(error.message); }
    finally { setRenamingSaving(false); }
  };

  const previousVersion = readOnly && displayedVersion
    ? versions.filter((version) => version.version < displayedVersion.version).sort((a, b) => b.version - a.version)[0]
    : undefined;
  const currentPublishedVersion = versions.find((version) => version.id === flow?.active_version_id)
    ?? versions.slice().sort((a, b) => b.version - a.version)[0];
  const comparisonVersion = readOnly ? previousVersion : currentPublishedVersion;
  const versionChanges = useMemo(() => getVersionChanges(definition, comparisonVersion?.definition), [comparisonVersion, definition]);
  const layoutOnly = useMemo(() => hasLayoutChange(definition, comparisonVersion?.definition), [comparisonVersion, definition]);
  const versionOptions = useMemo(() => [
    { value: 'draft', label: `${draftVersionNumber ? `Draft v${draftVersionNumber}` : 'Latest draft'} · edit` },
    ...versions.map((version) => ({ value: String(version.id), label: `v${version.version}${flow?.active_version_id === version.id ? ' · current' : ''}${version.published_at ? ` · ${new Date(version.published_at).toLocaleDateString()}` : ''}` })),
  ], [draftVersionNumber, flow?.active_version_id, versions]);
  const historyTitle = readOnly && displayedVersion ? `Changes in v${displayedVersion.version}` : 'Draft changes';
  const historyComparisonLabel = readOnly
    ? previousVersion ? `Compared with v${previousVersion.version}` : 'Initial published version'
    : currentPublishedVersion ? `Since current v${currentPublishedVersion.version}` : 'Before the first publication';
  // A published version is compared with the one before it. A draft is compared with whatever is
  // active, which is not necessarily its predecessor once an older version has been reactivated.
  const historySubject = readOnly ? 'This version' : 'This draft';
  const historyComparisonName = readOnly ? 'the previous version' : 'the current published version';
  const persistedHistory = readOnly ? (displayedVersion?.action_history ?? []) : actionHistory;
  const historyChanges = persistedHistory.length
    ? [...persistedHistory].reverse()
    : versionChanges.map((change) => ({ ...change, timestamp: readOnly ? displayedVersion?.published_at ?? displayedVersion?.created_at : undefined }));
  const draftSaveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Autosave failed' : dirty ? 'Unsaved changes' : 'Saved';
  const openLibrary = async () => {
    if (!readOnly && !(await flushPendingSave())) return;
    back(null);
  };
  const selectVersion = async (value: string) => {
    if (value === 'draft') { back(flowId); return; }
    if (!readOnly && !(await flushPendingSave())) return;
    viewFlowVersion(flowId, Number(value));
  };
  const selectedVersionIsCurrent = Boolean(readOnly && displayedVersion && displayedVersion.id === flow?.active_version_id);
  const activateVersion = async () => {
    if (!displayedVersion || selectedVersionIsCurrent || activating) return;
    setActivating(true);
    try {
      const result = await api.activateFlowVersion(flowId, displayedVersion.id);
      useAppStore.setState((state) => ({ flows: state.flows.map((item) => item.id === flowId ? { ...item, ...result.flow } : item) }));
      toast.success(`Version v${displayedVersion.version} is now current. Future runs will use it.`);
      void refreshFlows().catch((error) => {
        toast.error(error instanceof Error ? `Version activated, but the Flow list could not refresh: ${error.message}` : 'Version activated, but the Flow list could not refresh.');
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not activate this Flow version.');
    } finally {
      setActivating(false);
    }
  };

  return <div className={`editor-shell zoom-${zoomMode}${readOnly ? ' historical-view' : ''}`} data-zoom-mode={zoomMode} style={{ '--zoom-compensation': Math.min(1 / editorViewport.zoom, 1 / MIN_FLOW_ZOOM) } as CSSProperties}>
    <div className="editor-toolbar">
      <div className="editor-toolbar-context">
        <button className="back-button" aria-label="Flow library" onClick={() => void openLibrary()}><Icon name="back" size={15} /><span className="toolbar-nav-label">Library</span></button>
        <div className={`flow-title ${renaming ? 'is-editing' : ''}`}><span className="flow-symbol"><Icon name="nodes" size={17} /></span><div>{readOnly ? <strong>{flowName}</strong> : renaming ? <input ref={nameInputRef} className="flow-name-input" aria-label="Flow name" value={nameDraft} disabled={renamingSaving} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void commitName()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); setNameDraft(flowName); setRenaming(false); } }} /> : <button type="button" className="flow-name-button" aria-label={`Rename flow ${flowName}`} title="Rename flow" onClick={() => { setNameDraft(flowName); setRenaming(true); }}><strong>{flowName}</strong><Icon name="edit" size={13} /></button>}{!readOnly && <small className={`autosave-status ${saveStatus}`} aria-live="polite">{draftSaveLabel}</small>}</div></div>
        {!readOnly && <div className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}><span />{validation.valid ? 'Ready to publish' : `${validation.problems.length} issue${validation.problems.length === 1 ? '' : 's'}`}</div>}
      </div>
      <div className="editor-toolbar-actions">
        <button type="button" className={`button ghost editor-history-toggle ${openPanel === 'history' ? 'active' : ''}`} aria-label="Version history" title="Version history" aria-expanded={openPanel === 'history'} aria-controls="flow-version-history" onClick={() => setOpenPanel((current) => current === 'history' ? null : 'history')}><Icon name="history" size={18} /><span className="toolbar-history-label">History</span></button>
        <SelectionMenu label="Flow version" value={readOnly ? String(versionId) : 'draft'} options={versionOptions} onChange={(value) => void selectVersion(value)} hideLabel className="version-picker" />
        {readOnly ? !displayedVersion
          ? <button className="button primary editor-toolbar-action" data-toolbar-action="loading" disabled><Icon name="history" size={15} /><span className="toolbar-action-label">Loading…</span></button>
          : selectedVersionIsCurrent
            ? <button className="button primary editor-toolbar-action" data-toolbar-action="edit" onClick={() => back(flowId)}><Icon name="edit" size={15} /><span className="toolbar-action-label">Edit latest draft</span></button>
            : <button className="button primary editor-toolbar-action" data-toolbar-action={activating ? 'activating' : 'activate'} aria-label={activating ? 'Activating' : 'Activate'} title="Use this version for future runs" disabled={activating} onClick={() => void activateVersion()}><Icon name="check" size={15} /><span className="toolbar-action-label">{activating ? 'Activating…' : 'Activate'}</span></button>
          : <button className="button primary editor-toolbar-action" data-toolbar-action={publishing ? 'publishing' : 'publish'} aria-label={publishing ? 'Publishing version' : 'Publish version'} disabled={publishing || !validation.valid} onClick={() => void publish()}><Icon name="publish" size={15} /><span className="toolbar-action-label">{publishing ? 'Publishing…' : 'Publish version'}</span></button>}
      </div>
    </div>
    <div className="editor-main">
      {readOnly ? <div className="editor-read-only-indicator" role="status" aria-label="Read only"><Icon name="lock" size={15} /><span>Read only</span></div> : <><div className="canvas-edit-actions"><button type="button" className={`button ghost editor-palette-toggle ${openPanel === 'palette' ? 'active' : ''}`} aria-expanded={openPanel === 'palette'} aria-controls="flow-block-library" onClick={() => setOpenPanel((current) => current === 'palette' ? null : 'palette')}><Icon name="plus" size={15} />Blocks</button><button type="button" className="button ghost editor-canvas-action" aria-label="Automatically arrange flow" title="Arrange blocks into a compact flow" onClick={autoArrange}><Icon name="layout" size={15} />Arrange</button></div><BlockPalette nodes={nodes} open={openPanel === 'palette'} add={addFromPalette} /></>}
      <div ref={canvasRef} className="canvas-wrap" onDrop={readOnly ? undefined : onDrop} onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={readOnly ? undefined : changeNodes} onEdgesChange={readOnly ? undefined : changeEdges} onConnect={readOnly ? undefined : onConnect} onPaneClick={readOnly ? undefined : clearSelection} onNodeClick={readOnly ? undefined : (_, node) => { setSelectedId(node.id); setOpenPanel('inspector'); }} onSelectionChange={readOnly ? undefined : ({ nodes: selection }) => { setSelectedId(selection[0]?.id ?? null); }} onMoveStart={(event) => { if (!readOnly && event) viewportChangedByUser.current = true; }} onMoveEnd={(_, viewport) => { setEditorViewport(viewport); if (!readOnly && viewportChangedByUser.current && savedViewport.current && !sameViewport(savedViewport.current, viewport)) markDirty(); viewportChangedByUser.current = false; }} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable={!readOnly} minZoom={MIN_FLOW_ZOOM} maxZoom={1.6} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
          <Background color="#26332f" gap={24} size={1} />{viewportReady && <Controls showInteractive={false} onZoomIn={() => { viewportChangedByUser.current = true; }} onZoomOut={() => { viewportChangedByUser.current = true; }} onFitView={() => { viewportChangedByUser.current = true; }}><output className="flow-zoom-indicator" aria-label="Current canvas zoom" aria-live="polite">{Math.round(editorViewport.zoom * 100)}%</output></Controls>}<MiniMap pannable zoomable maskColor="rgba(5, 9, 8, 0.82)" nodeColor={(node) => ({ begin: '#69e0b1', agent: '#6ba5ff', check: '#d4e052', decision: '#ffb454', result: '#dc7eff', note: '#7e8a86' } as Record<string, string>)[(node.data as any).flowNode.type] ?? '#fff'} />
        </ReactFlow>
        {!readOnly && !validation.valid && <div className="validation-popover"><strong>Flow needs attention</strong>{validation.problems.slice(0, 4).map((problem) => <button key={`${problem.code}-${problem.nodeId}-${problem.connectionId}`} onClick={() => { if (problem.nodeId) { setSelectedId(problem.nodeId); setOpenPanel('inspector'); } }}><Icon name="alert" size={14} />{problem.message}</button>)}</div>}
      </div>
      {!readOnly && inspectorVisible && <Inspector node={selected} nodes={nodes} edges={edges} presets={agentPresets} open update={updateSelected} connectOutcome={connectOutcome} remove={removeSelected} close={() => setOpenPanel(null)} openAgent={openAgentInLibrary} />}
      <VersionHistoryPanel open={openPanel === 'history'} title={historyTitle} comparisonLabel={historyComparisonLabel} changes={historyChanges} layoutOnly={layoutOnly} comparisonName={historyComparisonName} subject={historySubject} close={() => setOpenPanel(null)} />
    </div>
  </div>;
}

export default function FlowEditor({ flowId, versionId = null }: { flowId: number; versionId?: number | null }) {
  return <ReactFlowProvider><EditorCanvas flowId={flowId} versionId={versionId} /></ReactFlowProvider>;
}
