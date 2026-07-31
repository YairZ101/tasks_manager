import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AGENT_PRESETS, createAgentConfig, getNodeOutcomes, validateFlow, type FlowDefinition, type FlowNode } from '@flow/core';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { BlockIcon, Icon } from './Icon.js';

type CanvasNode = Node<{ flowNode: FlowNode }, 'flowBlock'>;
type EditorViewport = NonNullable<FlowDefinition['viewport']>;
type EditorPanel = 'palette' | 'inspector' | null;
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
  return <div className={`canvas-node type-${flowNode.type} ${selected ? 'selected' : ''}`} title={`${typeMeta[flowNode.type].label}: ${name}`} aria-label={`${typeMeta[flowNode.type].label} block: ${name}`}>
    {flowNode.type !== 'begin' && <Handle type="target" position={Position.Left} className="input-handle" />}
    <div className="node-cap"><span><BlockIcon type={flowNode.type} /></span><em>{typeMeta[flowNode.type].label}</em></div>
    <strong>{name}</strong>
    {flowNode.type === 'agent' && <small className="node-detail">{flowNode.config.preset.replace('-', ' ')} · {flowNode.config.effectLevel.replace('_', ' ')}</small>}
    {flowNode.type === 'check' && <code className="node-detail">{flowNode.config.command || 'No command yet'}</code>}
    {flowNode.type === 'result' && <small className="node-detail">{flowNode.config.category}</small>}
    <div className="node-outcomes">{outcomes.map((outcome, index) => <span key={outcome}><span className="node-outcome-label">{outcome.replace('_', ' ')}</span><Handle id={outcome} type="source" position={Position.Right} style={{ top: `${((index + 1) / (outcomes.length + 1)) * 100}%` }} /></span>)}</div>
    <SemanticSummary type={flowNode.type} name={name} />
  </div>;
}

const nodeTypes = { flowBlock: BlockNode };

