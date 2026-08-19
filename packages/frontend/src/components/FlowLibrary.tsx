import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FlowDefinition, FlowNode } from '@flow/core';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { Flow } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import Button from './Button.js';
import ConfirmDialog from './ConfirmDialog.js';
import FlowComposer from './FlowComposer.js';
import { FlowPreviewSvg, Icon } from './Icon.js';
import PageHeader from './PageHeader.js';
import PageHeaderAction from './PageHeaderAction.js';

const PREVIEW_NODE_SIZE = 54;
const PREVIEW_ICON_SIZE = 30;
const PREVIEW_ARROW_SIZE = PREVIEW_ICON_SIZE / 2.5;
const PREVIEW_CONNECTION_WIDTH = PREVIEW_ICON_SIZE / 10;
const PREVIEW_PADDING = 34;
const PREVIEW_COLUMN_GAP = 94;
const PREVIEW_ROW_GAP = 82;
const PREVIEW_FEEDBACK_GAP = 20;
const PREVIEW_FEEDBACK_LANE_GAP = 24;
const PREVIEW_FEEDBACK_DOCK = 12;

interface PreviewConnectionPath {
  id: string;
  kind: 'forward' | 'feedback';
  path: string;
}

interface PreviewLayout {
  height: number;
  nodes: FlowNode[];
  paths: PreviewConnectionPath[];
  positions: Map<string, { x: number; y: number }>;
  width: number;
}

interface FeedbackLane {
  maxX: number;
  minX: number;
  y: number;
}

function createPreviewLayout(definition: FlowDefinition | undefined): PreviewLayout | null {
  const nodes = definition?.nodes.filter((node) => node.type !== 'note') ?? [];
  if (nodes.length === 0 || !definition) return null;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, FlowDefinition['connections']>();
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  for (const connection of definition.connections) {
    if (!nodeById.has(connection.sourceNodeId) || !nodeById.has(connection.targetNodeId)) continue;
    const connections = outgoing.get(connection.sourceNodeId) ?? [];
    connections.push(connection);
    outgoing.set(connection.sourceNodeId, connections);
    incomingCount.set(connection.targetNodeId, (incomingCount.get(connection.targetNodeId) ?? 0) + 1);
  }

  const ranks = new Map<string, number>();
  const orderedNodes: FlowNode[] = [];
  const queue: FlowNode[] = [];
  const roots: FlowNode[] = nodes.filter((node) => node.type === 'begin');
  roots.push(...nodes.filter((node) => node.type !== 'begin' && incomingCount.get(node.id) === 0));
  for (const root of roots) {
    if (ranks.has(root.id)) continue;
    ranks.set(root.id, 0);
    queue.push(root);
  }

  const drainQueue = () => {
    while (queue.length > 0) {
      const node = queue.shift()!;
      orderedNodes.push(node);
      const nextRank = (ranks.get(node.id) ?? 0) + 1;
      for (const connection of outgoing.get(node.id) ?? []) {
        if (ranks.has(connection.targetNodeId)) continue;
        ranks.set(connection.targetNodeId, nextRank);
        queue.push(nodeById.get(connection.targetNodeId)!);
      }
    }
  };
  drainQueue();

  for (const node of nodes) {
    if (ranks.has(node.id)) continue;
    const nextRootRank = Math.max(0, ...ranks.values()) + 1;
    ranks.set(node.id, nextRootRank);
    queue.push(node);
    drainQueue();
  }

  const columns = new Map<number, FlowNode[]>();
  for (const node of orderedNodes) {
    const rank = ranks.get(node.id) ?? 0;
    const column = columns.get(rank) ?? [];
    column.push(node);
    columns.set(rank, column);
  }

  const positions = new Map<string, { x: number; y: number }>();
  let maxRank = 0;
  let maxRows = 1;
  for (const [rank, column] of columns) {
    maxRank = Math.max(maxRank, rank);
    maxRows = Math.max(maxRows, column.length);
    column.forEach((node, row) => {
      positions.set(node.id, {
        x: PREVIEW_PADDING + rank * PREVIEW_COLUMN_GAP,
        y: PREVIEW_PADDING + row * PREVIEW_ROW_GAP,
      });
    });
  }

  const nodeBottom = PREVIEW_PADDING + (maxRows - 1) * PREVIEW_ROW_GAP + PREVIEW_NODE_SIZE;
  const paths: PreviewConnectionPath[] = [];
  const feedbackLanes: FeedbackLane[] = [];
  let feedbackIndex = 0;
  let pathBottom = nodeBottom;
  for (const connection of definition.connections) {
    const source = positions.get(connection.sourceNodeId);
    const target = positions.get(connection.targetNodeId);
    if (!source || !target) continue;

    const sourceRank = ranks.get(connection.sourceNodeId) ?? 0;
    const targetRank = ranks.get(connection.targetNodeId) ?? 0;
    if (targetRank > sourceRank) {
      const sourceX = source.x + PREVIEW_NODE_SIZE;
      const sourceY = source.y + PREVIEW_NODE_SIZE / 2;
      const targetX = target.x;
      const targetY = target.y + PREVIEW_NODE_SIZE / 2;
      const middleX = sourceX + (targetX - sourceX) / 2;
      const path = sourceY === targetY
        ? `M ${sourceX} ${sourceY} H ${targetX}`
        : `M ${sourceX} ${sourceY} H ${middleX} V ${targetY} H ${targetX}`;
      paths.push({ id: connection.id, kind: 'forward', path });
      continue;
    }

    const sourceCenterX = source.x + PREVIEW_NODE_SIZE / 2;
    const sourceExitX = source.x + PREVIEW_NODE_SIZE + PREVIEW_FEEDBACK_DOCK + feedbackIndex * 3;
    const targetCenterX = target.x + PREVIEW_NODE_SIZE / 2;
    const laneMinX = Math.min(sourceExitX, targetCenterX);
    const laneMaxX = Math.max(sourceExitX, targetCenterX);
    let loopY = Math.max(source.y, target.y) + PREVIEW_NODE_SIZE + PREVIEW_FEEDBACK_GAP;
    while (feedbackLanes.some((lane) => lane.y === loopY && laneMinX < lane.maxX && laneMaxX > lane.minX)) {
      loopY += PREVIEW_FEEDBACK_LANE_GAP;
    }
    feedbackLanes.push({ maxX: laneMaxX, minX: laneMinX, y: loopY });
    pathBottom = Math.max(pathBottom, loopY);
    feedbackIndex += 1;
    paths.push({
      id: connection.id,
      kind: 'feedback',
      path: `M ${sourceCenterX} ${source.y + PREVIEW_NODE_SIZE} H ${sourceExitX} V ${loopY} H ${targetCenterX} V ${target.y + PREVIEW_NODE_SIZE}`,
    });
  }

  return {
    height: pathBottom + PREVIEW_PADDING,
    nodes,
    paths,
    positions,
    width: PREVIEW_PADDING * 2 + maxRank * PREVIEW_COLUMN_GAP + PREVIEW_NODE_SIZE,
  };
}

