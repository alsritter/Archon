import { describe, expect, test } from 'bun:test';

import { getWorkflowExecutionLayout } from './workflow-execution-layout';

describe('getWorkflowExecutionLayout', () => {
  test('uses stacked panes for graph and logs on mobile', () => {
    expect(getWorkflowExecutionLayout({ activeView: 'graph', isMobile: true })).toEqual({
      mode: 'stacked',
      showNodeList: false,
    });
    expect(getWorkflowExecutionLayout({ activeView: 'logs', isMobile: true })).toEqual({
      mode: 'stacked',
      showNodeList: true,
    });
  });

  test('keeps split panes on desktop except for chat', () => {
    expect(getWorkflowExecutionLayout({ activeView: 'graph', isMobile: false })).toEqual({
      mode: 'split',
      showNodeList: false,
    });
    expect(getWorkflowExecutionLayout({ activeView: 'logs', isMobile: false })).toEqual({
      mode: 'split',
      showNodeList: true,
    });
    expect(getWorkflowExecutionLayout({ activeView: 'chat', isMobile: false })).toEqual({
      mode: 'single',
      showNodeList: false,
    });
  });
});
