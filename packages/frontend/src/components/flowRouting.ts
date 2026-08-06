import { getNodeOutcomes, type FlowNode } from '@flow/core';

export type ConnectorPoint = { x: number; y: number };
export type ConnectorRoutingNode = {
  id: string;
  position: ConnectorPoint;
  width: number;
  height: number;
  flowNode: FlowNode;
};
export type ConnectorRoutingEdge = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
};
export type ConnectorRoute = {
  points: ConnectorPoint[];
  path: string;
  targetHandle: string;
};
export type ConnectorRoutePlan = {
  routes: Map<string, ConnectorRoute>;
};

type Rect = { left: number; top: number; right: number; bottom: number };
type Segment = { a: ConnectorPoint; b: ConnectorPoint };
type SearchDirection = 0 | 1 | 2;

export const FLOW_CONNECTOR_CLEARANCE = 28;
export const FLOW_CONNECTOR_LANE_GAP = 14;
export const FLOW_CONNECTOR_JUMP_RADIUS = 6;
export const FLOW_CONNECTOR_INPUT_APPROACH = 20;
const FLOW_CONNECTOR_OUTER_GAP = 48;
const FLOW_CONNECTOR_BEND_COST = 30;
const FLOW_CONNECTOR_CROSSING_COST = 480;
const EPSILON = 0.001;

function pointKey(point: ConnectorPoint): string {
  return `${point.x}:${point.y}`;
}

function samePoint(a: ConnectorPoint, b: ConnectorPoint): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function expandedRect(node: ConnectorRoutingNode): Rect {
  return {
    left: node.position.x - FLOW_CONNECTOR_CLEARANCE,
    top: node.position.y - FLOW_CONNECTOR_CLEARANCE,
    right: node.position.x + node.width + FLOW_CONNECTOR_CLEARANCE,
    bottom: node.position.y + node.height + FLOW_CONNECTOR_CLEARANCE,
  };
}

function nodeRect(node: ConnectorRoutingNode): Rect {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.width,
    bottom: node.position.y + node.height,
  };
}

function pointInsideRect(point: ConnectorPoint, rect: Rect): boolean {
  return point.x > rect.left + EPSILON && point.x < rect.right - EPSILON
    && point.y > rect.top + EPSILON && point.y < rect.bottom - EPSILON;
}

function segmentCrossesRect(segment: Segment, rect: Rect): boolean {
  if (Math.abs(segment.a.y - segment.b.y) < EPSILON) {
    if (segment.a.y <= rect.top + EPSILON || segment.a.y >= rect.bottom - EPSILON) return false;
    const left = Math.min(segment.a.x, segment.b.x);
    const right = Math.max(segment.a.x, segment.b.x);
    return right > rect.left + EPSILON && left < rect.right - EPSILON;
  }
  if (Math.abs(segment.a.x - segment.b.x) < EPSILON) {
    if (segment.a.x <= rect.left + EPSILON || segment.a.x >= rect.right - EPSILON) return false;
    const top = Math.min(segment.a.y, segment.b.y);
    const bottom = Math.max(segment.a.y, segment.b.y);
    return bottom > rect.top + EPSILON && top < rect.bottom - EPSILON;
  }
  return true;
}

function collinearOverlap(a: Segment, b: Segment): boolean {
  const aHorizontal = Math.abs(a.a.y - a.b.y) < EPSILON;
  const bHorizontal = Math.abs(b.a.y - b.b.y) < EPSILON;
  if (aHorizontal !== bHorizontal) return false;
  if (aHorizontal) {
    if (Math.abs(a.a.y - b.a.y) >= EPSILON) return false;
    return Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x))
      - Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)) > EPSILON;
  }
  if (Math.abs(a.a.x - b.a.x) >= EPSILON) return false;
  return Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y))
    - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) > EPSILON;
}

function perpendicularIntersection(horizontal: Segment, vertical: Segment): ConnectorPoint | null {
  const horizontalY = horizontal.a.y;
  const verticalX = vertical.a.x;
  const left = Math.min(horizontal.a.x, horizontal.b.x);
  const right = Math.max(horizontal.a.x, horizontal.b.x);
  const top = Math.min(vertical.a.y, vertical.b.y);
  const bottom = Math.max(vertical.a.y, vertical.b.y);
  if (verticalX <= left + EPSILON || verticalX >= right - EPSILON) return null;
  if (horizontalY <= top + EPSILON || horizontalY >= bottom - EPSILON) return null;
  return { x: verticalX, y: horizontalY };
}

