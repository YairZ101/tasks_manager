import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { STEP_CATALOG, type StepConfigOption } from '../workflow/step-catalog.js';
import Tooltip from './Tooltip.js';

export interface EditorStep {
  id: string;
  slug: string;
  name: string;
  requires_review: boolean;
  config?: string;
}

interface WorkflowEditorProps {
  steps: EditorStep[];
  onAdd: (slug: string) => void;
  onRemove: (step: EditorStep) => void;
  onReorder: (steps: EditorStep[]) => void;
  onToggleReview: (step: EditorStep) => void;
  onSaveConfig?: (step: EditorStep, config: Record<string, any>) => void;
  showConfig?: boolean;
}

function getConfigSchema(slug: string): StepConfigOption[] {
  return STEP_CATALOG.find(s => s.slug === slug)?.configSchema ?? [];
}

function parseConfig(configStr?: string): Record<string, any> {
  if (!configStr) return {};
  try { return JSON.parse(configStr); } catch { return {}; }
}

function SortableStepRow({
  step,
  isOnly,
  hasConfig,
  isEditing,
  onToggleConfig,
  onDelete,
  onToggleReview,
}: {
  step: EditorStep;
  isOnly: boolean;
  hasConfig: boolean;
  isEditing: boolean;
  onToggleConfig: () => void;
  onDelete: () => void;
  onToggleReview: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-card border border-border">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-text-dim hover:text-text-muted"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="5.5" cy="4" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="4" r="1.2" fill="currentColor" />
            <circle cx="5.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="12" r="1.2" fill="currentColor" />
          </svg>
        </div>
        <span className="text-sm font-medium text-text flex-1">{step.name}</span>
        <button
          onClick={onToggleReview}
          className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors w-[120px] justify-end"
        >
          <span>Pause for review</span>
          <span className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${
            step.requires_review ? 'bg-accent' : 'bg-border'
          }`}>
            <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
              step.requires_review ? 'translate-x-3.5' : 'translate-x-0.5'
            }`} />
          </span>
        </button>
        <div className="flex gap-1 w-[60px] justify-end">
          {hasConfig && (
            <button
              onClick={onToggleConfig}
              className={`p-1.5 rounded transition-colors ${isEditing ? 'text-accent' : 'text-text-muted hover:text-text'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={isOnly}
            className="p-1.5 text-text-muted hover:text-danger rounded transition-colors disabled:opacity-20"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowEditor({
  steps,
  onAdd,
  onRemove,
  onReorder,
  onToggleReview,
  onSaveConfig,
  showConfig = false,
}: WorkflowEditorProps) {
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<Record<string, any>>({});
  const [draggingStep, setDraggingStep] = useState<EditorStep | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeSlugs = new Set(steps.map(s => s.slug));
  const availableSteps = STEP_CATALOG.filter(s => !activeSlugs.has(s.slug));

  const handleDragStart = (event: DragStartEvent) => {
    const step = steps.find(s => s.id === String(event.active.id));
    if (step) setDraggingStep(step);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingStep(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = steps.findIndex(s => s.id === String(active.id));
    const newIndex = steps.findIndex(s => s.id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(steps, oldIndex, newIndex));
  };

  const handleOpenConfig = (step: EditorStep) => {
    if (editingStepId === step.id) {
      setEditingStepId(null);
      return;
    }
    setEditingStepId(step.id);
    setEditConfig(parseConfig(step.config));
  };

  const handleSaveConfig = (step: EditorStep) => {
    onSaveConfig?.(step, editConfig);
    setEditingStepId(null);
  };

  return (
    <div className="space-y-5">
      {/* Current workflow */}
      <div>
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
          Your Workflow
        </h3>
        <div className="space-y-1">
          {/* Fixed: Todo */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg border border-border/50">
            <span className="text-sm font-medium text-text-dim">Todo</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card text-text-dim">Fixed</span>
          </div>

          {/* Sortable steps */}
          {steps.length === 0 && (
            <div className="flex items-center justify-center h-12 rounded-lg border border-dashed border-border text-xs text-text-dim">
              Add steps from the catalog below
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={steps.map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {steps.map((step) => {
                const schema = getConfigSchema(step.slug);
                const hasConfig = showConfig && schema.length > 0;
                const isEditing = editingStepId === step.id;

                return (
                  <div key={step.id}>
                    <SortableStepRow
                      step={step}
                      isOnly={steps.length <= 1}
                      hasConfig={hasConfig}
                      isEditing={isEditing}
                      onToggleConfig={() => handleOpenConfig(step)}
                      onDelete={() => onRemove(step)}
                      onToggleReview={() => onToggleReview(step)}
                    />

                    {/* Config form */}
                    {isEditing && onSaveConfig && (
                      <div className="ml-6 mt-1 p-3 rounded-lg bg-bg border border-border/50 space-y-3">
                        {schema.map(opt => (
                          <div key={opt.key}>
                            <label className="text-[11px] font-medium text-text-muted block mb-1">
                              {opt.label}
                            </label>
                            {opt.type === 'boolean' ? (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editConfig[opt.key] ?? opt.default}
                                  onChange={(e) => setEditConfig(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                                  className="rounded border-border"
                                />
                                <span className="text-xs text-text-muted">
                                  {editConfig[opt.key] ?? opt.default ? 'Yes' : 'No'}
                                </span>
                              </label>
                            ) : opt.type === 'number' ? (
                              <input
                                type="number"
                                value={editConfig[opt.key] ?? opt.default}
                                onChange={(e) => setEditConfig(prev => ({ ...prev, [opt.key]: Number(e.target.value) }))}
                                className="w-full px-2 py-1 text-xs bg-bg-input border border-border rounded text-text focus:outline-none focus:border-border-focus"
                              />
                            ) : opt.type === 'select' ? (
                              <select
                                value={editConfig[opt.key] ?? opt.default}
                                onChange={(e) => setEditConfig(prev => ({ ...prev, [opt.key]: e.target.value }))}
                                className="w-full px-2 py-1 text-xs bg-bg-input border border-border rounded text-text focus:outline-none focus:border-border-focus"
                              >
                                {opt.options?.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={editConfig[opt.key] ?? opt.default}
                                onChange={(e) => setEditConfig(prev => ({ ...prev, [opt.key]: e.target.value }))}
                                className="w-full px-2 py-1 text-xs bg-bg-input border border-border rounded text-text focus:outline-none focus:border-border-focus"
                              />
                            )}
                          </div>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleSaveConfig(step)}
                            className="px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingStepId(null)}
                            className="px-3 py-1 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </SortableContext>
            <DragOverlay>
              {draggingStep ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-card border border-accent/40 shadow-lg shadow-accent/10">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-muted">
                    <circle cx="5.5" cy="4" r="1.2" fill="currentColor" />
                    <circle cx="10.5" cy="4" r="1.2" fill="currentColor" />
                    <circle cx="5.5" cy="8" r="1.2" fill="currentColor" />
                    <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
                    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
                    <circle cx="10.5" cy="12" r="1.2" fill="currentColor" />
                  </svg>
                  <span className="text-sm font-medium text-text">{draggingStep.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Fixed: Done */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg border border-border/50">
            <span className="text-sm font-medium text-text-dim">Done</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card text-text-dim">Fixed</span>
          </div>
        </div>
      </div>

      {/* Available steps */}
      <div>
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
          Available Steps
        </h3>
        <div className="space-y-1">
          {availableSteps.map(entry => (
            <div key={entry.slug} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:border-accent/30 transition-colors">
              <div className="flex-1">
                <span className="text-sm font-medium text-text">{entry.name}</span>
                <p className="text-xs text-text-muted mt-0.5">{entry.description}</p>
              </div>
              <button
                onClick={() => onAdd(entry.slug)}
                className="px-2.5 py-1 text-xs font-medium text-accent hover:text-accent-hover hover:bg-accent-dim rounded-lg transition-colors"
              >
                Add
              </button>
            </div>
          ))}
          {availableSteps.length === 0 && (
            <p className="text-xs text-text-muted py-2 text-center">All steps added to your workflow.</p>
          )}
        </div>
      </div>
    </div>
  );
}
