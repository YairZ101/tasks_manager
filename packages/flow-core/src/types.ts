export type BlockType = 'begin' | 'agent' | 'check' | 'decision' | 'result' | 'note';
export type AgentPreset = string;
export type ResultCategory = 'completed' | 'paused' | 'cancelled';
export type DecisionTone = 'neutral' | 'positive' | 'warning' | 'destructive';

export interface CanvasPosition {
  x: number;
  y: number;
}

interface BaseNode<TType extends BlockType, TConfig> {
  id: string;
  type: TType;
  typeVersion: 1;
  position: CanvasPosition;
  config: TConfig;
}

export interface BeginNode extends BaseNode<'begin', { name: string }> {}

export interface AgentNodeConfig {
  name: string;
  preset: AgentPreset;
}

export interface AgentNode extends BaseNode<'agent', AgentNodeConfig> {}

export interface CheckNodeConfig {
  name: string;
  command: string;
  workingDirectory: string;
  timeoutMs: number;
}

export interface CheckNode extends BaseNode<'check', CheckNodeConfig> {}

export interface DecisionChoice {
  id: string;
  label: string;
  description?: string;
  commentRequired: boolean;
  tone: DecisionTone;
}

export interface DecisionNodeConfig {
  name: string;
  instructions?: string;
  choices: DecisionChoice[];
}

export interface DecisionNode extends BaseNode<'decision', DecisionNodeConfig> {}

export interface ResultNodeConfig {
  name: string;
  category: ResultCategory;
  message?: string;
}

export interface ResultNode extends BaseNode<'result', ResultNodeConfig> {}

export interface NoteNodeConfig {
  text: string;
  color: 'slate' | 'blue' | 'amber' | 'rose';
  width?: number;
  height?: number;
}

export interface NoteNode extends BaseNode<'note', NoteNodeConfig> {}

export type FlowNode = BeginNode | AgentNode | CheckNode | DecisionNode | ResultNode | NoteNode;

export interface FlowConnection {
  id: string;
  sourceNodeId: string;
  sourceOutcomeId: string;
  targetNodeId: string;
}

export interface FlowDefinition {
  schemaVersion: 1;
  nodes: FlowNode[];
  connections: FlowConnection[];
  viewport?: { x: number; y: number; zoom: number };
}

// Agents resolve live at run start, so a compiled Flow is structurally identical to its definition.
export type CompiledFlowNode = FlowNode;
export type CompiledFlowDefinition = FlowDefinition;

export interface ValidationProblem {
  code: string;
  message: string;
  nodeId?: string;
  connectionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

export interface AgentPresetDefinition {
  key: AgentPreset;
  name: string;
  description: string;
  systemPrompt: string;
}