function segmentIntersection(a: Segment, b: Segment): ConnectorPoint | null {
  const aHorizontal = Math.abs(a.a.y - a.b.y) < EPSILON;
  const bHorizontal = Math.abs(b.a.y - b.b.y) < EPSILON;
  if (aHorizontal === bHorizontal) return null;
  return aHorizontal ? perpendicularIntersection(a, b) : perpendicularIntersection(b, a);
}

function segments(points: ConnectorPoint[]): Segment[] {
  const result: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) result.push({ a: points[index - 1], b: points[index] });
  return result;
}

function compressPoints(points: ConnectorPoint[]): ConnectorPoint[] {
  const compact: ConnectorPoint[] = [];
  for (const point of points) {
    const previous = compact.at(-1);
    if (previous && samePoint(previous, point)) continue;
    const beforePrevious = compact.at(-2);
    if (beforePrevious && previous) {
      const sameX = Math.abs(beforePrevious.x - previous.x) < EPSILON && Math.abs(previous.x - point.x) < EPSILON;
      const sameY = Math.abs(beforePrevious.y - previous.y) < EPSILON && Math.abs(previous.y - point.y) < EPSILON;
      if (sameX || sameY) compact[compact.length - 1] = point;
      else compact.push(point);
    } else compact.push(point);
  }
  return compact;
}

function appendDistinct(target: ConnectorPoint[], points: ConnectorPoint[]) {
  for (const point of points) if (!target.length || !samePoint(target[target.length - 1], point)) target.push(point);
}

export function connectorSourcePortTop(index: number, count: number, height: number): number {
  if (count <= 0) return 50;
  const lastRow = height - 20;
  const firstRowFloor = Math.max(44, height * 0.5);
  const gap = count <= 1 ? 0 : Math.min(24, (lastRow - firstRowFloor) / (count - 1));
  const firstRow = lastRow - gap * (count - 1);
  return ((firstRow + Math.max(0, Math.min(index, count - 1)) * gap) / height) * 100;
}

function sourcePort(node: ConnectorRoutingNode, sourceHandle: string | null | undefined): ConnectorPoint {
  const outcomes = getNodeOutcomes(node.flowNode);
  const outcomeIndex = Math.max(0, outcomes.indexOf(sourceHandle ?? outcomes[0]));
  return {
    x: node.position.x + node.width,
    y: node.position.y + node.height * (connectorSourcePortTop(outcomeIndex, outcomes.length, node.height) / 100),
  };
}

function createInputApproaches(nodes: ConnectorRoutingNode[], edges: ConnectorRoutingEdge[]): Map<string, Map<string, number>> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, ConnectorRoutingEdge[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }
  const approaches = new Map<string, Map<string, number>>();
  for (const [targetId, targetEdges] of incoming) {
    const target = nodesById.get(targetId);
    if (!target) continue;
    const sorted = [...targetEdges].sort((a, b) => {
      const sourceA = nodesById.get(a.source);
      const sourceB = nodesById.get(b.source);
      const yA = sourceA ? sourcePort(sourceA, a.sourceHandle).y : 0;
      const yB = sourceB ? sourcePort(sourceB, b.sourceHandle).y : 0;
      return yA - yB || (sourceA?.position.x ?? 0) - (sourceB?.position.x ?? 0) || a.id.localeCompare(b.id);
    });
    approaches.set(targetId, new Map(sorted.map((edge, index) => [
      edge.id,
      FLOW_CONNECTOR_INPUT_APPROACH + index * FLOW_CONNECTOR_LANE_GAP,
    ])));
  }
  return approaches;
}

function availableInputApproach(target: ConnectorRoutingNode, nodes: ConnectorRoutingNode[]): number {
  const targetY = target.position.y + target.height / 2;
  let nearestRight = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    if (node.id === target.id) continue;
    const right = node.position.x + node.width;
    const coversInputY = targetY > node.position.y && targetY < node.position.y + node.height;
    if (coversInputY && right <= target.position.x) nearestRight = Math.max(nearestRight, right);
  }
  if (!Number.isFinite(nearestRight)) return Number.POSITIVE_INFINITY;
  return Math.max(2, (target.position.x - nearestRight) / 2);
}

