# Printing order slips to a kitchen with no screen

Status: **parked on `printer-integrtion`, not merged.** Everything here is
written and tested against a simulated printer. It has never met real hardware.

## Why it looks the way it does

A browser cannot open a raw TCP socket, and it cannot speak Bluetooth Classic —
which is what nearly every cheap thermal printer uses. So the page can never
talk to the printer directly. Web Bluetooth reaches BLE only, needs a human tap
per session, and would be hopeless for unattended printing at a pass.

Star's **CloudPRNT** and Epson's **Server Direct Print** invert it: the printer
sits on the restaurant's wifi and *polls us* over HTTPS every few seconds. That
removes the whole problem — nothing runs on site, no bridge box, no local
network access, nothing for staff to keep alive.

This implements CloudPRNT. Epson's protocol differs in shape but not in idea, so
a second adapter would reuse the queue and the renderer untouched.

## The exchange

One endpoint, three methods, at `/api/print/cloudprnt/<token>`:

| method | printer asks | we answer |
| --- | --- | --- |
| `POST` | "anything for me?" (with its status and MAC) | `{ jobReady, mediaTypes }` |
| `GET` | "give me the job" (`?type=text/plain`) | the slip, as text |
| `DELETE` | "printed it" (`?code=...`) | `200`, job closed |

The printer decides the cadence. We never push, never hold a connection, and
never need to know the restaurant's IP.

## The token is the whole security model

A printer cannot log in. It carries one long-lived secret in its configured
URL, so that secret **is** the authentication, and it is typed once by a human
into a device on a counter.

- 32 bytes from `randomBytes`, base64url — not a uuid, which is only 122 bits
  and is often assumed guessable.
- Scoped to one printer, and therefore to one restaurant. It can reach nothing
  else: no orders it did not get queued, no other tenant, no writes beyond
  closing its own jobs.
- Rate limited per token, like every other public route here.
- Shown **once**, when the printer is added. Losing it means issuing a new one,
  which is the correct trade for a credential that lives in a device someone
  can walk up to.
- Revoking is deleting the printer row.

If the token leaks, the holder can read the slips of orders already queued for
that one printer and mark them printed. That is the blast radius, and it is why
the token buys nothing else.

## Failure modes, and what each does

The kitchen is a bad network and a worse place for a computer. Every one of
these has a defined answer:

| what happens | what we do |
| --- | --- |
| wifi drops mid-service | jobs stay `queued`; the printer collects them when it comes back |
| printer claims a job and dies before printing | `claimed` older than `CLAIM_TTL` returns to `queued` |
| printer prints but the `DELETE` is lost | it re-collects and reprints — a duplicate slip, chosen deliberately over a lost one |
| out of paper / cover open | CloudPRNT reports it in the poll; we record `last_error` and keep the job queued |
| printer never installed, or removed | jobs simply accumulate and are pruned; nothing else notices |
| the same order queued twice | unique on `(order_id, printer_id)` — the database refuses |

**A duplicate slip is cheap; a missing one costs a table their food.** Every
choice above resolves that way.

## What is not here

- No Epson adapter yet (the queue and renderer are protocol-agnostic; only the
  endpoint would be new).
- No per-station routing — drinks to the bar, food to the pass. The schema has
  room (`printers.name`), the renderer does not use it yet.
- No reprint button in the dashboard.
- **No test against real hardware.** `pnpm print:sim` behaves like a CloudPRNT
  device and the whole flow passes against it, which proves our side of the
  contract and nothing about Star's firmware.

## Cost

A Star mC-Print3 or TSP143IV is roughly **USD 200–350**. That is the real price
of this feature; the code is the cheap half.

## Why the schema lives in its own file

`supabase/printing.sql`, applied with `pnpm db:printing`, rather than appended
to `schema.sql`. This branch is meant to sit unmerged and take `main` weekly —
touching the file that changes most would make that a fight every time.
