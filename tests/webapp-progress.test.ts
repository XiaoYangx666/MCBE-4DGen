import { describe, expect, it } from 'vitest';
import { reporter } from '../webapp/engine/progress.ts';
import { VertexStream } from '../src/poly-mesh-writer.ts';

describe('conversion progress reporter', () => {
  it('reports the stage label with an optional detail line', () => {
    const seen: { label: string; detail?: string }[] = [];
    const report = reporter((update) => seen.push(update));
    report('减面 1/2', '头部');
    report('减面 2/2');
    expect(seen).toEqual([
      { label: '减面 1/2', detail: '头部' },
      { label: '减面 2/2' },
    ]);
  });

  it('survives a missing handler', () => {
    expect(() => reporter(undefined)('减面 1/2')).not.toThrow();
  });
});

describe('vertex stream dedupe', () => {
  it('keeps first-seen order and normalizes negative zero', () => {
    const stream = new VertexStream<number[]>();
    expect(stream.add([1, 2, 3])).toBe(0);
    expect(stream.add([1, 2, 3])).toBe(0);
    expect(stream.add([0, 2, 3])).toBe(1);
    expect(stream.add([-0, 2, 3])).toBe(1);
    expect(stream.add([1, 2, 4])).toBe(2);
    expect(stream.values).toHaveLength(3);
  });

  it('keeps tuples with different lengths apart', () => {
    const stream = new VertexStream<number[]>();
    expect(stream.add([1, 2])).toBe(0);
    expect(stream.add([1, 2, 0])).toBe(1);
  });
});