function axisValues(anchors: number[], outerMin: number, outerMax: number): number[] {
  const base = [...new Set([...anchors, outerMin, outerMax])].sort((a, b) => a - b);
  const values = new Set(base);
  for (let index = 1; index < base.length; index += 1) {
    const start = base[index - 1];
    const end = base[index];
    const gap = end - start;
    if (gap < FLOW_CONNECTOR_LANE_GAP * 2) continue;
    const count = Math.min(7, Math.floor(gap / FLOW_CONNECTOR_LANE_GAP) - 1);
    for (let lane = 1; lane <= count; lane += 1) values.add(start + (gap * lane) / (count + 1));
  }
  return [...values].sort((a, b) => a - b);
}

class MinHeap<T> {
  private values: Array<{ priority: number; value: T }> = [];

  get size() { return this.values.length; }

  push(value: T, priority: number) {
    const item = { value, priority };
    this.values.push(item);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].priority <= priority) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = item;
  }

  pop(): T | undefined {
    if (!this.values.length) return undefined;
    const first = this.values[0].value;
    const last = this.values.pop();
    if (!this.values.length || !last) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].priority < this.values[left].priority ? right : left;
      if (this.values[child].priority >= last.priority) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

type SearchContext = {
  xValues: number[];
  yValues: number[];
  xIndex: Map<number, number>;
  yIndex: Map<number, number>;
  obstacles: Rect[];
};

function searchRoute(start: ConnectorPoint, end: ConnectorPoint, context: SearchContext, occupied: Segment[]): ConnectorPoint[] | null {
  const startX = context.xIndex.get(start.x);
  const startY = context.yIndex.get(start.y);
  const endX = context.xIndex.get(end.x);
  const endY = context.yIndex.get(end.y);
  if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return null;

  const width = context.xValues.length;
  const height = context.yValues.length;
  const stateCount = width * height * 3;
  const distance = new Float64Array(stateCount);
  distance.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const heap = new MinHeap<number>();
  const startState = (startY * width + startX) * 3;
  distance[startState] = 0;
  heap.push(startState, 0);

  let finalState = -1;
  while (heap.size) {
    const state = heap.pop();
    if (state === undefined) break;
    const direction = (state % 3) as SearchDirection;
    const pointIndex = Math.floor(state / 3);
    const xIndex = pointIndex % width;
    const yIndex = Math.floor(pointIndex / width);
    if (xIndex === endX && yIndex === endY) { finalState = state; break; }

    const current = { x: context.xValues[xIndex], y: context.yValues[yIndex] };
    const candidates: Array<[number, number, SearchDirection]> = [
      [xIndex - 1, yIndex, 1], [xIndex + 1, yIndex, 1],
      [xIndex, yIndex - 1, 2], [xIndex, yIndex + 1, 2],
    ];
    for (const [nextX, nextY, nextDirection] of candidates) {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = { x: context.xValues[nextX], y: context.yValues[nextY] };
      if (context.obstacles.some((rect) => pointInsideRect(next, rect))) continue;
      const candidate = { a: current, b: next };
      if (context.obstacles.some((rect) => segmentCrossesRect(candidate, rect))) continue;
      if (occupied.some((segment) => collinearOverlap(candidate, segment))) continue;
      const crossings = occupied.reduce((count, segment) => count + (segmentIntersection(candidate, segment) ? 1 : 0), 0);
      const length = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
      const bend = direction !== 0 && direction !== nextDirection ? FLOW_CONNECTOR_BEND_COST : 0;
      const nextState = (nextY * width + nextX) * 3 + nextDirection;
      const nextDistance = distance[state] + length + bend + crossings * FLOW_CONNECTOR_CROSSING_COST;
      if (nextDistance >= distance[nextState]) continue;
      distance[nextState] = nextDistance;
      previous[nextState] = state;
      const heuristic = Math.abs(end.x - next.x) + Math.abs(end.y - next.y);
      heap.push(nextState, nextDistance + heuristic);
    }
  }

  if (finalState < 0) return null;
  const route: ConnectorPoint[] = [];
  for (let state = finalState; state >= 0; state = previous[state]) {
    const pointIndex = Math.floor(state / 3);
    route.push({ x: context.xValues[pointIndex % width], y: context.yValues[Math.floor(pointIndex / width)] });
    if (state === startState) break;
  }
  route.reverse();
  return compressPoints(route);
}

