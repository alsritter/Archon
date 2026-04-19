import { describe, expect, it } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { dagNodesToReactFlow, hideTransitiveEdges } from './dag-layout';
import type { DagNode } from '@/lib/api';

describe('hideTransitiveEdges', () => {
  it('hides only transitive edges while preserving direct dependencies', () => {
    const edges: Edge[] = [
      { id: 'a->b', source: 'a', target: 'b' },
      { id: 'b->c', source: 'b', target: 'c' },
      { id: 'a->c', source: 'a', target: 'c' },
      { id: 'c->d', source: 'c', target: 'd' },
      { id: 'a->d', source: 'a', target: 'd' },
    ];

    const hidden = hideTransitiveEdges(edges);

    expect(hidden.find(edge => edge.id === 'a->b')?.hidden).toBeFalse();
    expect(hidden.find(edge => edge.id === 'b->c')?.hidden).toBeFalse();
    expect(hidden.find(edge => edge.id === 'c->d')?.hidden).toBeFalse();
    expect(hidden.find(edge => edge.id === 'a->c')?.hidden).toBeTrue();
    expect(hidden.find(edge => edge.id === 'a->d')?.hidden).toBeTrue();
  });

  it('preserves condition-only edges even when a dependency path already exists', () => {
    const edges: Edge[] = [
      { id: 'route->loop', source: 'route', target: 'loop', data: { isDependency: true } },
      { id: 'loop->final', source: 'loop', target: 'final', data: { isDependency: true } },
      { id: 'when:route->final', source: 'route', target: 'final', data: { isCondition: true } },
    ];

    const hidden = hideTransitiveEdges(edges);

    expect(hidden.find(edge => edge.id === 'route->loop')?.hidden).toBeFalse();
    expect(hidden.find(edge => edge.id === 'loop->final')?.hidden).toBeFalse();
    expect(hidden.find(edge => edge.id === 'when:route->final')?.hidden).toBeFalse();
  });
});

describe('dagNodesToReactFlow', () => {
  it('adds a synthetic condition edge when when: references a non-dependency node', () => {
    const dagNodes: DagNode[] = [
      { id: 'route', prompt: 'route' },
      {
        id: 'loop',
        depends_on: ['route'],
        when: "$route.output.review_path == 'design_gap'",
        loop: {
          prompt: 'loop',
          until: 'READY',
          max_iterations: 3,
          fresh_context: false,
        },
      } as DagNode,
      {
        id: 'final',
        depends_on: ['loop'],
        when: "$route.output.review_path == 'design_gap'",
        prompt: 'final',
      },
    ];

    const { edges } = dagNodesToReactFlow(dagNodes, { hideTransitiveEdges: true });

    expect(edges.find(edge => edge.id === 'loop->final')).toBeDefined();
    expect(edges.find(edge => edge.id === 'loop->final')?.data).toEqual({ isDependency: true });
    expect(edges.find(edge => edge.id === 'when:route->final')).toBeDefined();
    expect(edges.find(edge => edge.id === 'when:route->final')?.data).toEqual({
      isCondition: true,
    });
    expect(edges.find(edge => edge.id === 'when:route->final')?.hidden).toBeFalse();
  });
});
