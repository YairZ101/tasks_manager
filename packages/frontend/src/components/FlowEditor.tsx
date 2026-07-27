import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AGENT_PRESETS, createAgentConfig, getNodeOutcomes, validateFlow, type FlowDefinition, type FlowNode } from '@tasks-manager/flow-core';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';

type CanvasNode = Node<{ flowNode: FlowNode }, 'flowBlock'>;
type EditorViewport = NonNullable<FlowDefinition['viewport']>;

const defaultViewport: EditorViewport = { x: 30, y: 120, zoom: 0.86 };

function sameViewport(a: EditorViewport, b: EditorViewport): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.zoom - b.zoom) < 0.001;
}

const typeMeta: Record<FlowNode['type'], { label: string; glyph: string; description: string }> = {
  begin: { label: 'Begin', glyph: '▶', description: 'One entry point' },
  agent: { label: 'Agent', glyph: 'A', description: 'Autonomous work' },
  check: { label: 'Check', glyph: '✓', description: 'Deterministic command' },
  decision: { label: 'Decision', glyph: '?', description: 'Human choice' },
  result: { label: 'Result', glyph: '■', description: 'Explicit outcome' },
  note: { label: 'Note', glyph: '≡', description: 'Canvas annotation' },
};

function BlockNode({ data, selected }: NodeProps<CanvasNode>) {
  const flowNode = data.flowNode;
  if (flowNode.type === 'note') return <div className={`canvas-note ${flowNode.config.color} ${selected ? 'selected' : ''}`}>{flowNode.config.text || 'Note'}</div>;
  const outcomes = getNodeOutcomes(flowNode);
  const name = 'name' in flowNode.config ? flowNode.config.name : flowNode.type;
  return <div className={`canvas-node type-${flowNode.type} ${selected ? 'selected' : ''}`}>
    {flowNode.type !== 'begin' && <Handle type="target" position={Position.Left} className="input-handle" />}
    <div className="node-cap"><span>{typeMeta[flowNode.type].glyph}</span><em>{typeMeta[flowNode.type].label}</em></div>
    <strong>{name}</strong>
    {flowNode.type === 'agent' && <small>{flowNode.config.preset.replace('-', ' ')} · {flowNode.config.effectLevel.replace('_', ' ')}</small>}
    {flowNode.type === 'check' && <code>{flowNode.config.command || 'No command yet'}</code>}
    {flowNode.type === 'result' && <small>{flowNode.config.category}</small>}
    <div className="node-outcomes">{outcomes.map((outcome, index) => <span key={outcome}>{outcome.replace('_', ' ')}<Handle id={outcome} type="source" position={Position.Right} style={{ top: `${((index + 1) / (outcomes.length + 1)) * 100}%` }} /></span>)}</div>
  </div>;
}

const nodeTypes = { flowBlock: BlockNode };

