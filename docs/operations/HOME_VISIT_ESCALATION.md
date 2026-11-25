# Home visits — failure and escalation procedure

Status: **draft procedure, to be approved by the company's medical director and operations lead
before home visits are switched on** (`care.home_visit_booking` stays off until then). Implemented
system behaviour is described in [ADR 0021](../adr/0021-appointments-and-home-visits.md).

## 1. What the platform is — and is not
- Dress My Wound | غير لي arranges **scheduled** home nursing and doctor visits with verified
  providers. It is **not an emergency service**. The app says so on every booking and visit screen:
  in an emergency, call **123** (ambulance, Egypt). *(Confirm the emergency numbers with the
  Ministry of Health and Population before launch — release checklist item.)*
- Nobody is dispatched automatically. Each request names one provider, who accepts or declines.
  Operations never assign a provider who has not accepted.

## 2. When a provider cannot complete a visit
The provider records **Visit could not be done** in the app with a category. The system sets the
booking to `VISIT_FAILED`, stops reminders and opens an operations incident:

| Category | Severity | First action (operations) | Target |
|---|---|---|---|
| Needs urgent medical care (`CLINICAL_ESCALATION`) | HIGH | Confirm the provider told the family to call 123 or go to the nearest emergency department; call the family to confirm they are being cared for; inform the medical director | within 15 minutes |
| Unsafe to continue (`UNSAFE_ENVIRONMENT`) | HIGH | Call the provider to confirm they are safe; call the family; decide whether a visit can be rebooked; inform the operations lead | within 15 minutes |
| Patient not available (`PATIENT_NOT_AVAILABLE`) | MEDIUM | Call the family; offer to rebook | same day |
| Address not found (`ADDRESS_NOT_FOUND`) | MEDIUM | Call the family; correct the address; rebook | same day |
| Provider unable (`PROVIDER_UNABLE`) | MEDIUM | Call the family; offer another verified provider who covers the area and has free slots (the family books; nobody is assigned automatically) | within 1 hour |
| Other | MEDIUM | Call the provider for details; then the family | same day |

The incident shows the category and the booking reference only. Free-text notes stay on the
booking and are visible to the patient side and the provider, not to operations screens.

## 3. When the patient side reports a problem
After the start time, the person who booked can report: provider did not arrive (`PROVIDER_NO_SHOW`,
HIGH), provider very late, behaviour or safety concern (HIGH), price different from the app, other.
Operations call the family first, then the provider. A conduct or safety report is also passed to
Trust & Safety, who may restrict the provider's bookings (Admin → Users → Restrict bookings), which
hides the provider from discovery immediately.

## 4. Recording the outcome
Operations acknowledge the incident when they start working on it and resolve it with a written
resolution (required). Acknowledge / resolve actions are audited. A pattern of incidents for one
provider is reviewed by the medical director.

## 5. Payments
Bookings are paid to the provider at the visit (`PAY_AT_VISIT`); the app collects nothing, so there is
nothing to refund through the app. Price disputes are recorded as incidents and handled with the
provider.

## 6. Open items before launch
- Medical director approval of this procedure and of the service catalogue scope.
- Licensing evidence for the operating entity (required to switch on `care.home_visit_booking`).
- Operations on-call rota and phone line; incident response targets confirmed.
- Provider contracts covering safety, no-show and escalation duties.
