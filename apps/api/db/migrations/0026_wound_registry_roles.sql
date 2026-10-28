-- 0026 — Roles for the Wound Intelligence Registry (migration 0027, ADR 0015), in their own
-- migration because a new enum value cannot be used in the transaction that adds it.
--   * WOUND_RESEARCHER: works with consented, de-identified research datasets (never the vault).
--   * PRESENTATION_APPROVER: prepares and approves presentation cases (two different approvers per
--     case, after the patient approved the exact photos and text).
-- Both are staff roles: two-step verification is required and neither can be self-granted.
ALTER TYPE app.role ADD VALUE IF NOT EXISTS 'WOUND_RESEARCHER';
ALTER TYPE app.role ADD VALUE IF NOT EXISTS 'PRESENTATION_APPROVER';
