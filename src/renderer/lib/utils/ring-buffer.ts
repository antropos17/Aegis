/**
 * ring-buffer.ts — Fixed-size circular buffer for time-series data [F3.2]
 * O(1) push, zero GC pressure. Used for footer mini chart history.
 */

/**
 * Create a fixed-size ring buffer pre-filled with a default value.
 * Returns an object with `push()` to add values and `toArray()` to
 * read the buffer in insertion order (oldest → newest).
 *
 * @param capacity - Maximum number of elements
 * @param fill - Initial fill value (default: 0)
 */
export function createRingBuffer(capacity: number, fill = 0) {
  const buf = new Array<number>(capacity).fill(fill);
  let head = 0;
  let count = 0;

  return {
    /** Append a value, overwriting the oldest if full. */
    push(value: number): void {
      buf[head] = value;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
    },

    /** Return values in insertion order (oldest first). */
    toArray(): number[] {
      if (count < capacity) {
        return buf.slice(0, count);
      }
      return [...buf.slice(head), ...buf.slice(0, head)];
    },

    /** Current number of stored values. */
    get length(): number {
      return count;
    },
  };
}

/** Type alias for the return type of createRingBuffer */
export type RingBuffer = ReturnType<typeof createRingBuffer>;
