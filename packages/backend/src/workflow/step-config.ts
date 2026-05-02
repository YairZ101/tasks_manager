import { getWorkflowSteps } from './workflow-utils.js';

function collectCommitInstructions(): string[] {
  const lines: string[] = [];
  const steps = getWorkflowSteps();
  for (const step of steps) {
    let config: Record<string, unknown>;
    try { config = JSON.parse(step.config); } catch { continue; }

    switch (step.slug) {
      case 'planning': {
        if (config.trackInGit === false) {
          const location = (config.planLocation as string) || 'doc/plans/';
          lines.push(`- Do not include the plan file in \`${location}\` in any of the commits`);
        }
        break;
      }
    }
  }
  return lines;
}

export function getStepInstructions(slug: string, config?: Record<string, unknown>): string[] {
  switch (slug) {
    case 'planning': {
      const location = (config?.planLocation as string) || 'doc/plans/';
      const lines = [
        '## Instructions',
        '',
        'Your job in this step is to **create a plan** for the task described above.',
        '',
        '- Read the task description and acceptance criteria carefully.',
        '- Explore the codebase to understand the relevant files, modules, and architecture.',
        '- Break the task into concrete implementation steps.',
        '- Identify which files and modules need to change and why.',
        '- If acceptance criteria are missing or incomplete, draft them.',
        '- Write the plan as a structured markdown document.',
        `- Save the plan to \`${location}<task_key>.md\` (e.g., \`${location}TASK-1.md\`).`,
        '',
        '**Do NOT implement any code changes.** Only produce the plan.',
        '',
        '**Do NOT run any git commands.** Do not commit, stage, or push. Another step handles git.',
      ];
      return lines;
    }
    case 'development':
      return [
        '## Instructions',
        '',
        'Your job in this step is to **implement** the task described above.',
        '',
        '- Read the task description and acceptance criteria carefully.',
        '- Check if a plan file exists from a prior planning step and follow it if present.',
        '- Explore the codebase to understand the existing patterns and architecture before making changes.',
        '- Write the code changes needed to complete the task.',
        '- Run the project\'s tests. Check the project\'s README, AGENTS.md, Makefile, or package.json to find the correct test command.',
        '- Fix any test failures your changes introduce.',
        '- Run linting and type checking if the project uses them.',
        '',
        '**Do NOT run any git commands.** Do not commit, stage, or push. Another step handles git.',
      ];
    case 'visual-qa':
      return [
        '## Instructions',
        '',
        'Your job in this step is to **visually test** the task described above.',
        '',
        '- Start the application\'s dev server if it is not already running. Check the project\'s README, AGENTS.md, or package.json for the correct command.',
        '- Open the application in a browser using the available browser automation tool.',
        '- Navigate to the parts of the UI affected by this task.',
        '- Verify that the UI looks correct, interactions work as expected, and there are no visual regressions.',
        '- Check different viewport sizes if relevant (desktop, tablet, mobile).',
        '',
        'Write your findings to stdout as a structured report:',
        '- What you tested (which pages, flows, interactions).',
        '- What passed.',
        '- What failed, with specific details (what you expected vs. what you saw).',
        '',
        '**Do NOT modify any code.** This step is for testing and reporting only.',
        '',
        '**Do NOT run any git commands.** Do not commit, stage, or push.',
      ];
    case 'open-prs': {
      const lines = [
        '## Instructions',
        '',
        'Your job in this step is to **commit all changes, push, and open a pull request**.',
        '',
        '### 1. Review changes',
        '',
        '- Run `git status` to see all modified, staged, and untracked files.',
        '- Every change must be accounted for: either included in a commit or explicitly justified as excluded.',
        '- Do not stage build artifacts, dependency directories, or other files that should not be tracked.',
        '',
        '### 2. Plan your commits',
        '',
        '- Before committing anything, identify the distinct logical units in the changeset.',
        '- Each logical unit should be its own commit. Avoid a single catch-all commit when changes span multiple concerns.',
        '',
        '### 3. Create commits',
        '',
        '- Write clear commit messages: a short summary in imperative mood, optionally followed by a blank line and a longer explanation.',
        '- Match the commit message style and conventions used in this repository. Check recent commits with `git log --oneline -10` for reference.',
        '- After each commit, run `git status` to check for orphaned deletions or untracked files that belong to the same logical change. If found, stage them and amend the commit.',
        '- Add the trailer `Generated-by: Tasks Manager` to every commit message (after a blank line at the end of the message body).',
      ];

      const commitInstructions = collectCommitInstructions();
      if (commitInstructions.length > 0) {
        lines.push('');
        lines.push(...commitInstructions);
      }

      lines.push(
        '',
        '### 4. Push and open a pull request',
        '',
        '- Push the branch to the remote.',
        '- Open a pull request targeting the main branch.',
        '- Write a clear PR title that summarizes the change.',
        '- Write a PR description that explains what was changed, why, and any relevant context for reviewers.',
        '- If the repository has a PR template, follow it.',
        '- Add the following footer at the bottom of the PR description, separated by `---`:',
        '  ```',
        '  ---',
        '  🤖 Generated by Tasks Manager',
        '  ```',
      );

      if (config?.draft === true) {
        lines.push('- Open the PR as a draft.');
      }

      return lines;
    }
  }

  throw new Error(`No instructions defined for step "${slug}". Add a case in getStepInstructions().`);
}
