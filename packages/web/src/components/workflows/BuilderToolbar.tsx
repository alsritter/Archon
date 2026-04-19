import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { listWorkflows } from '@/lib/api';
import { useProject } from '@/contexts/ProjectContext';
import { useProviders } from '@/hooks/useProviders';

export type ViewMode = 'hidden' | 'split' | 'full';

export interface BuilderToolbarProps {
  workflowName: string;
  workflowDescription: string;
  provider: string | undefined;
  model: string | undefined;
  hasUnsavedChanges: boolean;
  validationErrors: string[];
  viewMode: ViewMode;
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onProviderChange: (p: string | undefined) => void;
  onModelChange: (m: string | undefined) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onValidate: () => void;
  onSave: () => void;
  onRun: () => void;
  onLoadWorkflow: (name: string) => void;
  isMobile?: boolean;
}

const VIEW_MODE_LABELS: readonly { value: ViewMode; label: string }[] = [
  { value: 'hidden', label: 'Visual' },
  { value: 'split', label: 'Split' },
  { value: 'full', label: 'YAML' },
];

export function BuilderToolbar({
  workflowName,
  workflowDescription,
  provider,
  model,
  hasUnsavedChanges,
  validationErrors,
  viewMode,
  onNameChange,
  onDescriptionChange,
  onProviderChange,
  onModelChange,
  onViewModeChange,
  onValidate,
  onSave,
  onRun,
  onLoadWorkflow,
  isMobile = false,
}: BuilderToolbarProps): React.ReactElement {
  const navigate = useNavigate();
  const { codebases, selectedProjectId } = useProject();
  const cwd = selectedProjectId
    ? codebases?.find(cb => cb.id === selectedProjectId)?.default_cwd
    : undefined;

  const { providers } = useProviders();
  const [showDescription, setShowDescription] = useState(false);

  const { data: workflows, isError: workflowsError } = useQuery({
    queryKey: ['workflows', cwd],
    queryFn: () => listWorkflows(cwd),
  });

  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div
          className={cn('flex items-center gap-2', isMobile && 'grid grid-cols-[1fr_auto] gap-2')}
        >
          <div className={cn('flex min-w-0 items-center gap-2', isMobile && 'contents')}>
            <select
              value=""
              onChange={(e): void => {
                if (e.target.value) onLoadWorkflow(e.target.value);
              }}
              className={cn(
                'rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent',
                isMobile ? 'w-full min-w-0' : 'w-[88px] shrink-0'
              )}
              title={
                workflowsError
                  ? 'Failed to load workflows — check server connection'
                  : 'Load workflow'
              }
            >
              <option value="">{workflowsError ? 'Load failed' : 'Load...'}</option>
              {(workflows ?? []).map(entry => (
                <option key={entry.workflow.name} value={entry.workflow.name}>
                  {entry.workflow.name}
                </option>
              ))}
            </select>

            {isMobile ? (
              <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
                <input
                  type="text"
                  value={workflowName}
                  onChange={(e): void => {
                    onNameChange(e.target.value);
                  }}
                  placeholder="workflow-name"
                  className="min-w-0 flex-1 bg-transparent text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
                />
                {hasUnsavedChanges && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                    title="Unsaved changes"
                  />
                )}
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={(): void => {
                    navigate('/workflows');
                  }}
                  className="shrink-0 text-xs text-text-tertiary hover:text-text-secondary"
                >
                  Workflows
                </button>
                <span className="shrink-0 text-xs text-text-tertiary">/</span>
                <input
                  type="text"
                  value={workflowName}
                  onChange={(e): void => {
                    onNameChange(e.target.value);
                  }}
                  placeholder="workflow-name"
                  className="min-w-[96px] max-w-[160px] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium text-text-primary placeholder:text-text-tertiary hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {hasUnsavedChanges && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                    title="Unsaved changes"
                  />
                )}
              </div>
            )}

            {!isMobile &&
              (showDescription ? (
                <input
                  type="text"
                  value={workflowDescription}
                  onChange={(e): void => {
                    onDescriptionChange(e.target.value);
                  }}
                  onBlur={(): void => {
                    setShowDescription(false);
                  }}
                  autoFocus
                  placeholder="Description..."
                  className="w-48 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text-secondary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              ) : (
                <button
                  type="button"
                  onClick={(): void => {
                    setShowDescription(true);
                  }}
                  className="hidden max-w-[120px] shrink-0 truncate text-[10px] text-text-tertiary hover:text-text-secondary sm:inline"
                  title={workflowDescription || 'Add description'}
                >
                  {workflowDescription || 'add description'}
                </button>
              ))}

            {!isMobile && (
              <span className="shrink-0 rounded-full bg-node-command/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-node-command">
                DAG
              </span>
            )}
          </div>

          <div className={cn('flex items-center gap-1.5', isMobile && 'justify-end')}>
            {validationErrors.length > 0 && (
              <span className="rounded-full bg-error/20 px-1.5 py-0.5 text-[10px] font-medium text-error">
                {validationErrors.length}
              </span>
            )}
            <Button variant="outline" size="xs" onClick={onValidate}>
              Validate
            </Button>
            <Button variant="secondary" size="xs" onClick={onSave} disabled={!workflowName.trim()}>
              Save
            </Button>
            <Button
              size="xs"
              onClick={onRun}
              disabled={!workflowName.trim() || hasUnsavedChanges}
              title={hasUnsavedChanges ? 'Save the workflow before running' : undefined}
              className="bg-node-command text-white hover:bg-node-command/90"
            >
              Run
            </Button>
          </div>
        </div>

        <div
          className={cn(
            'mt-2 flex items-center gap-1.5',
            isMobile ? 'flex-wrap' : 'justify-between'
          )}
        >
          <div className="flex items-center gap-1.5">
            <select
              value={provider ?? ''}
              onChange={(e): void => {
                onProviderChange(e.target.value || undefined);
              }}
              className={cn(
                'rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent',
                isMobile && 'max-w-[44vw]'
              )}
            >
              <option value="">Provider</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={model ?? ''}
              onChange={(e): void => {
                onModelChange(e.target.value || undefined);
              }}
              placeholder="Model"
              className={cn(
                'rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent',
                isMobile ? 'w-[96px]' : 'w-24'
              )}
            />
          </div>

          <div className="flex overflow-hidden rounded-md border border-border">
            {VIEW_MODE_LABELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={(): void => {
                  onViewModeChange(value);
                }}
                className={cn(
                  'px-2 py-1 text-[10px] font-medium transition-colors',
                  viewMode === value
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {workflowsError && (
        <div className="px-4 py-1.5 text-xs text-error bg-surface-inset border-b border-border">
          Failed to load workflow list. The load dropdown may be empty.
        </div>
      )}
    </>
  );
}