function routeCrossings(routePoints: Map<string, ConnectorPoint[]>): Map<string, ConnectorPoint[]> {
  const jumps = new Map<string, ConnectorPoint[]>();
  const entries = [...routePoints.entries()];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    const [firstId, firstPoints] = entries[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const [secondId, secondPoints] = entries[secondIndex];
      for (const first of segments(firstPoints)) {
        for (const second of segments(secondPoints)) {
          const intersection = segmentIntersection(first, second);
          if (!intersection) continue;
          const firstHorizontal = Math.abs(first.a.y - first.b.y) < EPSILON;
          const jumpId = firstHorizontal ? firstId : secondId;
          const list = jumps.get(jumpId) ?? [];
          if (!list.some((point) => samePoint(point, intersection))) list.push(intersection);
          jumps.set(jumpId, list);
        }
      }
    }
  }
  return jumps;
}

export function createConnectorPath(points: ConnectorPoint[], jumps: ConnectorPoint[] = []): string {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const horizontal = Math.abs(start.y - end.y) < EPSILON;
    if (!horizontal) {
      path += ` L ${end.x} ${end.y}`;
      continue;
    }
    const direction = end.x >= start.x ? 1 : -1;
    const segmentJumps = jumps
      .filter((jump) => Math.abs(jump.y - start.y) < EPSILON
        && jump.x > Math.min(start.x, end.x) + FLOW_CONNECTOR_JUMP_RADIUS
        && jump.x < Math.max(start.x, end.x) - FLOW_CONNECTOR_JUMP_RADIUS)
      .sort((a, b) => direction * (a.x - b.x));
    for (const jump of segmentJumps) {
      path += ` L ${jump.x - direction * FLOW_CONNECTOR_JUMP_RADIUS} ${start.y}`;
      path += ` A ${FLOW_CONNECTOR_JUMP_RADIUS} ${FLOW_CONNECTOR_JUMP_RADIUS} 0 0 ${direction === 1 ? 1 : 0} ${jump.x + direction * FLOW_CONNECTOR_JUMP_RADIUS} ${start.y}`;
    }
    path += ` L ${end.x} ${end.y}`;
  }
  return path;
}

