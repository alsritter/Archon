import { describe, expect, it } from 'bun:test';
import { nodeOutputSchema } from './workflow-run';

describe('nodeOutputSchema payload support', () => {
  it('accepts payload on completed nodes', () => {
    const parsed = nodeOutputSchema.parse({
      state: 'completed',
      output: 'summary',
      payload: { action: 'direct_develop', score: 0.9, ok: true },
    });

    expect(parsed).toEqual({
      state: 'completed',
      output: 'summary',
      payload: { action: 'direct_develop', score: 0.9, ok: true },
    });
  });

  it('accepts payload on failed nodes', () => {
    const parsed = nodeOutputSchema.parse({
      state: 'failed',
      output: 'bad output',
      payload: ['a', 1, false, null],
      error: 'boom',
    });

    expect(parsed).toEqual({
      state: 'failed',
      output: 'bad output',
      payload: ['a', 1, false, null],
      error: 'boom',
    });
  });

  it('accepts scalar and null payload values', () => {
    expect(
      nodeOutputSchema.parse({ state: 'completed', output: 'x', payload: 'hello' }).payload
    ).toBe('hello');
    expect(nodeOutputSchema.parse({ state: 'completed', output: 'x', payload: 42 }).payload).toBe(
      42
    );
    expect(nodeOutputSchema.parse({ state: 'completed', output: 'x', payload: null }).payload).toBe(
      null
    );
  });

  it('rejects payload on pending and skipped nodes', () => {
    expect(() =>
      nodeOutputSchema.parse({ state: 'pending', output: '', payload: { no: 'thanks' } })
    ).toThrow();
    expect(() =>
      nodeOutputSchema.parse({ state: 'skipped', output: '', payload: { no: 'thanks' } })
    ).toThrow();
  });
});
