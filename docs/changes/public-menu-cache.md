# H1 step 2: restaurant public menu cache

## Behaviour and regression checks

The restaurant's raw public menu and the diner's current visit must agree.
Previously every scan repeated the restaurant reads. `public-menu-cache.spec.ts`
first reproduced ten repeated ordering-loader reads on an empty-program fixture.
It now compares the old and cached public result with hidden menus, unavailable
dishes, an owner-only restaurant column, dietary tags, add-on links and loyalty.
A complete mocked table visit with an active program and one add-on link counts
**19 before → 14 cold → 3 warm**. Both versions include the empty final pagination
read; larger menus can require more slices/pages. The plan mock models React's
one-plan-read-per-request memoization. These are client calls, not measured SQL
statements or a new production stress-test result.

`public-menu-cache.ts` wraps Next 15.5.28 `unstable_cache`. Its two parts are
`shell` and `contents`, with key parts `public-menu-v1,<part>`, invocation arguments
`restaurantId, floor(Date.now()/30000)`, tag `public-menu:<restaurantId>`, and
`revalidate: 30`. The time bucket prevents Next's stale-while-revalidate behaviour
from serving a previous bucket's entry after 30 seconds. `revalidateTag(tag)` in
this installed version queues immediate expiry, with no cache-life profile.
The installed implementation was inspected in `next/dist/server/web/spec-extension/`
and `app-render/create-component-tree.js`; `public-menu-next-cache.spec.ts` exercises
the real installed cache API with `forceDynamic: true` and mocked storage.

Only Vercel production defaults on. `PUBLIC_MENU_CACHE=1` explicitly enables the
path in unit tests or a controlled server check; `PUBLIC_MENU_CACHE=0` disables it.
Preview, development and ordinary test runs default off, so direct database gate
fixtures retain their existing behaviour. There is no independent fetch cache:
the anonymous client uses `cache: "no-store"`, no session persistence, no browser
storage and no visitor cookies. Existing RLS filters categories, available dishes,
active promotions and their nested components. Restaurant columns are explicitly
projected. The secret-key exceptions are the same narrowed reads as before:
menu id/active/schedule (only used to derive open menus), card readiness (cached
as a boolean, without an account ID), and loyalty active/goal/reward/steps.

`public-menu-stock.spec.ts` checks last-portion invalidation and reservation returns.
`invariants/public-menu-cache.spec.ts` scans route writes and known menu-writing
RPCs, plus delegated promotion, subscription, admin-plan and Connect writers.
It names the file/line/table, rejects an imported-but-unused invalidator, and
pins dynamic pages and the unchanged skeleton props. Restaurant creation is
explicitly exempt: those routes generate new IDs, never edit an existing menu.
The invariant is a source check, not proof that SQL and RLS execute correctly.

## What stays live

`openMenuIds` / `closedNow`, time-zone schedule checks, promotion entitlement and
combo construction run per request from raw rows. Promotions currently have an
active switch and no start/end time columns. A future time window belongs in
that request-time derivation, never in the cached reader.

`getPlan` stays live (and React-memoized within a request). It expires local trials
and can write the expired trial under a revision check. Caching that conclusion
would defer expiry; Next also rejects `revalidateTag` during render. Trial expiry
changes only live plan fields, not cached restaurant settings. Tables,
`openSittingAt`, membership and every visit pass stay live. The staff-only
`includeSoldOut` loader remains live. The page files, Suspense boundaries,
MenuSkeleton and its heights are unchanged. Shell reads remain separate so a cold
menu's contents still load behind Suspense.

## Server writers and invalidation

| Route / entry | What clears the tag |
| --- | --- |
| `/api/products` PATCH, POST | After product/add-on transaction, ordinary edit, or stock recount |
| `/api/menu/duplicate` POST | After the deep-copy transaction |
| `/api/promotions` POST, PATCH, DELETE | `savePromotion` clears after the terms/components RPC; route clears pause/resume and deletion |
| `/api/dietary-tags` POST, PATCH, DELETE | After creation, edit or transactional unlink/delete |
| `/api/icon-groups` POST, PATCH, DELETE | After group writes and each child-list write/restore; failed partial replacements clear too |
| `/api/settings` PATCH | Immediately after the settings write, before optional bill repricing can fail |
| `/api/loyalty/program` POST | After upsert |
| `/api/admin/restaurants` PATCH, DELETE | `moveRestaurantPlan` clears after the revision-checked move; delete clears after the deletion outcome |
| `/api/webhooks/stripe`, `/api/billing/checkout`, `/api/billing/cancel`, `/api/cron/recover` | `applySubscription` clears after the winning revision update, including scheduled subscription recovery |
| `/api/connect/onboard`, `/api/connect/status`, `/api/webhooks/stripe/connect` | `ensureConnectAccount` / `syncConnectStatus` clear after saving the account/readiness |
| `/api/pos/order` | Zero-stock results clear even with bell alerts disabled; `raiseStockNotifications` also clears before its bell write |
| `/api/table-order` | Zero-stock intent result clears even with alerts disabled; legacy reservation uses `reserveStock` |
| `/api/pos/upload`, `/api/pos/recover` | Shared `pos-offline.ts` clears after a settled recovery |
| `/api/costs/waste` POST | Clears after a waste RPC that may exhaust a dish |
| `/api/legal/accept`, `/api/print/token`, `/api/terminal/deposits`, `/api/costs/settings` | Conservatively clear even though today's fields are private, keeping the restaurants-table invariant simple |
| `/api/signup`, `/api/admin/users` creation | New random restaurant ID; no prior tag to clear |

