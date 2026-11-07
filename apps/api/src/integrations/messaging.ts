import type { Env } from '../config/env';

export type OutboundMessage = {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  body: string;
  /** Machine-readable purpose, e.g. `phone-otp`, `password-reset`. */
  purpose: string;
};

export type OutboxRecord = OutboundMessage & { id: number; createdAt: string };

/**
 * Development outbox: messages that WOULD have been delivered are kept in memory (bounded)
 * and printed to the console. It only exists when DEV_TOOLS_ENABLED=true, which the config
 * loader forbids in production. Nothing is ever sent to a real phone or inbox from here.
 */
export class DevOutbox {
  private records: OutboxRecord[] = [];
  private seq = 0;
  constructor(private readonly capacity = 200) {}
  push(msg: OutboundMessage): OutboxRecord {
    const record = { ...msg, id: ++this.seq, createdAt: new Date().toISOString() };
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
    return record;
  }
  list(filter?: { to?: string; purpose?: string }): OutboxRecord[] {
    return this.records
      .filter((r) => (!filter?.to || r.to === filter.to) && (!filter?.purpose || r.purpose === filter.purpose))
      .slice()
      .reverse();
  }
  clear() {
    this.records = [];
  }
}

export type Messaging = { outbox: DevOutbox | null };

/**
 * The developer outbox exists only when DEV_TOOLS_ENABLED (refused in production). Real delivery
 * lives in `src/notifications` (ADR 0020).
 */
export function createMessaging(env: Env): Messaging {
  return { outbox: env.DEV_TOOLS_ENABLED && env.NODE_ENV !== 'production' ? new DevOutbox() : null };
}
