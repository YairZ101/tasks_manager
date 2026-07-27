export type BlockType = 'begin' | 'agent' | 'check' | 'decision' | 'result' | 'note';
export type EffectLevel = 'read_only' | 'workspace_write' | 'external_write';
export type AgentPreset = 'planning' | 'development' | 'visual-qa' | 'open-pr' | 'custom';
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

export interface DeclaredArtifact {
  kind: 'plan' | 'report' | 'file';
  path: string;
  includeInCommit?: boolean;
}

export interface AgentNodeConfig {
  name: string;
  preset: AgentPreset;
  instructions?: string;
  effectLevel: EffectLevel;
  planLocation?: string;
  trackInGit?: boolean;
  draftPullRequest?: boolean;
  artifacts?: DeclaredArtifact[];
}

export interface AgentNode extends BaseNode<'agent', AgentNodeConfig> {}

export interface CheckNodeConfig {
  name: string;
  command: string;
  workingDirectory: string;
  timeoutMs: number;
  effectLevel: EffectLevel;
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

export interface CompiledAgentNodeConfig extends AgentNodeConfig {
  compiledInstructions: string;
}

export type CompiledFlowNode = Exclude<FlowNode, AgentNode> | Omit<AgentNode, 'config'> & {
  config: CompiledAgentNodeConfig;
};

export interface CompiledFlowDefinition extends Omit<FlowDefinition, 'nodes'> {
  nodes: CompiledFlowNode[];
}

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
  effectLevel: EffectLevel;
  defaultConfig: Partial<AgentNodeConfig>;
}
