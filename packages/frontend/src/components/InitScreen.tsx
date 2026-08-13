import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, type AgentSetup, type FlowTemplate, type WorkspaceSetup } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { AgentPresetPicker, type AgentCliPreset } from './AgentPresetPicker.js';
import Button from './Button.js';
import { AppMark, BlockIcon, Icon, type BlockIconType } from './Icon.js';
import SelectionMenu from './SelectionMenu.js';

type SetupStep = 1 | 2 | 3 | 4 | 5;
type AgentTestState = 'idle' | 'testing' | 'success' | 'failure';

type OnboardingDraft = {
  version: 2;
  step: SetupStep;
  prefix: string;
  agent: AgentSetup;
  workspaceSetup: WorkspaceSetup;
  flowTemplate: FlowTemplate;
};

const STORAGE_KEY = 'flow:onboarding:v2';
const steps = ['Agent', 'Test', 'Project key', 'Workspace', 'Starting Flow'];
const templateOptions: Array<{ key: FlowTemplate; title: string; detail: string; nodes: BlockIconType[] }> = [
  { key: 'recommended', title: 'Recommended delivery', detail: 'Planning, checks, decisions, and an explicit finish path.', nodes: ['begin', 'agent', 'decision', 'agent', 'check', 'result'] },
  { key: 'minimal', title: 'Minimal delivery', detail: 'One Development Agent between Begin and Completed.', nodes: ['begin', 'agent', 'result'] },
  { key: 'blank', title: 'Blank Flow', detail: 'A valid Begin-to-Completed shell, ready for your own blocks.', nodes: ['begin', 'result'] },
];
const promptDeliveryOptions = [
  { value: 'stdin', label: 'Standard input' },
  { value: 'argument', label: 'Final argument' },
  { value: 'flag', label: 'Named flag' },
];

function suggestedPrefix(repoName: string): string {
  return repoName.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'TASK';
}

function createDraft(repoName: string): OnboardingDraft {
  return {
    version: 2,
    step: 1,
    prefix: suggestedPrefix(repoName),
    agent: { cli_cmd: 'codex exec --full-auto', cli_prompt_mode: 'stdin', cli_prompt_flag: '' },
    workspaceSetup: { setup_command: '', timeout_ms: 600000 },
    flowTemplate: 'recommended',
  };
}

function isFlowTemplate(value: unknown): value is FlowTemplate {
  return templateOptions.some((option) => option.key === value);
}

function readDraft(repoName: string): OnboardingDraft {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<OnboardingDraft> | null;
    const flowTemplate = parsed?.flowTemplate;
    if (parsed?.version === 2 && parsed.agent && parsed.workspaceSetup && typeof parsed.prefix === 'string' && isFlowTemplate(flowTemplate) && parsed.step && parsed.step >= 1 && parsed.step <= 5) {
      return {
        version: 2,
        step: parsed.step,
        prefix: parsed.prefix,
        agent: {
          cli_cmd: parsed.agent.cli_cmd ?? '',
          cli_prompt_mode: parsed.agent.cli_prompt_mode ?? 'stdin',
          cli_prompt_flag: parsed.agent.cli_prompt_flag ?? '',
        },
        workspaceSetup: {
          setup_command: parsed.workspaceSetup.setup_command ?? '',
          timeout_ms: parsed.workspaceSetup.timeout_ms ?? 600000,
        },
        flowTemplate,
      };
    }
  } catch {}
  return createDraft(repoName);
}

function FlowTemplatePreview({ nodes }: { nodes: BlockIconType[] }) {
  return <span className="template-preview" aria-hidden="true">
    {nodes.map((node, index) => <span key={`${node}-${index}`} className={node} data-block-icon={node}>{index > 0 && <i />}<BlockIcon type={node} /></span>)}
  </span>;
}

