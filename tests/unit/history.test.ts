import { describe, it, expect } from 'vitest';
import { createHistory } from '../../src/lib/history';

describe('history', () => {
  it('test_undo_redo', () => {
    const h = createHistory<string>();
    h.push('a');
    h.push('b');
    expect(h.undo()).toBe('a');
    expect(h.redo()).toBe('b');
  });

  it('test_single_state', () => {
    const h = createHistory<string>();
    h.push('a');
    expect(h.undo()).toBeUndefined();
    expect(h.canUndo()).toBe(false);
  });

  it('test_push_clears_redo', () => {
    const h = createHistory<string>();
    h.push('a');
    h.push('b');
    h.undo();
    h.push('c');
    expect(h.redo()).toBeUndefined();
    expect(h.undo()).toBe('a');
  });

  it('test_limit', () => {
    const h = createHistory<string>(2);
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBeUndefined();
  });
});
