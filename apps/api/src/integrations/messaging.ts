import type { IntegrationStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import { IntegrationNotConfiguredError } from './errors';

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

export interface MessageSender {
  readonly status: IntegrationStatus;
  send(msg: OutboundMessage): Promise<void>;
}

class DevOutboxSender implements MessageSender {
  readonly status = 'DEV_ADAPTER' as const;
  constructor(
    private readonly outbox: DevOutbox,
    private readonly log: (line: string) => void,
  ) {}
  async send(msg: OutboundMessage) {
    this.outbox.push(msg);
    this.log(`[dev-outbox] ${msg.channel} → ${msg.to} (${msg.purpose}): ${msg.subject ? `${msg.subject} — ` : ''}${msg.body}`);
  }
}

class NotConfiguredSender implements MessageSender {
  readonly status = 'NOT_CONFIGURED' as const;
  constructor(private readonly name: string) {}
  async send(): Promise<void> {
    throw new IntegrationNotConfiguredError(this.name);
  }
}

export type Messaging = { email: MessageSender; sms: MessageSender; outbox: DevOutbox | null };

export function createMessaging(env: Env, log: (line: string) => void): Messaging {
  const outbox = env.DEV_TOOLS_ENABLED ? new DevOutbox() : null;
  // Real providers are intentionally not wired yet: with credentials present but no adapter
  // implemented we still report NOT_CONFIGURED rather than pretend delivery works.
  const email: MessageSender = outbox ? new DevOutboxSender(outbox, log) : new NotConfiguredSender('email');
  const sms: MessageSender = outbox ? new DevOutboxSender(outbox, log) : new NotConfiguredSender('sms');
  return { email, sms, outbox };
}
