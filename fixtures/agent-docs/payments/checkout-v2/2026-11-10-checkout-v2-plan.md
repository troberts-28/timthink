---
title: Checkout v2 plan
status: review
date: 2026-11-10
branch: feat/checkout-v2
pr: 4301
---

# Checkout v2 plan

Collapse the three checkout steps into one page and offer saved cards. The handler lives in `src/server/app.ts`.

```question id=saved-card-default
Should the most recent saved card be preselected?
- Preselect it (recommended)
  One less tap for returning customers.
- Leave it empty
  Safer when households share an account.
---
### Context
Returning customers pay with the same card 92% of the time.

### Options
**Preselect.** Pros: faster. Cons: wrong card for shared accounts. Effort: small. Risk: low.

**Empty.** Pros: deliberate choice. Cons: an extra tap. Effort: small. Risk: low.

### Recommendation
Preselect it, and revisit if shared-account complaints appear.
```

## Phase 1: One page

- [x] Merge the address and delivery steps
- [ ] Inline the card form
