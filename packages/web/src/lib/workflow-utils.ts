/**
 * Check if a workflow status represents a terminal (finished) state.
 */
export function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

interface WorkflowRunLike {
  status: string;
  is_stale?: boolean;
}

export function isStaleWorkflowRun(run: WorkflowRunLike | null | undefined): boolean {
  return run?.status === 'running' && run.is_stale === true;
}

export function isActiveWorkflowRun(run: WorkflowRunLike | null | undefined): boolean {
  if (!run) return false;
  if (isStaleWorkflowRun(run)) return false;
  return run.status === 'running' || run.status === 'pending' || run.status === 'paused';
}

export function getWorkflowRunDisplayStatus(run: WorkflowRunLike | null | undefined): string {
  if (!run) return 'unknown';
  return isStaleWorkflowRun(run) ? 'stale' : run.status;
}
