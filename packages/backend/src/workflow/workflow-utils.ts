import { getDb } from '../db/database.js';
import fs from 'fs';
import path from 'path';
import type { WorkflowStep } from '../types.js';

let cachedValidStatuses: string[] | null = null;

export function invalidateStatusCache(): void {
  cachedValidStatuses = null;
}

export function getValidStatuses(): string[] {
  if (cachedValidStatuses) return cachedValidStatuses;
  const db = getDb();
  const steps = db.query<{ slug: string }, []>(
    'SELECT slug FROM workflow_steps ORDER BY sort_order'
  ).all();
  cachedValidStatuses = ['backlog', 'todo', ...steps.map(s => s.slug), 'done'];
  return cachedValidStatuses;
}

export function isWorkflowStep(slug: string): boolean {
  const db = getDb();
  const step = db.query<{ id: number }, [string]>(
    'SELECT id FROM workflow_steps WHERE slug = ?'
  ).get(slug);
  return !!step;
}

export function stepRequiresReview(slug: string): boolean {
  const db = getDb();
  const step = db.query<{ requires_review: number }, [string]>(
    'SELECT requires_review FROM workflow_steps WHERE slug = ?'
  ).get(slug);
  return step?.requires_review === 1;
}

export function getStepInfo(slug: string): { name: string; requires_review: number; sort_order: number; config: string } | null {
  const db = getDb();
  return db.query<{ name: string; requires_review: number; sort_order: number; config: string }, [string]>(
    'SELECT name, requires_review, sort_order, config FROM workflow_steps WHERE slug = ?'
  ).get(slug) ?? null;
}

export function getNextStepSlug(currentSlug: string): string {
  const current = getStepInfo(currentSlug);
  if (!current) return 'done';

  const db = getDb();
  const next = db.query<{ slug: string }, [number]>(
    'SELECT slug FROM workflow_steps WHERE sort_order > ? ORDER BY sort_order LIMIT 1'
  ).get(current.sort_order);

  return next?.slug ?? 'done';
}

export function getFirstWorkflowStep(): WorkflowStep | null {
  const db = getDb();
  return db.query<WorkflowStep, []>(
    'SELECT * FROM workflow_steps ORDER BY sort_order ASC LIMIT 1'
  ).get() ?? null;
}

export function getWorkflowSteps(): WorkflowStep[] {
  const db = getDb();
  return db.query<WorkflowStep, []>(
    'SELECT * FROM workflow_steps ORDER BY sort_order ASC'
  ).all();
}

export function cleanupReviewFiles(taskKey: string, repoRoot: string): void {
  const reviewDir = path.join(repoRoot, '.tasks_manager', 'reviews');
  if (!fs.existsSync(reviewDir)) return;

  try {
    const files = fs.readdirSync(reviewDir) as string[];
    for (const file of files) {
      if (file.startsWith(`${taskKey}-`) && file.endsWith('.md')) {
        fs.unlinkSync(path.join(reviewDir, file));
      }
    }
  } catch {
    // Best effort cleanup
  }
}
