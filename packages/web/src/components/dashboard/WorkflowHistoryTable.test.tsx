import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { WorkflowHistoryTable } from './WorkflowHistoryTable';
import type { DashboardRunResponse } from '@/lib/api';

function createRun(overrides: Partial<DashboardRunResponse> = {}): DashboardRunResponse {
  return {
    id: 'run-1',
    workflow_name: 'Deploy docs',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: 'codebase-1',
    status: 'completed',
    user_message: 'Ship the latest documentation update',
    metadata: {},
    started_at: '2026-04-19T08:00:00.000Z',
    completed_at: '2026-04-19T08:03:30.000Z',
    last_activity_at: '2026-04-19T08:03:30.000Z',
    is_stale: false,
    stale_reason: null,
    working_path: '/tmp/docs',
    codebase_name: 'Archon Docs',
    platform_type: 'web',
    worker_platform_id: 'worker-1',
    parent_platform_id: null,
    current_step_name: null,
    total_steps: 4,
    current_step_status: null,
    agents_completed: null,
    agents_failed: null,
    agents_total: null,
    ...overrides,
  };
}

describe('WorkflowHistoryTable', () => {
  test('renders a mobile-friendly history card summary alongside the desktop table', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <WorkflowHistoryTable runs={[createRun()]} />
      </MemoryRouter>
    );

    expect(markup).toContain('Deploy docs');
    expect(markup).toContain('Project');
    expect(markup).toContain('Archon Docs');
    expect(markup).toContain('Source');
    expect(markup).toContain('Duration');
    expect(markup).toContain('Started');
    expect(markup).toContain('View Logs');
    expect(markup).toContain('<table');
  });

  test('labels stale runs so they do not look like healthy active runs', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <WorkflowHistoryTable
          runs={[
            createRun({
              status: 'running',
              completed_at: null,
              is_stale: true,
              stale_reason: 'No workflow activity recorded for over 30 minutes.',
            }),
          ]}
        />
      </MemoryRouter>
    );

    expect(markup).toContain('stale');
    expect(markup).toContain('No workflow activity recorded for over 30 minutes.');
  });
});
