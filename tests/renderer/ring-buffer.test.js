import { describe, it, expect } from 'vitest';
import { createRingBuffer } from '../../src/renderer/lib/utils/ring-buffer.ts';

describe('ring-buffer', () => {
  it('starts empty with length 0', () => {
    const rb = createRingBuffer(5);
    expect(rb.length).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it('pushes values and returns them in order', () => {
    const rb = createRingBuffer(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
    expect(rb.length).toBe(3);
  });

  it('wraps around when capacity exceeded', () => {
    const rb = createRingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // overwrites 1
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.length).toBe(3);
  });

  it('handles double-wrap correctly', () => {
    const rb = createRingBuffer(3);
    for (let i = 1; i <= 7; i++) rb.push(i);
    // Last 3 values: 5, 6, 7
    expect(rb.toArray()).toEqual([5, 6, 7]);
  });

  it('works with capacity of 1', () => {
    const rb = createRingBuffer(1);
    rb.push(10);
    expect(rb.toArray()).toEqual([10]);
    rb.push(20);
    expect(rb.toArray()).toEqual([20]);
    expect(rb.length).toBe(1);
  });

  it('uses custom fill value for pre-fill', () => {
    const rb = createRingBuffer(3, -1);
    // Before any push, toArray returns empty (count=0)
    expect(rb.toArray()).toEqual([]);
    rb.push(5);
    expect(rb.toArray()).toEqual([5]);
  });

  it('handles 60-element buffer (real-world size)', () => {
    const rb = createRingBuffer(60);
    for (let i = 0; i < 120; i++) rb.push(i);
    const arr = rb.toArray();
    expect(arr).toHaveLength(60);
    expect(arr[0]).toBe(60);
    expect(arr[59]).toBe(119);
  });
});