function PreviewGraph({ definition }: { definition: FlowDefinition | undefined }) {
  const markerId = useId().replaceAll(':', '');
  const layout = useMemo(() => createPreviewLayout(definition), [definition]);
  if (!layout) return <div className="flow-mini flow-mini-empty" aria-hidden="true">No blocks yet</div>;

  return <div className="flow-mini" aria-hidden="true">
    <FlowPreviewSvg
      arrowSize={PREVIEW_ARROW_SIZE}
      connectionWidth={PREVIEW_CONNECTION_WIDTH}
      height={layout.height}
      iconSize={PREVIEW_ICON_SIZE}
      markerId={markerId}
      nodeSize={PREVIEW_NODE_SIZE}
      nodes={layout.nodes.map((node) => ({ ...layout.positions.get(node.id)!, id: node.id, type: node.type }))}
      paths={layout.paths}
      width={layout.width}
    />
  </div>;
}

export default function FlowLibrary() {
  const { flows, editFlow, refreshFlows } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingFlowId, setDuplicatingFlowId] = useState<number | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editingNameFor === null) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingNameFor]);
  const create = async (name: string) => {
    const { flow } = await api.createFlow(name);
    editFlow(flow.id);
    void refreshFlows().catch((error) => {
      toast.error(error instanceof Error ? `Flow created, but the library could not refresh: ${error.message}` : 'Flow created, but the library could not refresh.');
    });
  };
  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteFlow(deleteTarget.id);
      setDeleteTarget(null);
      await refreshFlows();
      toast.success(`Deleted ${deleteTarget.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the Flow.');
    } finally {
      setDeleting(false);
    }
  };
  const duplicate = async (flow: Flow) => {
    if (duplicatingFlowId !== null) return;
    setDuplicatingFlowId(flow.id);
    try {
      const { flow: duplicate } = await api.duplicateFlow(flow.id);
      editFlow(duplicate.id);
      void refreshFlows().catch((error) => {
        toast.error(error instanceof Error ? `Flow duplicated, but the library could not refresh: ${error.message}` : 'Flow duplicated, but the library could not refresh.');
      });
      toast.success(`Created ${duplicate.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not duplicate the Flow.');
    } finally {
      setDuplicatingFlowId(null);
    }
  };
  const beginRename = (flow: Flow) => {
    setNameDraft(flow.name);
    setEditingNameFor(flow.id);
  };
  const cancelRename = () => {
    setEditingNameFor(null);
    setNameDraft('');
  };
  const commitRename = async (flow: Flow) => {
    if (renaming) return;
    const name = nameDraft.trim();
    if (!name) { toast.error('Flow name is required.'); setNameDraft(flow.name); return; }
    if (name === flow.name) { cancelRename(); return; }
    setRenaming(true);
    try {
      const result = await api.updateFlow(flow.id, { name });
      useAppStore.setState((state) => ({ flows: state.flows.map((item) => item.id === flow.id ? { ...item, ...result.flow } : item) }));
      cancelRename();
      await refreshFlows();
      toast.success('Flow name updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the Flow name.');
    } finally {
      setRenaming(false);
    }
  };
  return <section className="flow-library" aria-labelledby="flow-library-title">
    <PageHeader title="Flow library" titleId="flow-library-title" description="Create and publish reusable Flows.">
      <PageHeaderAction label="New flow" onClick={() => setCreateOpen(true)} />
    </PageHeader>
    <div className="flow-library-scroll"><div className="flow-grid">
      {flows.map((flow) => {
        const previewVersion = flow.activeVersion ?? flow.draftVersion;
        return <article key={flow.id} className="flow-card">
        <div className="flow-card-top"><span className="flow-symbol"><Icon name="nodes" size={21} /></span><div className="flow-card-heading"><h3>{editingNameFor === flow.id ? <input ref={nameInputRef} className="library-flow-name-input" aria-label={`Flow name for ${flow.name}`} value={nameDraft} disabled={renaming} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void commitRename(flow)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} /> : <button type="button" className="library-flow-name-button" aria-label={`Rename flow ${flow.name}`} title="Rename flow" onClick={() => beginRename(flow)}><span>{flow.name}</span><Icon name="edit" size={13} /></button>}</h3>{previewVersion && <span className="flow-version">{flow.activeVersion ? `v${previewVersion.version}` : `Draft v${previewVersion.version}`}</span>}</div></div>
        <button type="button" className="flow-card-open" onClick={() => editFlow(flow.id)} aria-label={`Edit ${flow.name}`}>
          <PreviewGraph definition={previewVersion?.definition} />
        </button>
        <footer><div className="flow-card-actions"><Button variant="text" icon="copy" loading={duplicatingFlowId === flow.id} loadingLabel="Duplicating…" disabled={duplicatingFlowId !== null} onClick={() => void duplicate(flow)}>Duplicate Flow</Button><Button variant="text" tone="danger" icon="trash" disabled={Boolean(flow.is_default)} title={flow.is_default ? 'Set another published Flow as default before deleting this one.' : undefined} onClick={() => setDeleteTarget(flow)}>Delete Flow</Button></div>{flow.is_default ? <span className="default-flow-status"><Icon name="check" size={14} />Default</span> : flow.active_version_id && <Button variant="text" icon="check" onClick={async () => { await api.makeDefault(flow.id); await refreshFlows(); toast.success('Default Flow updated.'); }}>Make default</Button>}</footer>
      </article>;
      })}
      <button className="flow-card add-flow" onClick={() => setCreateOpen(true)}><span><Icon name="plus" size={25} /></span><strong>Create another Flow</strong><small>Start from the recommended delivery graph</small></button>
    </div></div>
    {createOpen && <FlowComposer onClose={() => setCreateOpen(false)} onCreate={create} />}
    {deleteTarget && <ConfirmDialog title={`Delete ${deleteTarget.name}?`} message="This permanently deletes the Flow and its versions. Flows with run history cannot be deleted." confirmLabel="Delete flow" destructive disabled={deleting} onConfirm={() => void remove()} onCancel={() => !deleting && setDeleteTarget(null)} />}
  </section>;
}
