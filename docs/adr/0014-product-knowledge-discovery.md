# ADR 0014 — Company-product knowledge and controlled product discovery

- Status: accepted (2026-10-28)
- Extends: [ADR 0006](0006-tetrasol-only-store-and-demo-isolation.md), [ADR 0008](0008-ai-gateway.md), medical knowledge (migration 0016)

## Context
The app sells company products (TetraSol today; other company-owned lines later, never
competitors). People ask the assistant about wounds that a product may be approved for, and the
business wants the assistant to be able to show approved product information. The project's rules:
each keyword-to-product association needs evidence of an approved relevant indication, the
assistant must not recommend TetraSol for every wound, marketing never overrides patient safety,
sensitive health information is never used for advertising targeting, and product claims follow an
approval workflow with versions and approvers. A language model told "you may mention our gel" will
recommend it for everything, call it the best, and promise healing.

## Decision
1. **Product knowledge entries** (`app.product_knowledge`): official indications, approved claims,
   contraindications, FAQs and educational material, bilingual, each with an **evidence reference**
   (registration, approved label section, study). Catalogue staff (`catalog.tetrasol.manage`) write;
   a **clinical reviewer** (`ai.clinical.review`) who did not write the revision approves it into an
   immutable, versioned entry; editing starts a new draft while the approved version stays live;
   anyone who manages or reviews may retire it at once. Admins and commerce managers cannot approve.
   Demo products cannot carry approved knowledge. Updates take effect without an app update.
2. **Keywords** (`app.product_keywords`): Arabic / English terms, synonyms and common misspellings.
   A keyword either names the product or points at one of its INDICATIONS (same product, enforced).
   Every keyword needs its own clinical approval by someone other than its proposer, and an
   indication keyword works only while that indication has a live approved version. Terms are never
   edited in place. Matching is whole-word on text normalised exactly like medical-knowledge search
   (Arabic letter forms, diacritics, the attached article); misspellings are curated, not guessed.
3. **Discovery** (`app.product_discovery`, flag `ai.product_discovery` OFF and regulated; internal
   test accounts only): at most two products, only approved, published, non-demo products of an
   active company brand, matched on the **person's current message only** — never their profile,
   records or earlier messages. When the message shows signs that need a clinician (pus, fever,
   spreading redness, smell, black tissue, numbness, chemical / electrical / facial burns; EN + AR)
   no product information is offered at all.
4. **What the model receives**: a fixed rule block (general care and when to seek care first; mention
   an item only if asked or clearly within an approved use; only the approved text; always its
   warnings; never cure / guarantee / best / only / comparisons / prices; never tell the person to
   use or buy it; cite `[P1]`) and the approved statements as labelled data. The rules are part of the
   chat policy version.
5. **Deterministic answer guard** (`checkProductAnswer`): the API rejects an answer that names any
   company product or brand that was not offered, or that — in a sentence about an offered product —
   makes a claim (cure, guarantee, best, only, miracle, no side effects, instant, proven, discount, …
   EN/AR) not present in that product's approved text. Rejected answers are never shown, their
   tokens are recorded as company cost (`INVALID_OUTPUT`), the allowance is given back, and after 5 in
   a day the assistant pauses for that person until the next day.
6. **The card is decided by the server**: a product card (name, approved indication, warnings, "not
   a recommendation for your situation", link to the product page) appears only when the answer
   cited the item. Cards of products later withdrawn disappear from earlier answers. The product page
   shows the live approved statements with their version and approval date.
7. **No advertising use of health data**: discovery runs on the message text in the request; no
   per-person product-interest record is kept beyond the card stored with that person's own
   conversation (deleted with it).

## Consequences
- The value depends on the clinical team approving real indications and keywords; none exist yet,
  and the brand ownership record is still "TO CONFIRM".
- The guard is conservative: an answer that says "the best thing is to keep it clean" next to a product
  sentence is fine, but "the best option is [P1]" is rejected, at the company's cost.
- Product answers are **not evaluated** with any real model; the evaluation suite does not yet
  include product-information cases.
- Arabic attached prepositions (بـ، لـ) are not stripped by normalisation: common forms must be added
  as curated synonyms.