export default function InitScreen() {
  const { repoName, bootstrap } = useAppStore();
  const [draft, setDraft] = useState<OnboardingDraft>(() => readDraft(repoName));
  const [agentTestState, setAgentTestState] = useState<AgentTestState>('idle');
  const [agentTestOutput, setAgentTestOutput] = useState('');
  const [agentTestError, setAgentTestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [workspaceSuggestion, setWorkspaceSuggestion] = useState('');
  const validAgent = draft.agent.cli_cmd.trim().length > 0 && (draft.agent.cli_prompt_mode !== 'flag' || Boolean(draft.agent.cli_prompt_flag?.trim()));
  const validPrefix = /^[A-Z0-9]{1,5}$/.test(draft.prefix);
  const selectedTemplate = useMemo(() => templateOptions.find((option) => option.key === draft.flowTemplate)!, [draft.flowTemplate]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    void api.getWorkspaceConfig().then(({ suggestedCommand }) => {
      setWorkspaceSuggestion(suggestedCommand);
      setDraft((current) => current.workspaceSetup.setup_command || !suggestedCommand
        ? current
        : { ...current, workspaceSetup: { ...current.workspaceSetup, setup_command: suggestedCommand } });
    });
  }, []);

  const updateAgent = (changes: Partial<AgentSetup>) => {
    setDraft((current) => ({ ...current, agent: { ...current.agent, ...changes } }));
    setAgentTestState('idle');
    setAgentTestOutput('');
    setAgentTestError('');
  };

  const applyPreset = (preset: AgentCliPreset) => updateAgent({ cli_cmd: preset.cli_cmd, cli_prompt_mode: preset.cli_prompt_mode, cli_prompt_flag: preset.cli_prompt_flag ?? '' });

  const selectTemplate = (flowTemplate: FlowTemplate) => setDraft((current) => ({ ...current, flowTemplate }));
  const moveTemplateSelection = (event: React.KeyboardEvent<HTMLButtonElement>, currentTemplate: FlowTemplate) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const currentIndex = templateOptions.findIndex((option) => option.key === currentTemplate);
    const next = templateOptions[(currentIndex + direction + templateOptions.length) % templateOptions.length]!;
    selectTemplate(next.key);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-flow-template="${next.key}"]`)?.focus());
  };

  const testAgent = async () => {
    if (!validAgent) return;
    setAgentTestState('testing');
    setAgentTestOutput('');
    setAgentTestError('');
    try {
      const result = await api.testAgentConfigStream(draft.agent, (line) => setAgentTestOutput((current) => current ? `${current}\n${line}` : line));
      if (result.success) setAgentTestState('success');
      else {
        setAgentTestState('failure');
        setAgentTestError(result.error ?? 'The Agent CLI did not complete successfully.');
      }
    } catch (error) {
      setAgentTestState('failure');
      setAgentTestError(error instanceof Error ? error.message : 'Could not test the Agent CLI.');
    }
  };

  const finish = async () => {
    if (!validAgent || !validPrefix || agentTestState !== 'success') return;
    setSaving(true);
    try {
      await api.completeInitialization({ prefix: draft.prefix, repoName, flowTemplate: draft.flowTemplate, agent: draft.agent, workspaceSetup: draft.workspaceSetup });
      window.localStorage.removeItem(STORAGE_KEY);
      await bootstrap();
      toast.success(`${selectedTemplate.title} is ready.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Setup could not be completed.');
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (draft.step === 1 && validAgent) setDraft((current) => ({ ...current, step: 2 }));
    if (draft.step === 2 && agentTestState === 'success') setDraft((current) => ({ ...current, step: 3 }));
    if (draft.step === 3 && validPrefix) setDraft((current) => ({ ...current, step: 4 }));
    if (draft.step === 4) setDraft((current) => ({ ...current, step: 5 }));
  };

  const back = () => setDraft((current) => ({ ...current, step: Math.max(1, current.step - 1) as SetupStep }));

  return <main className="init-screen">
    <div className="init-grid" />
    <section className="init-copy">
      <AppMark variant="large" />
      <span className="eyebrow">WORKSPACE SETUP</span>
      <h1>Make work<br/><em>traceable.</em></h1>
      <p>Connect an Agent, prove the command works, then choose the first Flow your tasks will follow.</p>
      <div className="init-path"><span>Agent</span><i /><span>Verify</span><i /><span>Key</span><i /><span>Workspace</span><i /><span>Flow</span></div>
    </section>
    <form className="init-form" onSubmit={(event) => { event.preventDefault(); draft.step === 5 ? void finish() : next(); }}>
      <ol className="setup-progress" aria-label="Setup progress">
        {steps.map((label, index) => <li key={label} className={index + 1 === draft.step ? 'current' : index + 1 < draft.step ? 'complete' : ''}><span>{index + 1}</span>{label}</li>)}
      </ol>

      {draft.step === 1 && <section className="setup-step">
        <header><span>01 / 05</span><h2>Connect an Agent</h2><p>This command runs every Agent block in your Flow.</p></header>
        <AgentPresetPicker value={draft.agent} onSelect={applyPreset} />
        <label htmlFor="init-agent-command">Agent CLI command<input id="init-agent-command" autoFocus required value={draft.agent.cli_cmd} onChange={(event) => updateAgent({ cli_cmd: event.target.value })} placeholder="codex exec --full-auto" /></label>
        <div className="field-grid">
          <SelectionMenu label="Prompt delivery" value={draft.agent.cli_prompt_mode} options={promptDeliveryOptions} onChange={(value) => updateAgent({ cli_prompt_mode: value as AgentSetup['cli_prompt_mode'] })} className="form-selection init-selection" />
          <label htmlFor="init-prompt-flag">Prompt flag<input id="init-prompt-flag" value={draft.agent.cli_prompt_flag ?? ''} disabled={draft.agent.cli_prompt_mode !== 'flag'} onChange={(event) => updateAgent({ cli_prompt_flag: event.target.value })} placeholder="--prompt" /></label>
        </div>
        {draft.agent.cli_prompt_mode === 'flag' && !draft.agent.cli_prompt_flag?.trim() && <p className="field-error">Add the flag your CLI expects before continuing.</p>}
      </section>}

      {draft.step === 2 && <section className="setup-step">
        <header><span>02 / 05</span><h2>Verify the Agent</h2><p>We send a short prompt to the exact command you just entered. Nothing in your project is changed.</p></header>
        <div className={`agent-test ${agentTestState}`}><div><span className="test-signal" /><strong>{agentTestState === 'success' ? 'Agent responded' : agentTestState === 'failure' ? 'Test failed' : 'Ready to test'}</strong><small>{agentTestState === 'success' ? 'You can continue to project setup.' : 'The command runs from this workspace.'}</small></div><Button variant="ghost" loading={agentTestState === 'testing'} loadingLabel="Testing…" disabled={!validAgent} onClick={() => void testAgent()}>{agentTestState === 'failure' ? 'Retry test' : 'Test Agent'}</Button></div>
        {(agentTestOutput || agentTestError) && <div className={`agent-test-output ${agentTestState === 'failure' ? 'failure' : ''}`} role="status"><span>{agentTestState === 'failure' ? 'ERROR' : 'OUTPUT'}</span><pre>{agentTestOutput || agentTestError}</pre>{agentTestOutput && agentTestError && <p>{agentTestError}</p>}</div>}
      </section>}

      {draft.step === 3 && <section className="setup-step">
        <header><span>03 / 05</span><h2>Name the project</h2><p>The project key keeps each task easy to scan and reference.</p></header>
        <label htmlFor="init-project-key">Project key<input id="init-project-key" autoFocus required pattern="[A-Z0-9]{1,5}" maxLength={5} value={draft.prefix} onChange={(event) => setDraft((current) => ({ ...current, prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} /><small>New tasks will be named {draft.prefix || 'KEY'}-1, {draft.prefix || 'KEY'}-2, and so on.</small></label>
        {!validPrefix && <p className="field-error">Use 1–5 uppercase letters or numbers.</p>}
        <div className="project-context"><span className="brand-mark">{draft.prefix || 'KEY'}</span><div><strong>{repoName}</strong><small>Current workspace</small></div></div>
      </section>}

      {draft.step === 4 && <section className="setup-step">
        <header><span>04 / 05</span><h2>Prepare task workspaces</h2><p>This command runs inside each task worktree before its Flow starts.</p></header>
        <label htmlFor="init-workspace-command">Setup command<input id="init-workspace-command" autoFocus value={draft.workspaceSetup.setup_command} onChange={(event) => setDraft((current) => ({ ...current, workspaceSetup: { ...current.workspaceSetup, setup_command: event.target.value } }))} placeholder={workspaceSuggestion || 'bun install --frozen-lockfile'} /><small>Leave empty to start Runs without installing dependencies.</small></label>
        <label htmlFor="init-workspace-timeout">Timeout (minutes)<input id="init-workspace-timeout" type="number" min="1" max="60" value={Math.round(draft.workspaceSetup.timeout_ms / 60000)} onChange={(event) => setDraft((current) => ({ ...current, workspaceSetup: { ...current.workspaceSetup, timeout_ms: Number(event.target.value) * 60000 } }))} /></label>
        <div className="settings-note"><Icon name="branch" /><div><strong>Isolated by task</strong><p>Dependencies stay inside the task worktree. The main checkout and other tasks are not shared.</p></div></div>
      </section>}

      {draft.step === 5 && <section className="setup-step flow-choice-step">
        <header><span>05 / 05</span><h2>Choose a starting Flow</h2><p>You can edit the graph at any time. This only defines the first published version.</p></header>
        <div className="template-grid" role="radiogroup" aria-label="Starting Flow template">
          {templateOptions.map((option) => <button type="button" role="radio" aria-checked={draft.flowTemplate === option.key} data-flow-template={option.key} key={option.key} className={`template-card ${draft.flowTemplate === option.key ? 'selected' : ''}`} onClick={() => selectTemplate(option.key)} onKeyDown={(event) => moveTemplateSelection(event, option.key)}><FlowTemplatePreview nodes={option.nodes} /><strong>{option.title}</strong><small>{option.detail}</small></button>)}
        </div>
      </section>}

      <footer className="setup-actions">
        <Button variant="ghost" onClick={back} disabled={draft.step === 1 || saving}>Back</Button>
        {draft.step === 5 ? <Button type="submit" variant="primary" icon="arrow" iconPosition="end" iconSize={18} loading={saving} loadingLabel="Publishing…">Finish setup</Button> : <Button type="submit" variant="primary" icon="arrow" iconPosition="end" iconSize={18} disabled={(draft.step === 1 && !validAgent) || (draft.step === 2 && agentTestState !== 'success') || (draft.step === 3 && !validPrefix)}>{draft.step === 2 && agentTestState !== 'success' ? 'Test to continue' : 'Continue'}</Button>}
      </footer>
      <p className="fine-print">Your setup progress stays in this browser until you finish. Existing legacy databases are never changed.</p>
    </form>
  </main>;
}
