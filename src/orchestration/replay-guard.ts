/** A bounded, process-local replay ledger. It never stores message bodies. */
export const PROTOCOL_SEQUENCE_WINDOW = 4096;
export const MAX_LEGACY_PROTOCOL_FRAMES = 4096;
export const MAX_PROTOCOL_CAPABILITY_SCOPES = 8;

interface SequenceWindow {
  highest: number;
  seen: Set<number>;
}

export class ProtocolReplayGuard {
  private readonly legacy = new Set<string>();
  private readonly sequences = new Map<string, SequenceWindow>();
  private _saturated = false;

  get saturated(): boolean { return this._saturated; }

  /** Claims accepted frames AND outgoing prompt examples before their echoes. */
  claim(key: string): boolean {
    if (this._saturated) return false;
    if (key.startsWith('seq:')) {
      const match = /^seq:([A-Za-z0-9_-]{32,64}):([1-9]\d*)$/.exec(key);
      if (!match) return false;
      const sequence = Number(match[2]);
      if (!Number.isSafeInteger(sequence)) return false;
      let window = this.sequences.get(match[1]);
      if (!window) {
        if (this.sequences.size >= MAX_PROTOCOL_CAPABILITY_SCOPES) {
          this._saturated = true;
          return false;
        }
        window = { highest: 0, seen: new Set() };
        this.sequences.set(match[1], window);
      }
      // Forgotten sequence numbers remain ineligible forever via this floor.
      // Keeping a window permits grid/scrollback callbacks to arrive out of order.
      if (sequence <= window.highest - PROTOCOL_SEQUENCE_WINDOW || window.seen.has(sequence)) return false;
      if (sequence > window.highest) {
        window.highest = sequence;
        for (const old of window.seen) {
          if (old <= sequence - PROTOCOL_SEQUENCE_WINDOW) window.seen.delete(old);
        }
      }
      window.seen.add(sequence);
      return true;
    }
    if (this.legacy.has(key)) return false;
    if (this.legacy.size >= MAX_LEGACY_PROTOCOL_FRAMES) {
      // Evicting a fingerprint would make an old command executable again.
      this._saturated = true;
      return false;
    }
    this.legacy.add(key);
    return true;
  }
}