function toCanvas(definition: FlowDefinition): { nodes: CanvasNode[]; edges: Edge[] } {
  return {
    nodes: definition.nodes.map((flowNode) => ({ id: flowNode.id, type: 'flowBlock', position: flowNode.position, data: { flowNode }, style: flowNode.type === 'note' ? { width: flowNode.config.width ?? 220, height: flowNode.config.height ?? 120 } : { height: FLOW_NODE_HEIGHTS[flowNode.type] } })),
    edges: definition.connections.map((connection) => ({ id: connection.id, source: connection.sourceNodeId, sourceHandle: connection.sourceOutcomeId, target: connection.targetNodeId, type: 'smoothstep', animated: false })),
  };
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

function makeNode(type: FlowNode['type'], x: number, y: number): FlowNode {
  const base = { id: uniqueId(type), typeVersion: 1 as const, position: { x, y } };
  switch (type) {
    case 'begin': return { ...base, type, config: { name: 'Begin' } };
    case 'agent': return { ...base, type, config: createAgentConfig('development', 'Development') };
    case 'check': return { ...base, type, config: { name: 'Project checks', command: 'bun run test', workingDirectory: '.', timeoutMs: 180000, effectLevel: 'read_only' } };
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

function Inspector({ node, nodes, edges, open, update, connectOutcome, remove, close }: { node: CanvasNode; nodes: CanvasNode[]; edges: Edge[]; open: boolean; update: (next: FlowNode) => void; connectOutcome: (outcome: string, target: string) => void; remove: () => void; close: () => void }) {
  const flowNode = node.data.flowNode;
  const config: any = flowNode.config;
  const patch = (changes: any) => update({ ...flowNode, config: { ...flowNode.config, ...changes } } as FlowNode);
  const executableTargets = nodes.filter((candidate) => candidate.id !== node.id && candidate.data.flowNode.type !== 'note' && candidate.data.flowNode.type !== 'begin');
  return <aside id="flow-block-inspector" className={`inspector editor-panel ${open ? 'panel-open' : ''}`} aria-label="Block inspector">
    <header><div><span className={`block-glyph ${flowNode.type}`}><BlockIcon type={flowNode.type} /></span><div><span className="eyebrow">{typeMeta[flowNode.type].label.toUpperCase()} BLOCK</span><h3>{config.name || typeMeta[flowNode.type].label}</h3></div></div><PanelCloseButton label="Close block inspector" onClick={close} /></header>
    <div className="inspector-scroll">
      {flowNode.type !== 'note' && <label>Name<input value={config.name} onChange={(e) => patch({ name: e.target.value })} /></label>}
      {flowNode.type === 'agent' && <>
        <label>Preset<select value={config.preset} onChange={(e) => patch(createAgentConfig(e.target.value as any, config.name))}>{AGENT_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.name}</option>)}</select></label>
        <label>Additional instructions<textarea value={config.instructions ?? ''} onChange={(e) => patch({ instructions: e.target.value })} placeholder="Specific guidance for this block…" /></label>
        <label>Effect level<select value={config.effectLevel} onChange={(e) => patch({ effectLevel: e.target.value })}><option value="read_only">Read only</option><option value="workspace_write">Workspace write</option><option value="external_write">External write</option></select></label>
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
      {flowNode.type === 'result' && <><label>Result category<select value={config.category} onChange={(e) => patch({ category: e.target.value })}><option value="completed">Completed</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></label><label>Message<textarea value={config.message ?? ''} onChange={(e) => patch({ message: e.target.value })} /></label></>}
      {flowNode.type === 'note' && <><label>Note<textarea value={config.text} onChange={(e) => patch({ text: e.target.value })} /></label><label>Color<select value={config.color} onChange={(e) => patch({ color: e.target.value })}><option value="slate">Slate</option><option value="blue">Blue</option><option value="amber">Amber</option><option value="rose">Rose</option></select></label></>}
      {flowNode.type !== 'result' && flowNode.type !== 'note' && <fieldset className="connections"><legend>Outcome connections</legend><p>Keyboard-accessible alternative to drawing wires.</p>{getNodeOutcomes(flowNode).map((outcome) => <label key={outcome}><span>{outcome.replace('_', ' ')}</span><select aria-label={`Connect ${outcome}`} value={edges.find((edge) => edge.source === node.id && edge.sourceHandle === outcome)?.target ?? ''} onChange={(e) => connectOutcome(outcome, e.target.value)}><option value="">Not connected</option>{executableTargets.map((target) => <option key={target.id} value={target.id}>{'name' in target.data.flowNode.config ? target.data.flowNode.config.name : target.id}</option>)}</select></label>)}</fieldset>}
    </div>
    {flowNode.type !== 'begin' && <footer><button className="text-danger" onClick={remove}><Icon name="trash" size={15} />Delete block</button></footer>}
  </aside>;
}

function EditorCanvas({ flowId }: { flowId: number }) {
  const flow = useAppStore((state) => state.flows.find((candidate) => candidate.id === flowId));
  const back = useAppStore((state) => state.editFlow);
  const refreshFlows = useAppStore((state) => state.refreshFlows);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [revision, setRevision] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [flowName, setFlowName] = useState(flow?.name ?? 'Flow');
  const [nameDraft, setNameDraft] = useState(flow?.name ?? 'Flow');
  const [renaming, setRenaming] = useState(false);
  const [renamingSaving, setRenamingSaving] = useState(false);
  const [openPanel, setOpenPanel] = useState<EditorPanel>(null);
  const [editorViewport, setEditorViewport] = useState<EditorViewport>(defaultViewport);
  const [viewportReady, setViewportReady] = useState(false);
  const savedViewport = useRef<EditorViewport | null>(null);
  const viewportChangedByUser = useRef(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const { fitView, getViewport, screenToFlowPosition } = useReactFlow();
  const definition = useMemo(() => definitionFrom(nodes, edges, editorViewport), [nodes, edges, editorViewport]);
  const validation = useMemo(() => validateFlow(definition), [definition]);
  const zoomMode = getFlowZoomMode(editorViewport.zoom);

  useEffect(() => {
    let cancelled = false;
    let viewportFrame = 0;
    setViewportReady(false);
    void api.getDraft(flowId).then(({ draft }) => {
      if (cancelled) return;
      const canvas = toCanvas(draft.definition);
      const nextViewport = draft.definition.viewport ?? defaultViewport;
      savedViewport.current = nextViewport;
      setEditorViewport(nextViewport);
      setNodes(canvas.nodes); setEdges(canvas.edges); setRevision(draft.draft_revision); setDirty(false);
      viewportFrame = requestAnimationFrame(() => {
        void fitView({ padding: 0.12, duration: 0 });
        viewportFrame = requestAnimationFrame(() => {
          if (cancelled) return;
          const fittedViewport = getViewport();
          savedViewport.current = fittedViewport;
          setEditorViewport(fittedViewport);
          setDirty(false);
          setViewportReady(true);
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(viewportFrame); };
  }, [fitView, flowId, getViewport, setEdges, setNodes]);

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

  const changeNodes = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    if (changes.some((change) => ['position', 'remove', 'add', 'replace'].includes(change.type))) setDirty(true);
  }, [onNodesChange]);
  const changeEdges = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    onEdgesChange(changes);
    if (changes.some((change) => change.type !== 'select')) setDirty(true);
  }, [onEdgesChange]);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle) return;
    setEdges((current) => addEdge({ ...connection, id: uniqueId('connection'), type: 'smoothstep' }, current.filter((edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)))); setDirty(true);
  }, [setEdges]);
  const insertNode = useCallback((type: FlowNode['type'], position: { x: number; y: number }) => {
    if (type === 'begin' && nodes.some((node) => node.data.flowNode.type === 'begin')) return;
    const flowNode = makeNode(type, position.x, position.y);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id: flowNode.id, type: 'flowBlock', position, data: { flowNode }, style: flowNode.type === 'note' ? { width: flowNode.config.width ?? 220, height: flowNode.config.height ?? 120 } : { height: FLOW_NODE_HEIGHTS[flowNode.type] }, selected: true }]);
    setSelectedId(flowNode.id);
    setOpenPanel(null);
    setDirty(true);
  }, [nodes, setNodes]);
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
  const updateSelected = (next: FlowNode) => { setNodes((current) => current.map((node) => node.id === next.id ? { ...node, data: { flowNode: next } } : node)); setDirty(true); };
  const selected = nodes.find((node) => node.id === selectedId);
  const inspectorVisible = selected !== undefined && openPanel === 'inspector';
  const connectOutcome = (outcome: string, target: string) => {
    if (!selected) return;
    setEdges((current) => {
      const remaining = current.filter((edge) => !(edge.source === selected.id && edge.sourceHandle === outcome));
      return target ? [...remaining, { id: uniqueId('connection'), source: selected.id, sourceHandle: outcome, target, type: 'smoothstep' }] : remaining;
    }); setDirty(true);
  };
  const removeSelected = () => { if (!selected) return; setNodes((current) => current.filter((node) => node.id !== selected.id)); setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedId(null); setOpenPanel(null); setDirty(true); };
  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
    setSelectedId(null);
    setOpenPanel(null);
  }, [setNodes]);
  const save = async () => {
    setSaving(true); try { const result = await api.saveDraft(flowId, definition, revision); savedViewport.current = editorViewport; setRevision(result.draft.draft_revision); setDirty(false); toast.success('Draft saved.'); return true; }
    catch (error: any) { toast.error(error.data?.reason === 'revision_conflict' ? 'Draft changed elsewhere. Reload the editor.' : error.message); return false; } finally { setSaving(false); }
  };
  const publish = async () => { if (!validation.valid) { toast.error('Resolve validation problems before publishing.'); return; } if (!(await save())) return; await api.publishFlow(flowId); await refreshFlows(); toast.success('A new immutable Flow version is live.'); };
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

  return <div className={`editor-shell zoom-${zoomMode}`} data-zoom-mode={zoomMode} style={{ '--zoom-compensation': Math.min(1 / editorViewport.zoom, 1 / MIN_FLOW_ZOOM) } as CSSProperties}>
    <div className="editor-toolbar"><div className="editor-toolbar-context"><button className="back-button" aria-label="Flow library" onClick={() => back(null)}><Icon name="back" size={15} /><span className="toolbar-nav-label">Library</span></button><div className={`flow-title ${renaming ? 'is-editing' : ''}`}><span className="flow-symbol"><Icon name="nodes" size={17} /></span><div>{renaming ? <input ref={nameInputRef} className="flow-name-input" aria-label="Flow name" value={nameDraft} disabled={renamingSaving} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void commitName()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); setNameDraft(flowName); setRenaming(false); } }} /> : <button type="button" className="flow-name-button" aria-label={`Rename flow ${flowName}`} title="Rename flow" onClick={() => { setNameDraft(flowName); setRenaming(true); }}><strong>{flowName}</strong><Icon name="edit" size={13} /></button>}<small>{dirty ? 'Unsaved draft' : `Draft r${revision}`}</small></div></div><div className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}><span />{validation.valid ? 'Ready to publish' : `${validation.problems.length} issue${validation.problems.length === 1 ? '' : 's'}`}</div></div><div className="editor-toolbar-actions"><button className="button ghost editor-toolbar-action" aria-label={saving ? 'Saving draft' : 'Save draft'} disabled={!dirty || saving} onClick={() => void save()}><Icon name="save" size={15} /><span className="toolbar-action-label">{saving ? 'Saving…' : 'Save draft'}</span></button><button className="button primary editor-toolbar-action" aria-label="Publish version" disabled={saving || !validation.valid} onClick={() => void publish()}><Icon name="publish" size={15} /><span className="toolbar-action-label">Publish version</span></button></div></div>
    <div className="editor-main">
      <button type="button" className={`button ghost editor-palette-toggle ${openPanel === 'palette' ? 'active' : ''}`} aria-expanded={openPanel === 'palette'} aria-controls="flow-block-library" onClick={() => setOpenPanel((current) => current === 'palette' ? null : 'palette')}><Icon name="plus" size={15} />Blocks</button>
      <BlockPalette nodes={nodes} open={openPanel === 'palette'} add={addFromPalette} />
      <div ref={canvasRef} className="canvas-wrap" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={onConnect} onPaneClick={clearSelection} onNodeClick={(_, node) => { setSelectedId(node.id); setOpenPanel('inspector'); }} onSelectionChange={({ nodes: selection }) => { setSelectedId(selection[0]?.id ?? null); }} onMoveStart={(event) => { if (event) viewportChangedByUser.current = true; }} onMoveEnd={(_, viewport) => { setEditorViewport(viewport); if (viewportChangedByUser.current && savedViewport.current && !sameViewport(savedViewport.current, viewport)) setDirty(true); viewportChangedByUser.current = false; }} minZoom={MIN_FLOW_ZOOM} maxZoom={1.6} deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
          <Background color="#26332f" gap={24} size={1} />{viewportReady && <Controls showInteractive={false} onZoomIn={() => { viewportChangedByUser.current = true; }} onZoomOut={() => { viewportChangedByUser.current = true; }} onFitView={() => { viewportChangedByUser.current = true; }}><output className="flow-zoom-indicator" aria-label="Current canvas zoom" aria-live="polite">{Math.round(editorViewport.zoom * 100)}%</output></Controls>}<MiniMap pannable zoomable maskColor="rgba(5, 9, 8, 0.82)" nodeColor={(node) => ({ begin: '#69e0b1', agent: '#6ba5ff', check: '#d4e052', decision: '#ffb454', result: '#dc7eff', note: '#7e8a86' } as Record<string, string>)[(node.data as any).flowNode.type] ?? '#fff'} />
        </ReactFlow>
        {!validation.valid && <div className="validation-popover"><strong>Flow needs attention</strong>{validation.problems.slice(0, 4).map((problem) => <button key={`${problem.code}-${problem.nodeId}-${problem.connectionId}`} onClick={() => { if (problem.nodeId) { setSelectedId(problem.nodeId); setOpenPanel('inspector'); } }}><Icon name="alert" size={14} />{problem.message}</button>)}</div>}
      </div>
      {inspectorVisible && <Inspector node={selected} nodes={nodes} edges={edges} open update={updateSelected} connectOutcome={connectOutcome} remove={removeSelected} close={() => setOpenPanel(null)} />}
    </div>
  </div>;
}

export default function FlowEditor({ flowId }: { flowId: number }) {
  return <ReactFlowProvider><EditorCanvas flowId={flowId} /></ReactFlowProvider>;
}
