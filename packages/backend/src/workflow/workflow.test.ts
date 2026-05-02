import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../db/database.js';
import { getStepInstructions } from './step-config.js';
import { getDefaultConfig, STEP_CATALOG } from './step-catalog.js';
import {
  getValidStatuses,
  isWorkflowStep,
  stepRequiresReview,
  getStepInfo,
  getNextStepSlug,
  getFirstWorkflowStep,
  invalidateStatusCache,
} from './workflow-utils.js';

describe('step-catalog', () => {
  test('STEP_CATALOG has all required fields', () => {
    for (const step of STEP_CATALOG) {
      expect(step.slug).toBeTruthy();
      expect(step.name).toBeTruthy();
      expect(typeof step.requiresReview).toBe('boolean');
      expect(step.description).toBeTruthy();
      expect(Array.isArray(step.configSchema)).toBe(true);
    }
  });

  test('slugs are unique', () => {
    const slugs = STEP_CATALOG.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('getDefaultConfig returns defaults from schema', () => {
    const config = getDefaultConfig('planning');
    expect(config.planLocation).toBe('doc/plans/');
    expect(config.trackInGit).toBe(true);
  });

  test('getDefaultConfig returns empty for step with no config', () => {
    const config = getDefaultConfig('development');
    expect(Object.keys(config)).toHaveLength(0);
  });

  test('getDefaultConfig returns empty for unknown slug', () => {
    const config = getDefaultConfig('nonexistent');
    expect(Object.keys(config)).toHaveLength(0);
  });
});

describe('step-config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wf-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('planning instructions include plan-specific guidance', () => {
    const lines = getStepInstructions('planning', { planLocation: 'doc/plans/' });
    const text = lines.join('\n');
    expect(text).toContain('create a plan');
    expect(text).toContain('doc/plans/');
    expect(text).toContain('Do NOT implement any code changes');
    expect(text).toContain('Do NOT run any git commands');
  });

  test('planning uses fallback location when not configured', () => {
    const lines = getStepInstructions('planning', {});
    const text = lines.join('\n');
    expect(text).toContain('doc/plans/');
  });

  test('development instructions include implementation guidance', () => {
    const lines = getStepInstructions('development');
    const text = lines.join('\n');
    expect(text).toContain('implement');
    expect(text).toContain('tests');
    expect(text).toContain('Do NOT run any git commands');
  });

  test('visual-qa instructions focus on testing not modifying', () => {
    const lines = getStepInstructions('visual-qa');
    const text = lines.join('\n');
    expect(text).toContain('visually test');
    expect(text).toContain('Do NOT modify any code');
    expect(text).toContain('Do NOT run any git commands');
  });

  test('open-prs instructions include commit and PR guidance', () => {
    const lines = getStepInstructions('open-prs', {});
    const text = lines.join('\n');
    expect(text).toContain('commit all changes');
    expect(text).toContain('pull request');
    expect(text).toContain('git status');
    expect(text).toContain('Generated-by: Tasks Manager');
  });

  test('open-prs includes draft instruction when configured', () => {
    const lines = getStepInstructions('open-prs', { draft: true });
    const text = lines.join('\n');
    expect(text).toContain('draft');
  });

  test('open-prs omits draft instruction when not configured', () => {
    const lines = getStepInstructions('open-prs', { draft: false });
    const text = lines.join('\n');
    expect(text).not.toContain('draft');
  });

  test('unknown slug throws error', () => {
    expect(() => getStepInstructions('nonexistent')).toThrow('No instructions defined for step');
  });
});

describe('workflow-utils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wf-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    invalidateStatusCache();
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('planning', 'Planning', 1, '{}', 1.0)").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('development', 'Development', 0, '{}', 2.0)").run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('getValidStatuses includes fixed statuses and workflow steps', () => {
    const statuses = getValidStatuses();
    expect(statuses).toContain('backlog');
    expect(statuses).toContain('todo');
    expect(statuses).toContain('planning');
    expect(statuses).toContain('development');
    expect(statuses).toContain('done');
  });

  test('isWorkflowStep returns true for active steps', () => {
    expect(isWorkflowStep('planning')).toBe(true);
    expect(isWorkflowStep('development')).toBe(true);
  });

  test('isWorkflowStep returns false for fixed statuses', () => {
    expect(isWorkflowStep('todo')).toBe(false);
    expect(isWorkflowStep('done')).toBe(false);
    expect(isWorkflowStep('backlog')).toBe(false);
  });

  test('isWorkflowStep returns false for unknown slugs', () => {
    expect(isWorkflowStep('nonexistent')).toBe(false);
  });

  test('stepRequiresReview returns correct values', () => {
    expect(stepRequiresReview('planning')).toBe(true);
    expect(stepRequiresReview('development')).toBe(false);
  });

  test('getStepInfo returns step details', () => {
    const info = getStepInfo('planning');
    expect(info).not.toBeNull();
    expect(info!.name).toBe('Planning');
    expect(info!.requires_review).toBe(1);
  });

  test('getStepInfo returns null for unknown slug', () => {
    expect(getStepInfo('nonexistent')).toBeNull();
  });

  test('getNextStepSlug returns next step by sort_order', () => {
    expect(getNextStepSlug('planning')).toBe('development');
  });

  test('getNextStepSlug returns done for last step', () => {
    expect(getNextStepSlug('development')).toBe('done');
  });

  test('getNextStepSlug returns done for unknown slug', () => {
    expect(getNextStepSlug('nonexistent')).toBe('done');
  });

  test('getFirstWorkflowStep returns step with lowest sort_order', () => {
    const first = getFirstWorkflowStep();
    expect(first).not.toBeNull();
    expect(first!.slug).toBe('planning');
  });

  test('invalidateStatusCache forces re-read', () => {
    const before = getValidStatuses();
    expect(before).toContain('planning');

    const db = getDb();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('visual-qa', 'Visual QA', 1, '{}', 3.0)").run();

    // Still cached
    const cached = getValidStatuses();
    expect(cached).not.toContain('visual-qa');

    invalidateStatusCache();
    const after = getValidStatuses();
    expect(after).toContain('visual-qa');
  });
});

describe('step-config collectCommitInstructions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wf-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('open-prs includes exclusion when planning trackInGit is false', () => {
    const db = getDb();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('planning', 'Planning', 1, '{\"planLocation\":\"plans/\",\"trackInGit\":false}', 1.0)").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('open-prs', 'Open PRs', 0, '{}', 2.0)").run();

    const lines = getStepInstructions('open-prs', {});
    const text = lines.join('\n');
    expect(text).toContain('Do not include the plan file');
    expect(text).toContain('plans/');
  });

  test('open-prs has no exclusion when planning trackInGit is true', () => {
    const db = getDb();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('planning', 'Planning', 1, '{\"planLocation\":\"doc/plans/\",\"trackInGit\":true}', 1.0)").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('open-prs', 'Open PRs', 0, '{}', 2.0)").run();

    const lines = getStepInstructions('open-prs', {});
    const text = lines.join('\n');
    expect(text).not.toContain('Do not include the plan file');
  });
});