function toCanvas(definition: FlowDefinition): { nodes: CanvasNode[]; edges: Edge[] } {
  return {
    nodes: definition.nodes.map((flowNode) => ({ id: flowNode.id, type: 'flowBlock', position: flowNode.position, data: { flowNode }, style: flowNode.type === 'note' ? { width: flowNode.config.width ?? 220, height: flowNode.config.height ?? 120 } : undefined })),
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

function Inspector({ node, nodes, edges, update, connectOutcome, remove }: { node: CanvasNode; nodes: CanvasNode[]; edges: Edge[]; update: (next: FlowNode) => void; connectOutcome: (outcome: string, target: string) => void; remove: () => void }) {
  const flowNode = node.data.flowNode;
  const config: any = flowNode.config;
  const patch = (changes: any) => update({ ...flowNode, config: { ...flowNode.config, ...changes } } as FlowNode);
  const executableTargets = nodes.filter((candidate) => candidate.id !== node.id && candidate.data.flowNode.type !== 'note' && candidate.data.flowNode.type !== 'begin');
  return <aside className="inspector">
    <header><div><span className={`block-glyph ${flowNode.type}`}>{typeMeta[flowNode.type].glyph}</span><div><span className="eyebrow">{typeMeta[flowNode.type].label.toUpperCase()} BLOCK</span><h3>{config.name || typeMeta[flowNode.type].label}</h3></div></div></header>
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
  const [editorViewport, setEditorViewport] = useState<EditorViewport>(defaultViewport);
  const savedViewport = useRef<EditorViewport | null>(null);
  const { screenToFlowPosition, setViewport } = useReactFlow();
  const definition = useMemo(() => definitionFrom(nodes, edges, editorViewport), [nodes, edges, editorViewport]);
  const validation = useMemo(() => validateFlow(definition), [definition]);

  useEffect(() => {
    let cancelled = false;
    void api.getDraft(flowId).then(({ draft }) => {
      if (cancelled) return;
      const canvas = toCanvas(draft.definition);
      const nextViewport = draft.definition.viewport ?? defaultViewport;
      savedViewport.current = nextViewport;
      setEditorViewport(nextViewport);
      setNodes(canvas.nodes); setEdges(canvas.edges); setRevision(draft.draft_revision); setDirty(false);
      void setViewport(nextViewport);
    });
    return () => { cancelled = true; };
  }, [flowId, setEdges, setNodes, setViewport]);

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
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); const type = event.dataTransfer.getData('application/flow-block') as FlowNode['type'];
    if (!type || (type === 'begin' && nodes.some((node) => node.data.flowNode.type === 'begin'))) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY }); const flowNode = makeNode(type, position.x, position.y);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id: flowNode.id, type: 'flowBlock', position, data: { flowNode }, selected: true }]); setSelectedId(flowNode.id); setDirty(true);
  };
  const updateSelected = (next: FlowNode) => { setNodes((current) => current.map((node) => node.id === next.id ? { ...node, data: { flowNode: next } } : node)); setDirty(true); };
  const selected = nodes.find((node) => node.id === selectedId);
  const connectOutcome = (outcome: string, target: string) => {
    if (!selected) return;
    setEdges((current) => {
      const remaining = current.filter((edge) => !(edge.source === selected.id && edge.sourceHandle === outcome));
      return target ? [...remaining, { id: uniqueId('connection'), source: selected.id, sourceHandle: outcome, target, type: 'smoothstep' }] : remaining;
    }); setDirty(true);
  };
  const removeSelected = () => { if (!selected) return; setNodes((current) => current.filter((node) => node.id !== selected.id)); setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedId(null); setDirty(true); };
  const save = async () => {
    setSaving(true); try { const result = await api.saveDraft(flowId, definition, revision); savedViewport.current = editorViewport; setRevision(result.draft.draft_revision); setDirty(false); toast.success('Draft saved.'); return true; }
    catch (error: any) { toast.error(error.data?.reason === 'revision_conflict' ? 'Draft changed elsewhere. Reload the editor.' : error.message); return false; } finally { setSaving(false); }
  };
  const publish = async () => { if (!validation.valid) { toast.error('Resolve validation problems before publishing.'); return; } if (!(await save())) return; await api.publishFlow(flowId); await refreshFlows(); toast.success('A new immutable Flow version is live.'); };

  return <div className="editor-shell">
    <div className="editor-toolbar"><button className="back-button" onClick={() => back(null)}><span>←</span>Library</button><div className="flow-title"><span className="flow-symbol"><Icon name="nodes" size={17} /></span><div><strong>{flow?.name ?? 'Flow'}</strong><small>{dirty ? 'Unsaved draft' : `Draft r${revision}`}</small></div></div><div className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}><span />{validation.valid ? 'Ready to publish' : `${validation.problems.length} issue${validation.problems.length === 1 ? '' : 's'}`}</div><div className="toolbar-spacer"/><button className="button ghost" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save draft'}</button><button className="button primary" disabled={saving || !validation.valid} onClick={() => void publish()}>Publish version</button></div>
    <div className="editor-main">
      <aside className="palette"><span className="eyebrow">BLOCKS</span>{(Object.keys(typeMeta) as FlowNode['type'][]).map((type) => <button key={type} draggable onDragStart={(event) => { event.dataTransfer.setData('application/flow-block', type); event.dataTransfer.effectAllowed = 'move'; }} disabled={type === 'begin' && nodes.some((node) => node.data.flowNode.type === 'begin')}><span className={type}>{typeMeta[type].glyph}</span><div><strong>{typeMeta[type].label}</strong><small>{typeMeta[type].description}</small></div></button>)}<div className="palette-tip"><strong>Drag to canvas</strong><p>Connect outcome handles, or select a block and use the connection menus.</p></div></aside>
      <div className="canvas-wrap" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={onConnect} onSelectionChange={({ nodes: selection }) => setSelectedId(selection[0]?.id ?? null)} onMoveEnd={(_, viewport) => { setEditorViewport(viewport); if (savedViewport.current && !sameViewport(savedViewport.current, viewport)) setDirty(true); }} minZoom={0.2} maxZoom={1.6} deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
          <Background color="#26332f" gap={24} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable maskColor="rgba(5, 9, 8, 0.82)" nodeColor={(node) => ({ begin: '#69e0b1', agent: '#6ba5ff', check: '#d4e052', decision: '#ffb454', result: '#dc7eff', note: '#7e8a86' } as Record<string, string>)[(node.data as any).flowNode.type] ?? '#fff'} />
        </ReactFlow>
        {!validation.valid && <div className="validation-popover"><strong>Flow needs attention</strong>{validation.problems.slice(0, 4).map((problem) => <button key={`${problem.code}-${problem.nodeId}-${problem.connectionId}`} onClick={() => problem.nodeId && setSelectedId(problem.nodeId)}><span>!</span>{problem.message}</button>)}</div>}
      </div>
      {selected ? <Inspector node={selected} nodes={nodes} edges={edges} update={updateSelected} connectOutcome={connectOutcome} remove={removeSelected} /> : <aside className="inspector empty"><span className="empty-glyph"><Icon name="nodes" size={25} /></span><h3>Select a block</h3><p>Its configuration and outcome connections will appear here.</p></aside>}
    </div>
  </div>;
}

export default function FlowEditor({ flowId }: { flowId: number }) {
  return <ReactFlowProvider><EditorCanvas flowId={flowId} /></ReactFlowProvider>;
}
