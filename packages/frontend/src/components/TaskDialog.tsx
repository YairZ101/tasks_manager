import { useRef, type FormEventHandler, type ReactNode } from 'react';
import type { Task } from '../domain.js';
import DialogFrame from './DialogFrame.js';
import DialogLayer from './DialogLayer.js';
import TaskDetailsFields, { type TaskDetailLink, type TaskDetailValues } from './TaskDetailsFields.js';

export default function TaskDialog({
  mode,
  value,
  onChange,
  links,
  onLinksChange,
  tasks,
  candidateTasks,
  excludeTaskId,
  busy = false,
  footer,
  footerLayout = 'default',
  onSubmit,
  onClose,
}: {
  mode: 'create' | 'edit';
  value: TaskDetailValues;
  onChange: (value: TaskDetailValues) => void;
  links: TaskDetailLink[];
  onLinksChange: (links: TaskDetailLink[]) => void;
  tasks: Task[];
  candidateTasks?: Task[];
  excludeTaskId?: number;
  busy?: boolean;
  footer: ReactNode;
  footerLayout?: 'default' | 'run';
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
}) {
  const creating = mode === 'create';
  const titleInputRef = useRef<HTMLInputElement>(null);
  return <DialogLayer onDismiss={onClose} dismissDisabled={busy} initialFocusRef={titleInputRef}>
    <DialogFrame
      className="composer task-dialog"
      contextLabel={creating ? 'NEW TASK' : 'EDIT TASK'}
      title={creating ? 'Frame the outcome' : 'Refine the outcome'}
      closeLabel={creating ? 'Close new task' : 'Close task editor'}
      onClose={onClose}
      closeDisabled={busy}
      busy={busy}
      footer={footer}
      footerLayout={footerLayout}
      onSubmit={onSubmit}
    >
      <fieldset className="dialog-fields" disabled={busy}>
        <TaskDetailsFields
          value={value}
          onChange={onChange}
          links={links}
          onLinksChange={onLinksChange}
          tasks={tasks}
          candidateTasks={candidateTasks}
          excludeTaskId={excludeTaskId}
          autoFocus
          titleInputRef={titleInputRef}
          disabled={busy}
        />
      </fieldset>
    </DialogFrame>
  </DialogLayer>;
}
