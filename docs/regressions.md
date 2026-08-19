# Shipping a big change without breaking something

Every bug we have shipped in this codebase has been the same shape: **two
places that had to agree, and nothing checking that they did.** None of them
were type errors. The code compiled perfectly while the staff screen said a
table owed MX$105 and the diner's screen said it owed nothing.

So this is not a style guide. It is the list of things that have actually bitten
us, and what now catches each one.

## What runs on its own

`src/lib/__tests__/invariants.spec.ts` enforces the rules that span files:

| Rule | The bug it came from |
|---|---|
| A table created after the blanket `revoke … from anon` locks itself down | `rate_limits` shipped world-readable |
| No dialog is rendered inside another dialog | Shipped three times — two focus traps, two Escapes to leave |
| Anything marking an order paid or written off closes the sitting | A sitting that never closes holds the table and the diner forever |
| Every API route has a guard or a rate limit | `order-status` was public and unlimited from the day it was written |

`src/lib/__tests__/schema-drop.spec.ts` keeps `drop.sql` in step with
`schema.sql` — every table, every function, every storage policy. Eight tables
had drifted, which is why `db:reset` failed on production.

`src/lib/__tests__/i18n-parity.spec.ts` keeps both catalogues complete.

`pnpm prod:check` compares dev and production schemas, loads a real customer
menu, and confirms every documented login resolves to a restaurant **in both
environments**. Run it after every merge.

## What still needs a person

These have all cost us a round trip. None are automatable yet.

**Look at it. In a browser. Actually rendered.**
Measuring is not looking. The menus dropdown reported a sensible rectangle from
`getBoundingClientRect` and was never once painted — an `overflow-x` ancestor
was clipping it. It shipped, and the only reason we found out is that somebody
hovered it. When a screenshot cannot be captured, `document.elementFromPoint`
at the element's own centre tells you whether it is really on screen.

**When a rule applies to money, apply it to every path or none.**
The bill window went onto the diner's read and the staff read, but the staff
screens kept their own unwindowed query — three contradictions from one change.
Before shipping a rule about what a bill contains, list every route that reads
or writes orders and say out loud which side of the rule each one is on.

**Both databases, every time.**
Dev is not a scratch pad. Resetting dev and re-seeding only production left
`demo@tabletap.dev` with no restaurant, and the next person to sign in lost a
morning to a bug that was not in the code. `pnpm prod:check` now covers both.

**Ask what the key is keyed by.**
The tracker offered a diner the order they had placed at a different table,
because the memory was keyed per restaurant when the thing it described was per
table. When storing state about "the current X", write down what makes one X
different from the next.

**A schema only counts if it builds from empty.**
`schema.sql` could not, for months: storage policies called `has_role()` a
hundred lines before it was created, and it only ever worked because a reset
left the old function behind. `pnpm db:reset` on dev is the only thing that
proves it.

## Before merging anything large

1. `npx tsc --noEmit && pnpm lint && pnpm test`
2. `pnpm db:reset` on dev — proves the schema still builds from nothing
3. Open the thing you changed in a browser, at 1280px and at 390px, in Spanish
4. If it is money, name every route that touches it and check each one
5. If it changes what we collect, charge, or promise — update the legal text and
   regenerate the PDFs (`node scripts/legal-pdf.mjs`)
6. `pnpm prod:check` after the merge

## When you find the next one

Add a test to `invariants.spec.ts` and a row to the table above. The list is
only useful because everything on it is something that really happened.