export function routeFlowConnectors(nodes: ConnectorRoutingNode[], edges: ConnectorRoutingEdge[]): ConnectorRoutePlan {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const inputApproaches = createInputApproaches(nodes, edges);
  const edgePorts = new Map<string, { source: ConnectorPoint; sourceStub: ConnectorPoint; target: ConnectorPoint; targetStub: ConnectorPoint; targetHandle: string }>();
  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const source = sourcePort(sourceNode, edge.sourceHandle);
    const target = { x: targetNode.position.x, y: targetNode.position.y + targetNode.height / 2 };
    const forwardGap = target.x - source.x;
    const sourceClearance = forwardGap > 0
      ? Math.min(FLOW_CONNECTOR_CLEARANCE, Math.max(2, forwardGap / 3))
      : FLOW_CONNECTOR_CLEARANCE;
    const desiredApproach = inputApproaches.get(edge.target)?.get(edge.id) ?? FLOW_CONNECTOR_INPUT_APPROACH;
    const forwardApproach = forwardGap > 0
      ? Math.min(desiredApproach, Math.max(2, forwardGap / 3))
      : desiredApproach;
    const targetApproach = Math.min(forwardApproach, availableInputApproach(targetNode, nodes));
    edgePorts.set(edge.id, {
      source,
      sourceStub: { x: source.x + sourceClearance, y: source.y },
      target,
      targetStub: { x: target.x - targetApproach, y: target.y },
      targetHandle: 'input',
    });
  }

  const obstacles = nodes.map(nodeRect);
  const clearanceRects = nodes.map(expandedRect);
  const minLeft = Math.min(0, ...clearanceRects.map((rect) => rect.left));
  const maxRight = Math.max(0, ...clearanceRects.map((rect) => rect.right));
  const minTop = Math.min(0, ...clearanceRects.map((rect) => rect.top));
  const maxBottom = Math.max(0, ...clearanceRects.map((rect) => rect.bottom));
  const outerDistance = FLOW_CONNECTOR_OUTER_GAP + edges.length * FLOW_CONNECTOR_LANE_GAP;
  const feedbackEdges = edges.filter((edge) => {
    const ports = edgePorts.get(edge.id);
    return ports ? ports.source.x >= ports.target.x : false;
  });
  const topLane = minTop - FLOW_CONNECTOR_OUTER_GAP;
  const bottomLane = maxBottom + FLOW_CONNECTOR_OUTER_GAP;
  const topCost = feedbackEdges.reduce((cost, edge) => {
    const ports = edgePorts.get(edge.id)!;
    return cost + Math.abs(ports.source.y - topLane) + Math.abs(ports.target.y - topLane);
  }, 0);
  const bottomCost = feedbackEdges.reduce((cost, edge) => {
    const ports = edgePorts.get(edge.id)!;
    return cost + Math.abs(ports.source.y - bottomLane) + Math.abs(ports.target.y - bottomLane);
  }, 0);
  const feedbackSide: 'top' | 'bottom' = topCost <= bottomCost ? 'top' : 'bottom';
  const feedbackLane = new Map<string, number>();
  [...feedbackEdges].sort((a, b) => a.id.localeCompare(b.id)).forEach((edge, index) => {
    feedbackLane.set(edge.id, feedbackSide === 'top'
      ? topLane - index * FLOW_CONNECTOR_LANE_GAP
      : bottomLane + index * FLOW_CONNECTOR_LANE_GAP);
  });

  const requiredX = clearanceRects.flatMap((rect) => [rect.left, rect.right]);
  const requiredY = clearanceRects.flatMap((rect) => [rect.top, rect.bottom]);
  for (const ports of edgePorts.values()) {
    requiredX.push(ports.sourceStub.x, ports.targetStub.x);
    requiredY.push(ports.sourceStub.y, ports.targetStub.y);
  }
  requiredY.push(...feedbackLane.values());
  const xValues = axisValues(requiredX, minLeft - outerDistance, maxRight + outerDistance);
  const yValues = axisValues(requiredY, minTop - outerDistance, maxBottom + outerDistance);
  const context: SearchContext = {
    xValues,
    yValues,
    xIndex: new Map(xValues.map((value, index) => [value, index])),
    yIndex: new Map(yValues.map((value, index) => [value, index])),
    obstacles,
  };

  const occupied: Segment[] = [];
  const routePoints = new Map<string, ConnectorPoint[]>();
  const orderedEdges = [...edges].sort((a, b) => {
    const aFeedback = feedbackLane.has(a.id) ? 1 : 0;
    const bFeedback = feedbackLane.has(b.id) ? 1 : 0;
    const aPorts = edgePorts.get(a.id);
    const bPorts = edgePorts.get(b.id);
    const aSpan = aPorts ? Math.abs(aPorts.target.x - aPorts.source.x) : 0;
    const bSpan = bPorts ? Math.abs(bPorts.target.x - bPorts.source.x) : 0;
    return aFeedback - bFeedback || aSpan - bSpan || a.id.localeCompare(b.id);
  });

  for (const edge of orderedEdges) {
    const ports = edgePorts.get(edge.id);
    if (!ports) continue;
    const points: ConnectorPoint[] = [ports.source, ports.sourceStub];
    const laneY = feedbackLane.get(edge.id);
    if (laneY === undefined) {
      appendDistinct(points, searchRoute(ports.sourceStub, ports.targetStub, context, occupied) ?? [ports.sourceStub, ports.targetStub]);
    } else {
      const sourceOuter = { x: ports.sourceStub.x, y: laneY };
      const targetOuter = { x: ports.targetStub.x, y: laneY };
      appendDistinct(points, searchRoute(ports.sourceStub, sourceOuter, context, occupied) ?? [ports.sourceStub, sourceOuter]);
      appendDistinct(points, [targetOuter]);
      appendDistinct(points, searchRoute(targetOuter, ports.targetStub, context, occupied) ?? [targetOuter, ports.targetStub]);
    }
    appendDistinct(points, [ports.targetStub]);
    const routed = compressPoints(points);
    occupied.push(...segments(routed));
    appendDistinct(points, [ports.target]);
    const compact = compressPoints(points);
    routePoints.set(edge.id, compact);
  }

  const jumps = routeCrossings(routePoints);
  const routes = new Map<string, ConnectorRoute>();
  for (const edge of edges) {
    const points = routePoints.get(edge.id);
    const ports = edgePorts.get(edge.id);
    if (!points || !ports) continue;
    routes.set(edge.id, {
      points,
      path: createConnectorPath(points, jumps.get(edge.id)),
      targetHandle: ports.targetHandle,
    });
  }
  return { routes };
}

export function connectorSegmentsOverlap(first: ConnectorPoint[], second: ConnectorPoint[]): boolean {
  return segments(first).some((a) => segments(second).some((b) => collinearOverlap(a, b)));
}

export function connectorCrossesRect(points: ConnectorPoint[], rect: Rect): boolean {
  return segments(points).some((segment) => segmentCrossesRect(segment, rect));
}
