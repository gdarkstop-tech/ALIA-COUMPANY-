# ADR 0005 — Family access requires an explicit legal basis

- Status: accepted (2026-10-14)

## Context
One account may manage several people's health, but being a relative must not grant unrestricted
access to another adult's records.

## Decision
Each `patient_access` grant records relationship, access level and consent basis:
`SELF` (owner), `GUARDIAN_OF_MINOR` (computed from date of birth < 18),
`ADULT_CONSENT_ATTESTED` or `LEGAL_AUTHORITY_ATTESTED` (explicit attestation with the
statement version). Adults can later claim their profile (`linked_user_id`) and become owner;
caregivers lose administrative rights once an adult claims. Owners cannot be revoked; revocation is
audited. Grants are created only through a validated `SECURITY DEFINER` function.

## Consequences
Clinician sharing (care teams, M3) builds on the same grant table plus care relationships. The
claim-profile and consent-receipt flows are scheduled for Milestone 3.
