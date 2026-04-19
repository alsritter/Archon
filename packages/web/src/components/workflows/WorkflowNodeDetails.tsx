import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { DagNode } from '@/lib/api';
import type { DagNodeState } from '@/lib/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { buildWorkflowNodeSections, getDagNodeKind } from '@/lib/workflow-node-details';

interface WorkflowNodeDetailsProps {
  node: DagNode | null;
  liveState?: DagNodeState | null;
}

function languageClass(language: string | undefined): string {
  switch (language) {
    case 'json':
      return 'text-emerald-300';
    case 'bash':
      return 'text-amber-300';
    case 'python':
      return 'text-sky-300';
    case 'typescript':
      return 'text-cyan-300';
    default:
      return 'text-text-secondary';
  }
}

export function WorkflowNodeDetails({
  node,
  liveState,
}: WorkflowNodeDetailsProps): React.ReactElement {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const sections = useMemo(
    () => (node ? buildWorkflowNodeSections(node, liveState) : []),
    [node, liveState]
  );
  const rawJsonSection = sections.find(section => section.title === 'Raw Node JSON');
  const visibleSections = sections.filter(section => section.title !== 'Raw Node JSON');
  const nodeKind = node ? getDagNodeKind(node) : 'unknown';
  const sectionKey = sections.map(section => section.title).join('|');

  useEffect(() => {
    const nextState = sections.reduce<Record<string, boolean>>((acc, section) => {
      acc[section.title] =
        section.title === 'Resolved Prompt' ||
        section.title === 'Prompt' ||
        section.title === 'Classifier Instructions' ||
        section.title === 'Script (bun)' ||
        section.title === 'Script (uv)' ||
        section.title === 'Shell' ||
        section.title === 'Approval Message' ||
        section.title === 'Command';
      return acc;
    }, {});
    setExpandedSections(nextState);
  }, [node?.id, sectionKey]);

  if (!node) {
    return (
      <div className="border-b border-border bg-surface px-4 py-3">
        <p className="text-sm text-text-secondary">
          Select a node to inspect its full prompt or script.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text-primary">{node.id}</h3>
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              {nodeKind}
            </span>
            {liveState?.status && (
              <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-text-secondary">
                {liveState.status}
              </span>
            )}
            {liveState?.duration !== undefined && (
              <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-text-secondary">
                {liveState.duration}ms
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
            {node.depends_on && node.depends_on.length > 0 && (
              <span>depends_on: {node.depends_on.join(', ')}</span>
            )}
            {node.when && <span>when: {node.when}</span>}
            {node.trigger_rule && <span>trigger_rule: {node.trigger_rule}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4">
        {[...visibleSections, ...(rawJsonSection ? [rawJsonSection] : [])].map(section => {
          const isExpanded = expandedSections[section.title] ?? false;

          return (
            <Collapsible
              key={section.title}
              open={isExpanded}
              onOpenChange={(open): void => {
                setExpandedSections(state => ({ ...state, [section.title]: open }));
              }}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-elevated/60">
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    )}
                    <h4 className="text-xs font-medium text-text-secondary">{section.title}</h4>
                    {section.language && (
                      <span
                        className={cn(
                          'rounded bg-background px-1.5 py-0.5 text-[10px] font-mono',
                          languageClass(section.language)
                        )}
                      >
                        {section.language}
                      </span>
                    )}
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-inset p-3 text-xs text-text-primary whitespace-pre-wrap break-words font-mono leading-relaxed">
                    {section.content}
                  </pre>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
