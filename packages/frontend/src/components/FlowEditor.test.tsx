import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRecommendedFlow, getNodeOutcomes } from '@flow/core';
import FlowEditor, { agentConfigFromPreset, COMPACT_ZOOM_THRESHOLD, DETAIL_ZOOM_THRESHOLD, FLOW_LAYOUT_COLUMN_GAP, FLOW_LAYOUT_NODE_WIDTH, FLOW_NODE_HEIGHTS, MIN_FLOW_ZOOM, createFlowAutoLayout, formatActionTimestamp, getFlowZoomMode, getVersionChanges, hasLayoutChange, toCanvas } from './FlowEditor.js';
import { FLOW_CONNECTOR_CLEARANCE, connectorCrossesRect, connectorSegmentsOverlap, connectorSourcePortTop, createConnectorPath, routeFlowConnectors } from './flowRouting.js';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';

vi.mock('../api/client.js', () => ({ api: { getDraft: vi.fn(), getFlow: vi.fn(), saveDraft: vi.fn(), publishFlow: vi.fn(), activateFlowVersion: vi.fn(), updateFlow: vi.fn(), listAgentPresets: vi.fn() } }));

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    const definition = createRecommendedFlow();
    vi.mocked(api.getDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 4, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 2 } as any, versions: [{ id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition, compiled: definition, published_at: '2026-07-01T12:00:00Z' }] });
    vi.mocked(api.saveDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    vi.mocked(api.publishFlow).mockResolvedValue({ version: { id: 4, flow_id: 1, version: 2, state: 'published', draft_revision: 4, definition, compiled: definition, published_at: '2026-08-04T12:00:00Z' } as any, draft: { id: 5, flow_id: 1, version: 3, state: 'draft', draft_revision: 1, definition, compiled: null, published_at: null } as any });
    vi.mocked(api.activateFlowVersion).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2 } as any, version: { id: 2, version: 1, definition } as any });
    vi.mocked(api.updateFlow).mockResolvedValue({ flow: { id: 1, name: 'Renamed delivery' } as any });
    vi.mocked(api.listAgentPresets).mockResolvedValue({ presets: [
      { id: 1, preset_key: 'planning', name: 'Planning', description: 'Plan work', system_prompt: 'Plan carefully.', created_at: '', updated_at: '' },
      { id: 2, preset_key: 'development', name: 'Development', description: 'Build work', system_prompt: 'Build carefully.', created_at: '', updated_at: '' },
      { id: 3, preset_key: 'open-pr', name: 'Open PR', description: 'Open a pull request', system_prompt: 'Open a PR.', created_at: '', updated_at: '' },
    ] });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2 } as any], editingFlowId: 1, viewingFlowVersionId: null, refreshFlows: vi.fn(), editFlow: vi.fn(), viewFlowVersion: vi.fn() });
  });

  test('describes the graph actions introduced by a version', () => {
    const previous = createRecommendedFlow();
    const editedNode = previous.nodes[1] as any;
    const current = {
      ...previous,
      nodes: [
        ...previous.nodes.slice(0, -1).map((node, index) => index === 1 ? { ...node, position: { x: node.position.x + 20, y: node.position.y }, config: { ...node.config, name: 'Implementation', instructions: 'Keep the change focused.' } } : node),
        { id: 'note-history', type: 'note', typeVersion: 1, position: { x: 50, y: 50 }, config: { text: 'Remember the edge case', color: 'amber', width: 220, height: 120 } },
      ],
      connections: [
        ...previous.connections.slice(0, -1),
        { id: 'connection-history', sourceNodeId: editedNode.id, sourceOutcomeId: 'completed', targetNodeId: previous.nodes[2].id },
      ],
    };
    const changes = getVersionChanges(current as any, previous);
    expect(changes.map((change) => change.title)).toEqual(expect.arrayContaining([
      'Added Note block',
      expect.stringMatching(/^Removed /),
      expect.stringMatching(/^Renamed /),
      'Changed instructions',
      expect.stringMatching(/^Connected /),
      expect.stringMatching(/^Removed connection from /),
    ]));
    // The edited block also moved, but position is not behaviour and never becomes an entry.
    expect(changes.some((change) => /^Moved/.test(change.title))).toBe(false);
    expect(getVersionChanges(previous)).toEqual([{ kind: 'initial', title: 'Created the first version', detail: expect.stringMatching(/blocks/) }]);
    expect(formatActionTimestamp('2026-08-03T13:15:00Z')).toMatch(/Aug.*:\d{2}/);
    expect(formatActionTimestamp(undefined)).toBe('Just now');
  });

  test('reports layout drift as context instead of history entries', () => {
    const previous = createRecommendedFlow();
    const nudge = (node: any) => ({ ...node, position: { x: node.position.x + 20, y: node.position.y } });

    // A drag of one block, and an Arrange that moves every block, are both silent in history.
    const oneMoved = { ...previous, nodes: previous.nodes.map((node, index) => index === 1 ? nudge(node) : node) };
    const allMoved = { ...previous, nodes: previous.nodes.map(nudge) };
    expect(getVersionChanges(oneMoved as any, previous)).toEqual([]);
    expect(getVersionChanges(allMoved as any, previous)).toEqual([]);

    // The panel still needs to know positions drifted, so it can say so in the empty state.
    expect(hasLayoutChange(oneMoved as any, previous)).toBe(true);
    expect(hasLayoutChange(allMoved as any, previous)).toBe(true);
    expect(hasLayoutChange(previous, previous)).toBe(false);
    expect(hasLayoutChange(previous)).toBe(false);
  });

  test('creates a compact deterministic topology and docks notes beneath the graph', () => {
    const definition = createRecommendedFlow();
    definition.nodes.push({ id: 'layout-note', type: 'note', typeVersion: 1, position: { x: 9999, y: 9999 }, config: { text: 'Keep this visible', color: 'amber', width: 260, height: 120 } });

    const positions = createFlowAutoLayout(definition);
    const begin = positions.get('begin')!;
    const planning = positions.get('planning')!;
    const review = positions.get('plan-decision')!;
    const tests = positions.get('tests')!;
    const failedChecks = positions.get('test-decision')!;
    const finalReview = positions.get('final-decision')!;
    const openPr = positions.get('open-pr')!;
    const note = positions.get('layout-note')!;

    expect(planning.x - begin.x).toBe(FLOW_LAYOUT_NODE_WIDTH + FLOW_LAYOUT_COLUMN_GAP);
    expect(review.x).toBeGreaterThan(planning.x);
    expect(tests.x).toBeGreaterThan(review.x);
    expect(failedChecks.x).toBe(tests.x + FLOW_LAYOUT_NODE_WIDTH + FLOW_LAYOUT_COLUMN_GAP);
    expect(finalReview.y).toBe(tests.y);
    expect(openPr.y).toBe(finalReview.y);
    expect(failedChecks.y).toBeGreaterThan(finalReview.y);
    expect(note.y).toBeGreaterThan(failedChecks.y);
    expect(createFlowAutoLayout(definition)).toEqual(positions);
  });

  test('routes every connector through a separate obstacle-free lane', () => {
    const definition = createRecommendedFlow();
    const arrangedPositions = createFlowAutoLayout(definition);
    const routingNodes = definition.nodes.map((node) => ({
      id: node.id,
      position: arrangedPositions.get(node.id) ?? node.position,
      width: node.type === 'note' ? node.config.width ?? 220 : FLOW_LAYOUT_NODE_WIDTH,
      height: node.type === 'note' ? node.config.height ?? 120 : FLOW_NODE_HEIGHTS[node.type],
      flowNode: node,
    }));
    const routingEdges = definition.connections.map((connection) => ({
      id: connection.id,
      source: connection.sourceNodeId,
      sourceHandle: connection.sourceOutcomeId,
      target: connection.targetNodeId,
    }));
    const plan = routeFlowConnectors(routingNodes, routingEdges);

    expect(plan.routes.size).toBe(definition.connections.length);
    for (const edge of routingEdges) {
      const route = plan.routes.get(edge.id)!;
      const sourceNode = routingNodes.find((node) => node.id === edge.source)!;
      const targetNode = routingNodes.find((node) => node.id === edge.target)!;
      const outcomes = getNodeOutcomes(sourceNode.flowNode);
      const outcomeIndex = outcomes.indexOf(edge.sourceHandle);

      expect(route.points[0].x).toBe(sourceNode.position.x + sourceNode.width);
      expect(route.points[0].y).toBeCloseTo(sourceNode.position.y + sourceNode.height * (connectorSourcePortTop(outcomeIndex, outcomes.length, sourceNode.height) / 100));
      expect(route.points.at(-1)!.x).toBe(targetNode.position.x);
      expect(route.points.at(-1)!.y).toBeCloseTo(targetNode.position.y + targetNode.height / 2);
      expect(route.targetHandle).toBe('input');
      expect(route.points[0].y).toBe(route.points[1].y);
      expect(route.points.at(-2)!.y).toBe(route.points.at(-1)!.y);
      for (const node of routingNodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        expect(connectorCrossesRect(route.points, {
          left: node.position.x - FLOW_CONNECTOR_CLEARANCE,
          top: node.position.y - FLOW_CONNECTOR_CLEARANCE,
          right: node.position.x + node.width + FLOW_CONNECTOR_CLEARANCE,
          bottom: node.position.y + node.height + FLOW_CONNECTOR_CLEARANCE,
        })).toBe(false);
      }
    }

    for (let first = 0; first < routingEdges.length; first += 1) {
      for (let second = first + 1; second < routingEdges.length; second += 1) {
        const overlap = connectorSegmentsOverlap(plan.routes.get(routingEdges[first].id)!.points, plan.routes.get(routingEdges[second].id)!.points);
        expect(overlap).toBe(routingEdges[first].target === routingEdges[second].target);
      }
    }

    const graphTop = Math.min(...routingNodes.map((node) => node.position.y - FLOW_CONNECTOR_CLEARANCE));
    const graphBottom = Math.max(...routingNodes.map((node) => node.position.y + node.height + FLOW_CONNECTOR_CLEARANCE));
    const feedbackRoutes = routingEdges
      .filter((edge) => routingNodes.find((node) => node.id === edge.source)!.position.x >= routingNodes.find((node) => node.id === edge.target)!.position.x)
      .map((edge) => plan.routes.get(edge.id)!);
    const feedbackSides = feedbackRoutes.map((route) => Math.min(...route.points.map((point) => point.y)) < graphTop ? 'top' : Math.max(...route.points.map((point) => point.y)) > graphBottom ? 'bottom' : 'inside');
    expect(new Set(feedbackSides)).toEqual(new Set([feedbackSides[0]]));
    expect(feedbackSides[0]).not.toBe('inside');
    expect([...plan.routes.values()].some((route) => route.path.includes(' A 6 6 '))).toBe(true);

    expect(createConnectorPath([{ x: 0, y: 20 }, { x: 100, y: 20 }], [{ x: 50, y: 20 }]))
      .toContain('L 44 20 A 6 6 0 0 1 56 20');
    expect(createConnectorPath([{ x: 100, y: 20 }, { x: 0, y: 20 }], [{ x: 50, y: 20 }]))
      .toContain('L 56 20 A 6 6 0 0 0 44 20');
    const { edges } = toCanvas(definition);
    expect(edges.every((edge) => edge.type === 'flowConnector' && typeof edge.data?.routePath === 'string')).toBe(true);
  });

  test('shows one semantic input port without additional fan-in controls', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const planning = await screen.findByLabelText('Agent block: Planning');
    const development = await screen.findByLabelText('Agent block: Development');
    const planReview = await screen.findByLabelText('Decision block: Plan review');

    expect(planning.querySelectorAll('.input-handle')).toHaveLength(1);
    expect(development.querySelectorAll('.input-handle')).toHaveLength(1);
    expect(planReview.querySelectorAll('.input-handle')).toHaveLength(1);
    expect(document.querySelector('.input-fan-in')).toBeNull();

    const expectAlignedOutcomes = (block: HTMLElement, labels: string[]) => {
      const outcomeRows = [...block.querySelectorAll<HTMLElement>('.node-outcome-row')];
      const outputHandles = [...block.querySelectorAll<HTMLElement>('.output-handle')];
      expect(outcomeRows.map((row) => row.textContent)).toEqual(labels);
      expect(outputHandles).toHaveLength(outcomeRows.length);
      outcomeRows.forEach((row, index) => expect(row.style.top).toBe(outputHandles[index].style.top));
      expect(outcomeRows.every((row) => Number.parseFloat(row.style.top) > 50)).toBe(true);
    };
    expectAlignedOutcomes(planning, ['completed', 'failed', 'timed out']);
    expectAlignedOutcomes(development, ['completed', 'failed', 'timed out']);
    expectAlignedOutcomes(planReview, ['approved', 'changes']);

    const planningPortTops = [0, 1, 2].map((index) => connectorSourcePortTop(index, 3, FLOW_NODE_HEIGHTS.agent));
    expect((planningPortTops[1] - planningPortTops[0]) * FLOW_NODE_HEIGHTS.agent / 100).toBeCloseTo(24);
    expect(FLOW_NODE_HEIGHTS.agent - planningPortTops[2] * FLOW_NODE_HEIGHTS.agent / 100).toBeCloseTo(20);
    const decisionLastPort = connectorSourcePortTop(1, 2, FLOW_NODE_HEIGHTS.decision);
    expect(FLOW_NODE_HEIGHTS.decision - decisionLastPort * FLOW_NODE_HEIGHTS.decision / 100).toBeCloseTo(20);
  });

  test('routes around manually positioned blocks without sharing connector segments', () => {
    const definition = createRecommendedFlow();
    const routingNodes = definition.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      width: node.type === 'note' ? node.config.width ?? 220 : FLOW_LAYOUT_NODE_WIDTH,
      height: node.type === 'note' ? node.config.height ?? 120 : FLOW_NODE_HEIGHTS[node.type],
      flowNode: node,
    }));
    const routingEdges = definition.connections.map((connection) => ({
      id: connection.id,
      source: connection.sourceNodeId,
      sourceHandle: connection.sourceOutcomeId,
      target: connection.targetNodeId,
    }));
    const plan = routeFlowConnectors(routingNodes, routingEdges);

    for (const edge of routingEdges) {
      const route = plan.routes.get(edge.id)!;
      for (const node of routingNodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        expect(connectorCrossesRect(route.points, {
          left: node.position.x,
          top: node.position.y,
          right: node.position.x + node.width,
          bottom: node.position.y + node.height,
        })).toBe(false);
      }
    }

    for (let first = 0; first < routingEdges.length; first += 1) {
      for (let second = first + 1; second < routingEdges.length; second += 1) {
        const overlap = connectorSegmentsOverlap(plan.routes.get(routingEdges[first].id)!.points, plan.routes.get(routingEdges[second].id)!.points);
        expect(overlap).toBe(routingEdges[first].target === routingEdges[second].target);
      }
    }
  });

  test('opens an immutable published version in read-only mode', async () => {
    const first = { id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition: createRecommendedFlow(), compiled: createRecommendedFlow(), published_at: '2026-07-01T12:00:00Z' } as any;
    const current = { ...first, id: 3, version: 2, published_at: '2026-08-01T12:00:00Z' };
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 3 } as any, versions: [current, first] });
    vi.mocked(api.activateFlowVersion).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2, activeVersion: first } as any, version: first });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 3, activeVersion: current } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={2} /></div>);

    await screen.findByText('Standard delivery');
    expect(screen.queryByText('Published version 1')).not.toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Flow version' });
    const historyButton = screen.getByRole('button', { name: 'Version history' });
    const activateButton = await screen.findByRole('button', { name: 'Activate' });
    expect(activateButton).toHaveAttribute('data-toolbar-action', 'activate');
    expect(activateButton.querySelector('[data-icon="check"]')).toBeInTheDocument();
    expect(picker).toHaveValue('2');
    expect(historyButton).toHaveAttribute('aria-expanded', 'false');
    const historicalActions = Array.from(historyButton.parentElement!.children);
    expect(historicalActions[0]).toBe(historyButton);
    expect(historicalActions[1]).toBe(picker.closest('.version-picker'));
    expect(historicalActions[2]).toBe(activateButton);
    fireEvent.click(historyButton);
    expect(historyButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Version history' })).toHaveClass('panel-open');
    expect(screen.getByText('Changes in v1')).toBeVisible();
    expect(screen.getByText('Created the first version')).toBeVisible();
    fireEvent.click(picker);
    expect(screen.getByRole('option', { name: /v2 · current/ })).toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.click(activateButton);
    await waitFor(() => expect(api.activateFlowVersion).toHaveBeenCalledWith(1, 2));
    const editButton = await screen.findByRole('button', { name: /Edit latest draft/ });
    expect(editButton).toBeVisible();
    expect(editButton.querySelector('[data-icon="edit"]')).toBeInTheDocument();
    fireEvent.click(picker);
    expect(screen.getByRole('option', { name: /v1 · current/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^v2 ·/ })).toBeInTheDocument();
    expect(useAppStore.getState().refreshFlows).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Automatically arrange flow' })).not.toBeInTheDocument();
    const readOnlyIndicator = screen.getByRole('status', { name: 'Read only' });
    expect(readOnlyIndicator).toHaveClass('editor-read-only-indicator');
    expect(readOnlyIndicator.querySelector('[data-icon="lock"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(api.getDraft).not.toHaveBeenCalled();
  });

  test('renders persisted history actions with their own timestamps and block icons', async () => {
    const definition = createRecommendedFlow();
    const version = {
      id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition, compiled: definition, published_at: '2026-08-04T12:00:00Z',
      action_history: [
        { kind: 'changed', title: 'Renamed Planning to Implementation', blockType: 'agent', timestamp: '2026-08-04T08:13:00.000Z' },
        { kind: 'changed', title: 'Changed instructions', blockType: 'agent', timestamp: '2026-08-04T08:14:32.000Z' },
      ],
    } as any;
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 2 } as any, versions: [version] });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 2, activeVersion: version } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={2} /></div>);

    fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
    const renamedItem = (await screen.findByText('Renamed Planning to Implementation')).closest('li')!;
    expect(renamedItem).toHaveAttribute('data-block-type', 'agent');
    expect(renamedItem.querySelector('[data-icon="agent"]')).toBeInTheDocument();
    expect(renamedItem).toHaveTextContent(formatActionTimestamp('2026-08-04T08:13:00.000Z'));
    expect(screen.getByText('Changed instructions').closest('li')).toHaveTextContent(formatActionTimestamp('2026-08-04T08:14:32.000Z'));
  });

  test('a layout change saves the new positions without recording any history action', async () => {
    // Arrange is the one way to move blocks without a pointer drag, which happy-dom cannot simulate.
    const base = createRecommendedFlow();
    const displaced = { ...base, nodes: base.nodes.map((node, index) => index === 1 ? { ...node, position: { x: node.position.x + 260, y: node.position.y + 180 } } : node) } as any;
    vi.mocked(api.getDraft).mockResolvedValue({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 4, definition: displaced, compiled: null, published_at: null } as any, validation: { valid: true, problems: [] } });
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 2 } as any, versions: [{ id: 2, flow_id: 1, version: 1, state: 'published', draft_revision: 0, definition: displaced, compiled: displaced, published_at: '2026-07-01T12:00:00Z', action_history: [] } as any] });
    vi.mocked(api.saveDraft).mockImplementation(async (_flowId, definition, _revision, actions) => ({
      draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null, action_history: actions } as any,
      validation: { valid: true, problems: [] },
    }));
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Agent block: Planning');

    fireEvent.click(screen.getByRole('button', { name: 'Automatically arrange flow' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled(), { timeout: 2_000 });

    const [, savedDefinition, , savedActions] = vi.mocked(api.saveDraft).mock.calls[0]!;
    const movedNode = savedDefinition!.nodes.find((node) => node.id === displaced.nodes[1].id)!;
    expect(movedNode.position).not.toEqual(displaced.nodes[1].position);
    expect(savedActions).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(screen.getByRole('complementary', { name: 'Version history' }).querySelectorAll('li')).toHaveLength(0);
    expect(screen.getByText('Only block positions differ from the current published version.')).toBeVisible();
  });

  test('says a published version matches its predecessor when nothing differs', async () => {
    const definition = createRecommendedFlow();
    const published = (id: number, version: number) => ({
      id, flow_id: 1, version, state: 'published', draft_revision: 0, definition, compiled: definition,
      published_at: `2026-08-0${version}T12:00:00Z`, action_history: [],
    } as any);
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 3 } as any, versions: [published(2, 2), published(3, 3)] });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 3 } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={3} /></div>);

    fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
    expect(await screen.findByText('This version matches the previous version.')).toBeVisible();
  });

  test('names the version it was actually compared with, not the current one', async () => {
    const first = createRecommendedFlow();
    const second = { ...first, nodes: first.nodes.map((node, index) => index === 1 ? { ...node, position: { x: node.position.x + 40, y: node.position.y } } : node) };
    const published = (id: number, version: number, definition: any) => ({
      id, flow_id: 1, version, state: 'published', draft_revision: 0, definition, compiled: definition,
      published_at: `2026-08-0${version}T12:00:00Z`, action_history: [],
    } as any);
    // v4 is current, but viewing v3 compares it with v2 — the copy must not claim "current".
    const versions = [published(2, 2, first), published(3, 3, second), published(4, 4, second)];
    vi.mocked(api.getFlow).mockResolvedValue({ flow: { id: 1, name: 'Standard delivery', active_version_id: 4 } as any, versions });
    useAppStore.setState({ flows: [{ id: 1, name: 'Standard delivery', is_default: 1, active_version_id: 4 } as any] });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} versionId={3} /></div>);

    fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
    // The context line carries the exact version; the sentence stays generic rather than repeat it.
    expect(await screen.findByText('Compared with v2')).toBeVisible();
    expect(screen.getByText('Only block positions differ from the previous version.')).toBeVisible();
    expect(screen.queryByText(/current published version/)).not.toBeInTheDocument();
  });

  test('keeps draft editing and published history in the same version picker', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);

    const picker = await screen.findByRole('combobox', { name: 'Flow version' });
    expect(picker).toHaveValue('draft');
    fireEvent.click(picker);
    expect(screen.getByRole('option', { name: 'Draft v2 · edit' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /v1 · current/ })).toBeInTheDocument();
    fireEvent.click(picker);
    const historyButton = screen.getByRole('button', { name: 'Version history' });
    const publishButton = screen.getByRole('button', { name: 'Publish version' });
    expect(historyButton.querySelector('[data-icon="history"]')).toHaveAttribute('width', '18');
    expect(publishButton).toHaveAttribute('data-toolbar-action', 'publish');
    expect(publishButton.querySelector('[data-icon="publish"]')).toBeInTheDocument();
    const arrangeButton = screen.getByRole('button', { name: 'Automatically arrange flow' });
    expect(arrangeButton.parentElement).toHaveClass('canvas-edit-actions');
    const draftActions = Array.from(historyButton.parentElement!.children);
    expect(draftActions[0]).toBe(historyButton);
    expect(draftActions[1]).toBe(picker.closest('.version-picker'));
    expect(draftActions[2]).toBe(publishButton);
    fireEvent.click(historyButton);
    expect(screen.getByText('Draft changes')).toBeVisible();
    expect(screen.getByText('No changes to how this Flow runs')).toBeVisible();
    expect(screen.getByText('This draft matches the current published version.')).toBeVisible();

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('option', { name: /v1 · current/ }));
    await waitFor(() => expect(useAppStore.getState().viewFlowVersion).toHaveBeenCalledWith(1, 2));
  });

  test('uses stable semantic zoom levels', () => {
    expect(getFlowZoomMode(0.1)).toBe('overview');
    expect(getFlowZoomMode(0.349)).toBe('overview');
    expect(getFlowZoomMode(0.35)).toBe('compact');
    expect(getFlowZoomMode(0.549)).toBe('compact');
    expect(getFlowZoomMode(0.55)).toBe('detail');
    expect(getFlowZoomMode(1.6)).toBe('detail');
    expect(COMPACT_ZOOM_THRESHOLD).toBe(0.35);
    expect(DETAIL_ZOOM_THRESHOLD).toBe(0.55);
  });

  test('renames the Flow from its toolbar title', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Renamed delivery' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(1, { name: 'Renamed delivery' }));
    expect(await screen.findByText('Renamed delivery')).toBeVisible();
  });

  test('cancels a Flow rename without sending a request', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const input = screen.getByRole('textbox', { name: 'Flow name' });
    fireEvent.change(input, { target: { value: 'Discarded name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('button', { name: 'Rename flow Standard delivery' })).toBeVisible();
    expect(api.updateFlow).not.toHaveBeenCalled();
  });

  test('saves a Flow rename on blur and keeps editing after a failed request', async () => {
    vi.mocked(api.updateFlow).mockRejectedValueOnce(new Error('Rename failed.')).mockResolvedValueOnce({ flow: { id: 1, name: 'Saved on blur' } as any });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename flow Standard delivery' }));
    const retryInput = screen.getByRole('textbox', { name: 'Flow name' });
    fireEvent.change(retryInput, { target: { value: 'Retry name' } });
    fireEvent.blur(retryInput);
    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith(1, { name: 'Retry name' }));
    expect(screen.getByRole('textbox', { name: 'Flow name' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Flow name' }), { target: { value: 'Saved on blur' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Flow name' }));
    await waitFor(() => expect(api.updateFlow).toHaveBeenLastCalledWith(1, { name: 'Saved on blur' }));
    expect(await screen.findByText('Saved on blur')).toBeVisible();
  });

  test('reserves stable block geometry before semantic details change', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const decision = (await screen.findByLabelText('Decision block: Plan review')).closest('.react-flow__node-flowBlock');
    const agent = screen.getByLabelText('Agent block: Development').closest('.react-flow__node-flowBlock');
    expect(decision).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.decision}px` });
    expect(agent).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.agent}px` });

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(decision).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.decision}px` });
    expect(agent).toHaveStyle({ height: `${FLOW_NODE_HEIGHTS.agent}px` });
  });

  test('provides a dedicated readable summary for reduced zoom levels', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const block = await screen.findByLabelText('Decision block: Plan review');
    const summary = block.querySelector('.node-zoom-summary');
    expect(summary).toHaveTextContent('Decision');
    expect(summary).toHaveTextContent('Plan review');
    expect(summary).toHaveAttribute('aria-hidden', 'true');
    expect(summary?.querySelector('.node-zoom-icon')).toHaveAttribute('data-block-icon', 'decision');
    expect(summary?.querySelector('.node-zoom-icon svg')).toHaveAttribute('data-icon', 'question');
    const compensation = Number((document.querySelector('.editor-shell') as HTMLElement).style.getPropertyValue('--zoom-compensation'));
    expect(compensation).toBeGreaterThanOrEqual(1);
    expect(compensation).toBeLessThanOrEqual(1 / MIN_FLOW_ZOOM);
    expect(MIN_FLOW_ZOOM).toBe(0.2);
  });

  test('does not open block settings when a block is dragged', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const block = await screen.findByLabelText('Decision block: Plan review');

    fireEvent.mouseDown(block, { button: 0, clientX: 240, clientY: 220, view: window });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 300, clientY: 260, view: window });
    fireEvent.mouseUp(window, { button: 0, clientX: 300, clientY: 260, view: window });

    expect(block.closest('.react-flow__node')).toHaveClass('selected');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
  });

  test('loads the typed graph and exposes the accessible connection editor', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const planReview = await screen.findByLabelText('Decision block: Plan review');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    fireEvent.click(planReview);
    expect(await screen.findByLabelText('Connect approved')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Block inspector' })).toHaveClass('panel-open');
    expect(document.querySelector('.editor-main')).not.toHaveClass('has-inspector');
    expect(screen.getByText('Standard delivery')).toBeVisible();
    expect(screen.getByText('Saved')).toBeVisible();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version' })).toHaveTextContent('Publish version');
    expect(screen.getByRole('button', { name: 'Publish version' }).querySelector('[data-icon="publish"]')).toBeInTheDocument();
    expect(document.querySelector('.editor-shell')).toHaveAttribute('data-zoom-mode');
    expect(screen.getByLabelText('Decision block: Plan review')).toHaveAttribute('title', 'Decision: Plan review');
    const miniMap = screen.getByTestId('rf__minimap');
    expect(miniMap.style.getPropertyValue('--xy-minimap-mask-background-color-props')).toBe('rgba(5, 9, 8, 0.82)');
    expect(miniMap.querySelector('.react-flow__minimap-svg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close block inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();

    fireEvent.click(planReview);
    expect(screen.getByRole('complementary', { name: 'Block inspector' })).toHaveClass('panel-open');
    expect(screen.queryByRole('button', { name: 'Dismiss block inspector overlay' })).not.toBeInTheDocument();

    const pane = document.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    fireEvent.click(pane!);
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspector' })).not.toBeInTheDocument();
  });

  test('an Agent block only references an agent; it exposes no inline prompt config', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    const planning = await screen.findByLabelText('Agent block: Planning');
    fireEvent.click(planning);
    const agent = await screen.findByLabelText('Agent');
    fireEvent.click(agent);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Development' })).toBeInTheDocument());
    // The block is a pure reference — no prompt, effect level, or drift affordance.
    expect(screen.queryByLabelText('System prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Effect level')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update block/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Development' }));
    await waitFor(() => expect(agent).toHaveValue('development'));
    expect(screen.getByText('Build work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit agent/ })).toBeInTheDocument();
  });

  test('builds a new Agent block configuration as a bare reference to the agent', () => {
    expect(agentConfigFromPreset({ id: 9, preset_key: 'reviewer', name: 'Reviewer', description: '', system_prompt: 'Review the work.', created_at: '', updated_at: '' })).toEqual({
      name: 'Reviewer', preset: 'reviewer',
    });
  });

  test('opens the block library and adds a selected block without dragging', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 });
    vi.mocked(api.saveDraft).mockImplementation(async (_flowId, definition, _revision, actions) => ({
      draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null, action_history: actions } as any,
      validation: { valid: true, problems: [] },
    }));
    render(<div style={{ width: 520, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(screen.queryByText(/Flow editing needs/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Blocks' }));
    const library = screen.getByRole('complementary', { name: 'Block library' });
    expect(library).toHaveClass('panel-open');
    expect(screen.getByRole('button', { name: 'Blocks' }).parentElement?.parentElement).toHaveClass('editor-main');
    fireEvent.click(within(library).getByRole('button', { name: 'Add Agent block' }));

    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(vi.mocked(api.saveDraft).mock.calls[0]?.[3]).toEqual([expect.objectContaining({ kind: 'added', title: 'Added Agent block', blockType: 'agent', timestamp: expect.any(String) })]);
    expect(await screen.findByText('Saved')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(await screen.findByText('Added Agent block')).toBeVisible();
  });

  test('arranges the draft from the canvas controls and saves the new block positions', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');

    const arrangeButton = screen.getByRole('button', { name: 'Automatically arrange flow' });
    expect(arrangeButton.parentElement).toHaveClass('canvas-edit-actions');
    expect(arrangeButton.querySelector('[data-icon="layout"]')).toBeInTheDocument();
    fireEvent.click(arrangeButton);

    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await waitFor(() => expect(vi.mocked(api.saveDraft).mock.calls.some(([, definition]) => definition?.nodes?.some((node) => node.id === 'planning'))).toBe(true), { timeout: 2_000 });
    const savedDefinition = vi.mocked(api.saveDraft).mock.calls.find(([, definition]) => definition?.nodes?.some((node) => node.id === 'planning'))?.[1];
    const savedNodes = new Map(savedDefinition?.nodes.map((node) => [node.id, node]));
    expect(savedNodes.get('planning')!.position.x).toBeGreaterThan(savedNodes.get('begin')!.position.x);
    expect(savedNodes.get('plan-decision')!.position.x).toBeGreaterThan(savedNodes.get('planning')!.position.x);
  });

  test('keeps the compact canvas clear until a block is selected', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 });
    render(<div style={{ width: 520, height: 800 }}><FlowEditor flowId={1} /></div>);
    const canvas = await screen.findByRole('application');
    expect(canvas.parentElement?.parentElement).toHaveClass('editor-main');
    expect(screen.queryByRole('complementary', { name: 'Block inspector' })).not.toBeInTheDocument();
  });
  test('flushes a pending autosave before publishing', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(await screen.findByText('Unsaved changes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    expect(api.publishFlow).toHaveBeenCalledWith(1);
    await waitFor(() => expect(useAppStore.getState().viewFlowVersion).toHaveBeenCalledWith(1, 4));
  });

  test('keeps Publish available while an autosave is in flight', async () => {
    const definition = createRecommendedFlow();
    let resolveSave!: (value: any) => void;
    vi.mocked(api.saveDraft).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    const publishButton = screen.getByRole('button', { name: 'Publish version' });
    expect(publishButton).toBeEnabled();

    fireEvent.click(publishButton);
    expect(api.publishFlow).not.toHaveBeenCalled();

    resolveSave({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });

    await waitFor(() => expect(api.publishFlow).toHaveBeenCalledWith(1));
  });

  test('treats a viewport change as a draft change', async () => {
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');
    const zoomIndicator = await screen.findByLabelText('Current canvas zoom');
    const initialZoom = Number.parseInt(zoomIndicator.textContent ?? '', 10);
    expect(zoomIndicator).toHaveTextContent(/^\d+%$/);
    expect(zoomIndicator.parentElement).toHaveClass('react-flow__controls');
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(Number.parseInt(zoomIndicator.textContent ?? '', 10)).toBeGreaterThan(initialZoom));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    const savedDefinition = vi.mocked(api.saveDraft).mock.calls[0]?.[1];
    expect(savedDefinition?.viewport?.zoom).toBeGreaterThan(createRecommendedFlow().viewport?.zoom ?? 0);
  });

  test('saves a newer edit made while an autosave is in flight', async () => {
    const definition = createRecommendedFlow();
    let resolveFirstSave!: (value: any) => void;
    vi.mocked(api.saveDraft)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSave = resolve; }))
      .mockResolvedValueOnce({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 6, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    resolveFirstSave({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(await screen.findByText('Saved')).toBeVisible();
  });

  test('shows an autosave failure and retries after the next edit', async () => {
    const definition = createRecommendedFlow();
    vi.mocked(api.saveDraft)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ draft: { id: 3, flow_id: 1, version: 2, state: 'draft', draft_revision: 5, definition, compiled: null, published_at: null }, validation: { valid: true, problems: [] } });
    render(<div style={{ width: 1200, height: 800 }}><FlowEditor flowId={1} /></div>);
    await screen.findByLabelText('Decision block: Plan review');

    fireEvent.click(await screen.findByRole('button', { name: 'Zoom In' }));
    expect(await screen.findByText('Autosave failed', {}, { timeout: 2_000 })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(await screen.findByText('Saved')).toBeVisible();
  });
});
