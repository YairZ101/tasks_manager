// Predefined workflow step catalog.
// Each entry defines a step that users can add to their workflow.
// Every step runs the agent. The requiresReview flag controls whether
// the task pauses for human review after the agent finishes.

export interface StepConfigOption {
  key: string;
  label: string;
  type: 'string' | 'boolean' | 'number' | 'select';
  default: string | boolean | number;
  options?: string[]; // for 'select' type
}

export interface CatalogStep {
  slug: string;
  name: string;
  requiresReview: boolean;
  description: string;
  configSchema: StepConfigOption[];
  fixed?: boolean;
}

export const STEP_CATALOG: CatalogStep[] = [
  {
    slug: 'todo',
    name: 'Todo',
    requiresReview: false,
    description: 'Tasks ready to be worked on.',
    configSchema: [],
    fixed: true,
  },
  {
    slug: 'planning',
    name: 'Planning',
    requiresReview: true,
    description: 'Breaks down the task, drafts acceptance criteria, identifies affected files.',
    configSchema: [
      { key: 'planLocation', label: 'Plan file location', type: 'string', default: 'doc/plans/' },
      { key: 'trackInGit', label: 'Commit plan file', type: 'boolean', default: true },
    ],
  },
  {
    slug: 'development',
    name: 'Development',
    requiresReview: false,
    description: 'Implements the task — writes code, runs tests, fixes issues.',
    configSchema: [],
  },
  {
    slug: 'visual-qa',
    name: 'Visual QA',
    requiresReview: true,
    description: 'Opens the app in a browser, explores the UI, and reports visual or functional issues.',
    configSchema: [],
  },
  {
    slug: 'open-prs',
    name: 'Open PRs',
    requiresReview: false,
    description: 'Creates pull request(s) for the agent\'s work.',
    configSchema: [
      { key: 'draft', label: 'Create as draft PR', type: 'boolean', default: false },
    ],
  },
  {
    slug: 'done',
    name: 'Done',
    requiresReview: false,
    description: 'Completed tasks.',
    configSchema: [
      { key: 'deleteBranch', label: 'Delete branch when task is done', type: 'boolean', default: true },
    ],
    fixed: true,
  },
];

// Get default config values for a catalog step
export function getDefaultConfig(slug: string): Record<string, string | boolean | number> {
  const step = STEP_CATALOG.find(s => s.slug === slug);
  if (!step) return {};
  const config: Record<string, string | boolean | number> = {};
  for (const opt of step.configSchema) {
    config[opt.key] = opt.default;
  }
  return config;
}
