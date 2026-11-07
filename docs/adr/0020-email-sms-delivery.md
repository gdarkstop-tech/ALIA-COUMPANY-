# ADR 0020 — E-mail and SMS delivery: outbox, providers, receipts

- Status: accepted (2026-11-07). Implemented and tested against **local mocks only**. No company
  mail account, SMS account or sender identity exists in any environment yet, so production delivery
  is `NOT_CONFIGURED` and nothing is sent to real people.
- Replaces: the in-memory message stub of `apps/api/src/integrations/messaging.ts` (it now only
  holds the development outbox).
- Code: migration `0030_notifications.sql`; `apps/api/src/notifications/` (`phone.ts`,
  `templates.ts`, `providers.ts`, `service.ts`, `routes.ts`); `apps/api/src/auth/auth.ts`;
  `apps/api/src/config/env.ts`.
- Tests: `apps/api/test/notifications.test.ts` (37), `apps/api/test/auth.test.ts`.

## Context
Sign-in codes, e-mail verification and password reset were written to an in-memory outbox. Phase 8
needs real delivery for those plus booking, order and payment messages, with delivery status,
retries, abuse limits and failover — without sending anything until the company configures its
own accounts and sender identities.

## Decision
1. **Two kinds of message.**
   - *Secret* (`auth.*`: phone codes, verification and reset links) are sent immediately, once,
     through the configured providers with failover, or refused. Only metadata is recorded: the
     database constraint `secret_never_stored` rejects a secret row with a subject or body, and the
     development adapter logs only a masked recipient. Codes and links never reach logs.
   - *Everything else* is inserted into `app.notifications` **inside the transaction of the business
     change** (`Notifier.queue(tx, …)`), so a message exists only if the booking / order / payment
     change commits. A `dedupe_key` makes each business event send once.
2. **Worker.** Every 15 s `processDue` claims due rows with `app.notifications_claim` (system
   context only, `FOR UPDATE SKIP LOCKED`, releases rows stuck in `SENDING` after 10 minutes, expires
   rows past `expires_at`). Retries back off 1 min, 5 min, 15 min, 1 h, 6 h; after `max_attempts`
   (5) the row is `FAILED`. A permanent error (invalid number, unknown mailbox) is `UNDELIVERABLE`
   immediately. With no provider configured the row stays `QUEUED` without spending an attempt
   (`NOT_CONFIGURED`), until it expires.
3. **States**: `QUEUED → SENDING → SENT → DELIVERED`, or `FAILED`, `UNDELIVERABLE`, `EXPIRED`,
   `CANCELLED` (`cancelRelated` when the appointment or order no longer happens).
4. **Providers** are configured only when credentials **and** a sender identity are present:
   - E-mail: SMTP (any transactional service — SES, Mailgun, SendGrid, Postmark, a corporate relay),
     optional fallback SMTP. TLS is required in production.
   - SMS: Twilio (Messages API, form POST, Basic auth, `StatusCallback`) and Vonage (SMS API
     `/sms/json`, Basic auth, `type=unicode` for Arabic, `callback`), in the order given by
     `SMS_PROVIDERS` — failover happens only between providers the company configured explicitly.
   - Errors are classified `TRANSIENT` (network, 5xx, throttling → retry / fail over) or
     `PERMANENT`.
   - Development: the in-memory outbox is used only when `DEV_TOOLS_ENABLED` and not production, and
     never alongside a real provider. `integrationStatus` reports `CONFIGURED`, `DEV_ADAPTER` or
     `NOT_CONFIGURED` per channel.
5. **Phone numbers** are E.164 (`libphonenumber-js`). Any valid number parses, but SMS goes only to
   mobiles in `SMS_ALLOWED_COUNTRIES` (default `EG`) — the defence against SMS-pumping fraud. Sign-in
   requires the number already in E.164.
6. **Abuse limits.** Secret messages: 5 per recipient per hour, 10 per day (checked in the
   database, so all API instances share it), on top of the HTTP rate limits of ADR 0016 and Better
   Auth's 5 attempts per code.
7. **Delivery receipts.**
   - Twilio: `POST /v1/webhooks/twilio/status`, `X-Twilio-Signature` verified (HMAC-SHA1 of the
     public URL + sorted parameters, timing-safe, with and without the default port; checked
     against Twilio's own published test vectors). Unsigned or altered requests get 403.
   - Vonage receipts are unsigned, so the URL carries a secret token
     (`/v1/webhooks/vonage/dlr/<VONAGE_WEBHOOK_TOKEN>`, required in production) and the `api-key`
     field must match when present. GET and POST are accepted (it is an account setting).
   - Without the provider's secret configured the endpoints answer 404.
   - Receipts never move a message backwards: `DELIVERED` is final; a late "sent" does not
     overwrite a failure.
8. **Content rules.** Templates exist in Arabic and English (HTML is derived from the text, escaped,
   `dir="rtl"` for Arabic). Messages carry who / when / reference only — never a diagnosis, symptom,
   result or product-for-condition. Sign-in messages are bilingual because the reader's language is
   not known yet.
9. **Operations.** `GET /v1/admin/ops/notifications` (`ops.read`) shows status, attempts, provider,
   error and a masked recipient — never subject or body. `POST …/:id/retry` (`ops.manage`, audited)
   re-queues a `FAILED`, non-secret, unexpired message. RLS lets application users insert (business
   actions queue messages) but only the worker and operations staff read or update.

10. **Retention and account deletion.** Recipients are personal data. Sign-in metadata is deleted
    after 30 days, other messages after 180 days (`app.notifications_retention`, hourly from the
    worker). Deleting an account deletes the rows linked to it (trigger on `app.account_deletions`).
    `recipient_user_id` has no foreign key on purpose: Better Auth sends the sign-up e-mail inside
    its own transaction, before the user row is visible to the API's connection.

## Consequences / limits
- Phone sign-in codes are sent before an account exists, so their metadata is not linked to a user
  and is removed only by the 30-day retention, not by account deletion.
- A receipt that arrives before the worker records the provider message id is not matched (the
  message stays `SENT`). Acceptable: the status is still truthful, only less precise.
- No push notifications in this ADR (no FCM / APNs project exists yet).
- Nothing here has been sent through a real provider. Before launch the company must provide: a
  mail domain with SPF / DKIM / DMARC and an SMTP account; an SMS account with an approved Egyptian
  sender ID (NTRA registration is typically required for alphanumeric sender IDs in Egypt); then
  run one real send per channel and record it in `docs/release/`.
