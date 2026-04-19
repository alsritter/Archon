export type WorkflowExecutionView = 'graph' | 'logs' | 'chat';

export interface WorkflowExecutionLayoutInput {
  activeView: WorkflowExecutionView;
  isMobile: boolean;
}

export interface WorkflowExecutionLayout {
  mode: 'split' | 'stacked' | 'single';
  showNodeList: boolean;
}

export function getWorkflowExecutionLayout({
  activeView,
  isMobile,
}: WorkflowExecutionLayoutInput): WorkflowExecutionLayout {
  if (activeView === 'chat') {
    return {
      mode: 'single',
      showNodeList: false,
    };
  }

  if (isMobile) {
    return {
      mode: 'stacked',
      showNodeList: activeView === 'logs',
    };
  }

  return {
    mode: 'split',
    showNodeList: activeView === 'logs',
  };
}
