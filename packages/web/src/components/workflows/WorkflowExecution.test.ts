import { describe, expect, test } from 'bun:test';

import { mergeWorkflowExecutionState } from './WorkflowExecution';
import type { WorkflowState } from '@/lib/types';

function makeWorkflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    runId: 'run-1',
    workflowName: 'story-brainstorm-design',
    status: 'running',
    dagNodes: [],
    artifacts: [],
    startedAt: 1000,
    currentTool: null,
    ...overrides,
  };
}

describe('mergeWorkflowExecutionState', () => {
  test('prefers REST state when terminal statuses conflict', () => {
    const initialData = makeWorkflow({
      status: 'completed',
      completedAt: 3000,
    });
    const liveWorkflow = makeWorkflow({
      status: 'failed',
      completedAt: 2500,
      error: 'stale failure',
    });

    expect(mergeWorkflowExecutionState(initialData, liveWorkflow, initialData.runId)).toEqual(
      initialData
    );
  });

  test('merges live details when statuses do not conflict', () => {
    const initialData = makeWorkflow({
      status: 'running',
      dagNodes: [{ nodeId: 'a', name: 'a', status: 'running' }],
    });
    const liveWorkflow = makeWorkflow({
      status: 'running',
      dagNodes: [{ nodeId: 'b', name: 'b', status: 'completed' }],
    });

    expect(mergeWorkflowExecutionState(initialData, liveWorkflow, initialData.runId)).toEqual({
      ...initialData,
      dagNodes: liveWorkflow.dagNodes,
    });
  });
});