`reserveStock` clears a successful last-portion result independently of notification
preferences. `releaseStock` clears a returned reservation. SQL-only cancellation,
refund/abandonment, orphan recovery and historical/offline stock movements without
a restaurant-specific invalidation above fall back to the 30-second bound.
Checkout's live validation remains authoritative; a stale available dish can be
refused, never charged as if it were available.

## Browser writers deferred for Claude's decision

The brief explicitly permits listing browser writers instead of rerouting them.
These remain direct RLS-protected Supabase writes. They **do not clear a server
tag yet**; diner visibility can lag by up to 30 seconds. The immediate-edit
requirement is therefore incomplete for these paths. A separate invalidation-only
fetch after a browser write would still lose invalidation when the browser closes;
routing the write itself through a scoped manager endpoint is the stronger fix.

| Source | Direct writes still needing a server endpoint |
| --- | --- |
| `src/hooks/menu-editor/menus.ts` | Menu create/rename/delete/schedule/active, category create/rename/delete/station; move menu/category through shared writer |
| `src/hooks/menu-editor/products.ts` | Duplicate product insert and copied item_addons, product deletion, product reorder; product add/edit already use `/api/products` |
| `src/hooks/menu-editor/addons.ts` | Add/edit/delete extras and bulk delete |
| `src/hooks/menu-editor/availability.ts` | Available/sold-out toggle |
| `src/hooks/menu-editor/import.ts` | Category creation, bulk dish import and failed-import category cleanup |
| `src/hooks/menu-editor/writer.ts` | Generic insertReturningId and write runner used by the sources above |
| `src/lib/menu-data.ts` `reorderRows` | Two-row order swaps for menus/categories/menu_items, called by the browser writer |

Component search found no additional direct writes to the cached database tables.
Logo/Cover/DishPhoto components write storage objects; their saved database URLs
flow through settings/product routes, which clear the tag. A file's image bytes at
an unchanged URL are outside this data cache's responsibility.

## Protected overlap

`git diff origin/main...codex/abuse-fixes --name-only` was checked. Checkout,
`order-intent.ts`, table membership and tracker files were not edited. The counter
pay-later intent path in `/api/checkout` only calls the shared stock notification
helper when alerts are on; with alerts off its sell-out falls back to 30 seconds.
Claude can add invalidation at that protected result boundary when integrating.
The card reservation path already clears via `reserveStock`. The existing
`docs/SPEC.md` and `docs/regressions.md` also overlap that branch, so this file holds
the spec/regression addition for Claude to fold in without touching those files.
`vercel.json`, schema and grants are unchanged.

## Gate plan for Claude (gate-policy section 2)

Local: TypeScript, lint and the full unit suite. No development server, database
command or gate was run in this worktree. The sandbox cannot write the linked
node_modules Vite temp folder, so Vitest uses `--configLoader runner`; repository
configuration is unchanged.

One smoke per server session. `api` on the listed changed/delegated routes; `money`
and `attack` for reached checkout, till, table-order, offline recovery and billing
paths. `layout` + `dialogs` in both languages on `/r/<id>`, `/r/<id>/t/<id>`,
`/dashboard/main-menu`, `/dashboard/pos`, `/dashboard/table-order`, and `/dashboard/orders`; `promises` on the two
diner pages because cached settings/plan decide which controls are offered.
No RLS/grant/guard change, so no new whole `rls`/`roles` gate is requested.

Suggested scope regexes (adjust fixture IDs through the existing gate runner):

```sh
GATE_PAGES='["^/r/[^/]+(/t/[^/]+)?$","^/dashboard/(main-menu|pos|table-order|orders)$"]'
GATE_API='["^/api/(products|menu/duplicate|promotions|dietary-tags|icon-groups|settings|loyalty/program|admin/restaurants|legal/accept|print/token|terminal/deposits|costs/(settings|waste)|pos/(order|upload|recover)|table-order|checkout|billing/(checkout|cancel)|connect/(onboard|status)|webhooks/stripe(/connect)?|cron/recover)$"]'
```

Normal gates must keep caching off because their fixtures write directly. A
separate controlled production-mode check with `PUBLIC_MENU_CACHE=1` should warm
a menu, edit through each server writer, verify the next request, and check a
schedule opening, isolated restaurant tags, failed reads, and unchanged shell
height. Repeat production stress measurement only after integration; the mocked
call reduction is not evidence of a new requests-per-second ceiling.
