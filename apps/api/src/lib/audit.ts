import type { Tx } from '../db/client';
import { auditLog } from '../db/schema';

/** Appends an audit record inside the caller's transaction (RLS: actor must be the current user). */
export async function audit(
  tx: Tx,
  entry: { actorUserId: string; action: string; entityType: string; entityId?: string | null; patientId?: string | null; requestId?: string; metadata?: Record<string, unknown> },
) {
  await tx.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    patientId: entry.patientId ?? null,
    requestId: entry.requestId ?? null,
    metadata: entry.metadata ?? {},
  });
}
