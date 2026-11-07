/**
 * Sequence numbers (#211). Every network message from the phone needs a sequence number higher
 * than any before it, or every light drops it as a replay, silently. So numbers are reserved in
 * blocks and the block's end is saved *before* the first number of it is used: after a crash or a
 * kill the phone resumes past the block, never inside it.
 */
export const SEQ_BLOCK = 128;
export const SEQ_MAX = 0xffffff;

export interface SeqState { next: number; reserved: number }

export interface SeqStore {
  load(): SeqState | null;
  save(s: SeqState): void;
}

export class SeqAllocator {
  private state: SeqState;
  private readonly store: SeqStore;

  constructor(store: SeqStore) {
    this.store = store;
    const saved = store.load();
    // Resume at the end of the last reserved block: numbers after `next` may have been used.
    this.state = saved ? { next: saved.reserved, reserved: saved.reserved } : { next: 0, reserved: 0 };
  }

  /** `count` consecutive numbers (a segmented message uses one per segment); returns the first. */
  take(count = 1): number {
    const first = this.state.next;
    if (first + count - 1 > SEQ_MAX) throw new Error("mesh sequence numbers used up: the network needs an IV index update");
    if (first + count > this.state.reserved) {
      this.state.reserved = Math.min(SEQ_MAX + 1, first + count + SEQ_BLOCK);
      this.store.save({ ...this.state });
    }
    this.state.next = first + count;
    return first;
  }
}
