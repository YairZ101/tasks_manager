import fs from 'fs';
import path from 'path';
import { parse } from 'shell-quote';
import type { WorkspaceConfig } from '../types.js';

export type WorkspaceConfigInput = { setup_command?: unknown; timeout_ms?: unknown };

export function suggestWorkspaceSetupCommand(repoRoot: string): string {
  const has = (name: string) => fs.existsSync(path.join(repoRoot, name));
  if (has('bun.lock') || has('bun.lockb')) return 'bun install --frozen-lockfile';
  if (has('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm ci';
  if (has('yarn.lock')) return 'yarn install --immutable';
  return '';
}

export function parseWorkspaceConfig(input: WorkspaceConfigInput, current: WorkspaceConfig): { config: WorkspaceConfig } | { error: string } {
  const rawCommand = input.setup_command ?? current.setup_command ?? '';
  if (typeof rawCommand !== 'string') return { error: 'Workspace setup command must be text.' };
  const setupCommand = rawCommand.trim();
  if (setupCommand.length > 2000) return { error: 'Workspace setup command must be 2,000 characters or fewer.' };
  const timeoutMs = input.timeout_ms ?? current.timeout_ms;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1000 || Number(timeoutMs) > 3_600_000) {
    return { error: 'Workspace setup timeout must be between 1 second and 60 minutes.' };
  }
  if (setupCommand) {
    try { parseWorkspaceCommand(setupCommand); }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
  return { config: { ...current, setup_command: setupCommand || null, timeout_ms: Number(timeoutMs) } };
}

export function parseWorkspaceCommand(command: string): string[] {
  const parsed = parse(command);
  if (!parsed.length) throw new Error('Add a workspace setup command or disable workspace preparation.');
  if (parsed.some((part) => typeof part !== 'string')) throw new Error('Workspace setup commands may contain arguments but not shell operators.');
  return parsed as string[];
}
