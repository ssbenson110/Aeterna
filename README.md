# AETERNA

A two-sided UK wedding marketplace. Couples plan their whole wedding with one private AI planner, then each enquiry goes to exactly one verified vendor. Vendors pay one flat monthly fee. Beachhead: modern multicultural weddings in South London and Kent.

This repository contains the full stack: the HTTP API, the database, the routing engine, the AI planner and the front end.

## Running it

No install step. There are no external dependencies, only Node built-ins.

```bash
node server/index.js
# http://localhost:4173
```

Requires Node 22 or newer, because the server uses the built-in `node:sqlite` driver.

Handy variants:

```bash
AETERNA_DEMO=1 node server/index.js     # also seeds a demo couple, a staff account and listing claim
AETERNA_LOG=1 node server/index.js      # request logging
PORT=8080 node server/index.js          # different port
./scripts/dev.sh                        # start in the background, write data/server.pid
```

On first run the database is created at `data/aeterna.db` and seeded with thirty **sample vendor listings** across all 22 categories. Every one of them is flagged `is_sample` and the interface labels them as samples. There are no reviews, ratings, testimonials or usage statistics anywhere in the seed data, because none of that exists yet.

### The AI planner, and how it reports its own status

The planner runs in one of two modes and always reports which one to the client.

| Mode | When | Behaviour |
| --- | --- | --- |
| `live` | A probe request to the provider succeeded | A Claude model answers, given the couple's real wedding context |
| `offline` | No key, the key is rejected, or the provider is unreachable | A deterministic planning engine answers from the same context |

**The mode is established by an actual request, never by the presence of a key.** An earlier build reported "live" whenever `ANTHROPIC_API_KEY` was set, and it was wrong: the key in that environment returned `401` on every call, so every answer came from the offline engine while the server cheerfully claimed otherwise. The server now probes the provider at boot and every fifteen minutes, prints the real state in its startup banner, and the chat view repeats it to the couple. `GET /api/health` includes the same status.

The offline engine is not a placeholder chatbot. It does real arithmetic on the couple's budget, date and guest count and returns the same structured advice. If a live call fails mid-request, the response is marked `degraded` and the client says so rather than pretending.

```bash
ANTHROPIC_API_KEY=sk-... node server/index.js
```

## The verification console

`/admin`, staff accounts only. In demo mode the account is `admin@aeterna.co.uk` with the password `verify-the-checks`.

### The badge is derived, never toggled

This is the load-bearing design decision in the whole feature. `vendors.verified` is written in **exactly one function**, `recompute` in `server/lib/verification.js`, and its value is a pure function of:

- all six published checks passing
- a current insurance certificate that has not expired
- the annual re-check not being overdue

**There is no endpoint that awards a badge.** An administrator records the outcome of each check and the badge follows. A test asserts that no such shortcut exists, because the moment one does, the badge stops meaning what the published scope says it means.

Two of the six checks cannot be ticked by staff at all:

| Check | Why it is not a tick box |
| --- | --- |
| Insurance | Passed by recording a certificate with an insurer and an expiry date. A tick with no expiry could never be chased or lapsed. |
| Portfolio rights | Passed only when the vendor confirms in writing from their own account. Nobody else can honestly give that confirmation. |

The other four require written evidence before they can be passed. Passing one with an empty evidence field is refused.

### The badge comes off by itself

The published scope promises the badge is removed when a check lapses, so that cannot depend on someone remembering. `sweepBadges` re-derives every badge on a fifteen minute timer alongside the enquiry sweep. An expired certificate or an overdue re-check removes the badge automatically, records the reason, and tells the vendor plainly what happened.

Suspending a badge for something outside the six checks, say a complaint under investigation, works by failing a **named** check with a written reason rather than flipping a hidden flag. The reason is always in the audit trail and the badge cannot return until the check is put right.

### Renewals

Insurance expiries and annual re-checks appear in the renewals queue `INSURANCE_CHASE_DAYS` (45) before the date, sorted lapsed first. Chases are logged with who sent them and what they said. Email is not connected, so the console is explicit that you send the message yourself.

### The audit trail

Every state change is appended to `verification_audit` with an actor and a timestamp: checks passed and failed, certificates recorded, badges awarded and removed, rights confirmed, images uploaded and removed, notes edited. Append only. This is the record we would produce if a couple ever asked what the badge meant on the day they booked.

## Vendor image uploads

`POST /api/vendors/me/images` takes the **raw image bytes as the request body** with the alt text in the query string. Not multipart: there is no dependency to parse it with, and a raw body has no boundary handling to get wrong.

What is checked, in order:

1. **Rights confirmation first.** No written confirmation, no upload. It is the same confirmation the published verification scope describes, so a profile can never carry images whose rights we have not asked about.
2. **Size**, streamed and aborted at the cap rather than buffered whole and then rejected.
3. **The actual file signature.** A declared content type is a claim, not evidence, so the magic bytes decide. A text file renamed `.png` is refused with a 415.
4. **Alt text is required.** An image with no alt text is unusable to anyone with a screen reader, and this is a public profile.

Large photographs are downscaled in the browser with a canvas before upload, so a 9MB phone photo does not bounce off the cap for no good reason and the server never has to decode an image.

**An uploaded image replaces the seeded stock photography rather than sitting alongside it.** If a vendor removes all their images the gallery empties, and we show nothing rather than quietly reinstating stock imagery as though it were their work.

## Testing

```bash
node scripts/smoke-views.mjs
```

Sixty two checks. There is no browser and no test framework available, so the script installs a small DOM shim, imports the real view modules unmodified and renders every view against the running server. It asserts the things that would actually hurt if they broke: that an enquiry reaches exactly one vendor, that the free tier caps actually block, that a custom tradition survives the round trip into vendor matching, that an unbooked vendor cannot reach a wedding at all, that a booked vendor cannot see the budget or the guest list, that cancelling a booking revokes access immediately, that the verified badge links to the published scope, and that no page claims unlimited AI or invents a pricing tier.

It also asserts the verification rules directly: that a badge is not awarded while any check is outstanding, that insurance cannot be passed by ticking a box, that staff cannot pass the rights check on a vendor's behalf, that an expired certificate removes the badge on its own, that a non-image is refused even when it claims to be a PNG, and that no award-badge shortcut exists in the API surface.

The suite has already earned its keep three times over. It caught a vendor being locked out of a wedding they were genuinely booked for when they claimed their listing after the booking, a couple missing from their own wedding's member list, and a refused oversized upload poisoning connection reuse so that the *next* unrelated request failed for no visible reason.

## The demo build

```bash
node scripts/build-static.js
# dist/aeterna-demo.html
```

One self-contained HTML file. The application source is unchanged; the build inlines the stylesheet, flattens the ES modules and prepends `public/js/demo-backend.js`, which intercepts `fetch` and serves the API from an in-browser port of the server logic. Routing, pricing, fair use limits and the published policies all behave as they do live, so the demo cannot drift into claiming something the real backend does not do. Open it from disk and everything works, including accounts, enquiries and the planner.

## Layout

```
server/
  index.js              HTTP server, route table, static file serving
  db.js                 schema and query helpers, node:sqlite
  lib/
    config.js           pricing, categories, published policies. The commercial source of truth
    routing.js          the exclusive enquiry router
    planner-ai.js       live and offline planner
    auth.js             scrypt hashing, signed sessions
    seed.js             sample listings and starter plans
    templates.js        checklist, budget and timeline templates
    images.js           photography manifest
    entitlements.js     free tier caps, enforced here and nowhere else
    workspace.js        shared page, roles and the booking gate
    seed-vendors.js     sample listings across all 22 categories
    verification.js     the six checks, insurance, renewals. The ONLY writer of vendors.verified
    uploads.js          image validation by magic bytes, storage and gallery sync
    http.js             validation, rate limiting, cookies
  routes/               auth, catalog, enquiries, planner, workspace,
                        admin (console), vendor-media (uploads)
public/
  index.html            application shell
  css/aeterna.css       design system
  js/                   router, store, api client, shared components, views
  js/demo-backend.js    used only by the standalone build
scripts/
  build-static.js       single file demo build
  smoke-views.mjs       headless front end tests
  dev.sh                background start
```

## How enquiry routing works

`server/lib/routing.js` is the only place a vendor is chosen, so the core promise is enforceable in one file.

Hard filters come first: category, accepting enquiries, monthly capacity not yet reached, and not a vendor who has already seen this enquiry. Survivors are scored on region fit, verified status, logged experience with the couple's traditions, and whether their starting price sits inside the couple's allowance for that category. Fairness is the tie-breaker: the longer a vendor has gone without an enquiry, the higher they rise.

**There is no paid weighting and no field a vendor can buy.** Directory ordering is verified status then alphabetical, for the same reason.

An enquiry belongs to one vendor for 48 hours. If they decline, or the window lapses, it moves to one other vendor. It is never held by two vendors at once, and the couple's contact details are released only when a vendor accepts.

## Commercial terms

These live in `server/lib/config.js` and nowhere else. Caps are enforced in `server/lib/entitlements.js`.

- **Vendors.** One plan, and the first month is free for every vendor during rollout, applied automatically at subscription. Then £29 a month founding rate for the first 40 vendors, locked for 12 months, then £49 a month standard. No higher tier. No paid ranking, ever.
- **Couples.** A permanent free tier with published caps, then one upgrade of £49 per wedding, paid once. Not a subscription.

### The couple free tier

| | Free | Upgraded, £49 once |
| --- | --- | --- |
| Checklist and budget | Yes | Yes |
| AI planner | 20 messages in total | 400 messages a month |
| Enquiries | 1 | Unlimited, still one vendor at a time |
| Guest list, seating, day timeline | No | Yes |
| Shared workspace | No | Yes, up to 25 people |
| Plan export | No | Yes |

Two rules govern how caps behave, and both are load-bearing:

1. **A cap blocks the next new thing, never access to existing work.** Nothing a couple has built is ever hidden, locked or deleted when they reach a limit. The free tier is not a trial that expires.
2. **If a limit is not published on the pricing page, it is not enforced.** Every number in `FREE_LIMITS` appears verbatim in the interface.

Card processing is not connected. The billing endpoints record the intent and return `paymentProcessed: false` with a note saying so.

## Taxonomy, regions and the seating designer

**The taxonomy is exhaustive so no vendor is ever turned away.** Forty one categories across eight families, ending in an explicit catch-all, `other-services`, so a vendor whose trade we have not thought of still has a place. Browse does not fake depth though: categories with listings render as photographic tiles, the rest appear as plain chips marked "none yet". Nothing hidden, nothing overstated.

**The map is the whole UK.** Sixty seven areas in nine groups covering England, Wales, Scotland and Northern Ireland. The original beachhead areas keep their exact names so existing data needs no migration. Routing scores same area, then same group, then neighbouring group, using a bordering-groups map in `config.js`.

**Traditions are a search, not a closed list.** The browse filter is a free text box with the presets as suggestions. Matching is loose in both directions: "yoruba" finds a vendor who logged "Yoruba traditional", and "nikah ceremony at the mosque" still finds a vendor who logged "Nikah".

**The seating designer is real now.** Round, square, banquet, oval and top tables, each with a seat range the shape can actually hold. Tables are dragged around a gridded room canvas (pointer events, with arrow keys for keyboard users), positions are stored as percentages of the room so the same plan draws at any screen size, and guests are seated from the same panel. Two honesty rules are enforced server side: a shape cannot hold more seats than its published range, and a table cannot shrink beneath the guests already seated at it.

## The vendor CRM, approvals, and the sharing matrix

**The CRM** lives on the vendor dashboard: a five stage pipeline (new, in conversation, quoted, booked, closed), quotes, invoices, private per enquiry notes, and an availability calendar. A blocked out date is a hard filter in the router, so it never receives an enquiry it would have to decline. Bookings export as an ICS calendar file, generated client side, so it works identically in the demo build.

**Quotes are the approval mechanism.** A vendor can only quote a wedding whose enquiry they hold or that has already booked them, which keeps quoting from becoming spam. The couple approves or declines on the shared page, in front of everyone it affects, and an approval is what creates the booking at the quoted amount. Nothing is agreed anywhere else, so "who agreed what, and when" is always answerable. Invoices track what is owed and what has arrived; they do not take payment.

**The sharing matrix** puts the couple in charge of what each booked vendor sees: total budget, guest numbers, dietary counts and the full guest list, as defaults plus per vendor overrides, enforced server side when the vendor view is assembled. Sharing the total budget or the full guest list asks for confirmation with an honest warning first. One thing is not a setting: other vendors' prices are never shared.

**Guest messaging and RSVP.** Email delivery is not connected, and the product says so rather than pretending. Composing a message produces a WhatsApp link and a mail link per guest, each carrying that guest's personal RSVP page. Guests reply from the link with no account, and the reply lands straight in the guest list, dietary needs included.

**The supply cap.** Vendor onboarding checks the category and region group against enquiry demand: the floor is 3 vendors per patch, growing at 1.5 times the enquiries seen in the last 30 days. A full patch waitlists the vendor with their queue position and an honest explanation, because a vendor paying monthly for a dead patch is a cancellation and a bad story waiting to happen. Capacity grows with real enquiry volume, never with sales targets.

## The shared workspace

Couple, planner, booked vendors and helpers on one page. `server/lib/workspace.js` is the only place access is granted.

**The rule that file exists to enforce: a vendor reaches a wedding only after the couple books them.** Not on receiving an enquiry, not on accepting one. Booking is the gate, so opening up collaboration cannot become the bidding swarm the product exists to avoid. Cancelling a booking removes access immediately.

| Role | Sees |
| --- | --- |
| Couple | Everything. Controls who is invited and can revoke at any time |
| Planner | The full plan by invitation, but not payment records |
| Booked vendor | The date, venue, guest count, their own budget line, the day timeline, their own tasks and their own comment thread |
| Helper | The checklist and the timeline |

A booked vendor never sees the total budget, another vendor's price, or the full guest list. That is a commercial boundary as much as a privacy one: a supplier who can see the total budget prices against the budget rather than against the work. The vendor payload is **assembled from scratch** rather than filtered down from the couple's view, so a field added later cannot leak by being forgotten in a blocklist. Six tests cover the boundary directly.

## Claims discipline

These constraints are load-bearing, not stylistic. Several are enforced in code and covered by tests.

- **AETERNA Verified** is a published checklist: identity, insurance, references, portfolio rights, a live video call, annual re-checks. The badge is always a link to `#/verification`. It is never described as personal vetting. A vendor cannot set `verified` on themselves, the field is absent from the profile update whitelist, and **not even an administrator can award it directly**, because the badge is derived rather than toggled. See the verification console section above.
- **Every seeded badge has records behind it.** The sample vendors are not simply flagged verified: the seed writes real check rows and a real certificate, then lets the rules derive the badge. A badge with nothing behind it would be exactly the unsupported claim the scope forbids.
- **Fair use, not unlimited.** The AI planner has published monthly allowances and the server enforces them. The word "unlimited" appears only where the copy denies the claim, and the test asserts that.
- **No testimonials, reviews, ratings or invented statistics.** Anywhere. The product has no customers yet and fabricating social proof is a banned practice under UK CMA rules. Sample listings are labelled as samples.
- **Voice.** Natural, professional, friendly, human. Contractions yes. No em dashes and no exclamation marks. Live model output is passed through a scrubber that enforces this regardless of what came back.

## Design

Bright and joyful, never dark. Warm ivory ground `#FFFBF4`, coral primary, with gold, blush and sage.

Coral at brand strength is 3.14:1 on ivory, which passes for large text and UI components but fails AA for body copy, so the palette carries three corals: `--coral` for display and decoration, `--coral-cta` for buttons where white text clears 4.35:1, and `--coral-ink` at 5.08:1 for links and small text. Every text token in `aeterna.css` has its measured ratio recorded beside it.

Fraunces for display, Plus Jakarta Sans for interface and body. Confetti in the hero, suppressed under `prefers-reduced-motion`.

All photography is real. The set is balanced across Black British, South Asian, East Asian, mixed race and white couples, and each entry in `images.js` carries an internal `rep` audit note that is never rendered. Alt text describes the scene and never labels anyone's ethnicity.

## Out of scope

Deliberately not built and not advertised: native apps, a real seating canvas, escrow or booking payments, sponsored ranking, bidding, a registry or website builder, voice features, and native reviews. The seating tab is labelled a demo in the interface, because it records who sits where and nothing more.

## API

All responses are JSON. Session is a signed HttpOnly cookie.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | |
| GET | `/api/meta` | categories, regions, traditions, pricing, imagery |
| GET | `/api/pricing` | includes remaining founding places |
| GET | `/api/policies/verification` | published verification scope |
| GET | `/api/policies/fair-use` | published fair use policy |
| POST | `/api/auth/register` `/login` `/logout` | |
| GET | `/api/auth/me` | |
| GET | `/api/vendors` | `category` `region` `tradition` `q` `maxPricePence` |
| GET | `/api/vendors/:slug` | |
| POST | `/api/vendors` | vendor onboarding, always starts unverified |
| PATCH | `/api/vendors/me` | `verified` is not accepted |
| POST | `/api/enquiries` | routes to exactly one vendor |
| GET | `/api/enquiries` | scoped to the caller's role |
| POST | `/api/enquiries/:id/respond` | `accept` or `decline`, decline re-routes to one other |
| GET | `/api/planner` | the whole plan |
| PATCH | `/api/planner/wedding` | |
| POST | `/api/planner/budget/rebalance` | |
| — | `/api/planner/{checklist,budget,guests,tables,timeline}` | POST, PATCH, DELETE |
| GET | `/api/workspaces` | every wedding the caller can reach, in any role |
| GET | `/api/workspace/:id` | scoped per role |
| POST | `/api/workspace/:id/invite` | planner or helper only, never a vendor |
| POST | `/api/workspace/join/:token` | accept an invitation |
| POST | `/api/bookings` | books a vendor and grants scoped access |
| DELETE | `/api/bookings/:vendorId` | cancels and revokes access immediately |
| — | `/api/workspace/:id/{tasks,comments}` | GET, POST, PATCH, DELETE |
| GET | `/api/ai/status` `/messages` | mode and remaining allowance |
| POST | `/api/ai/chat` | fair use enforced |
| GET | `/api/admin/queue` | verification queue with state counts |
| GET | `/api/admin/renewals` | expiries and re-checks inside the chase window |
| GET | `/api/admin/vendors/:id` | full dossier: checks, insurance, chases, audit, images |
| POST | `/api/admin/vendors/:id/checks/:key` | record one check's outcome. The badge follows |
| POST | `/api/admin/vendors/:id/insurance` | record a certificate. This is how insurance passes |
| POST | `/api/admin/vendors/:id/chase` | log a renewal chase |
| POST | `/api/admin/vendors/:id/suspend` | fail a named check with a written reason |
| POST | `/api/admin/sweep` | re-derive every badge. Cannot force one on |
| GET | `/api/admin/audit` | the whole append only trail |
| GET | `/api/vendors/me/verification` | the vendor's own progress, and whose turn it is |
| POST | `/api/vendors/me/rights` | the written rights confirmation |
| POST | `/api/vendors/me/images` | raw bytes, alt text in the query string |
| POST | `/api/billing/couple/upgrade` | records intent, takes no payment |
| POST | `/api/billing/vendor/subscribe` | records intent, takes no payment |

## Not production ready

Honest gaps, in the order they would need closing: no payment processor, no email or notification delivery, so workspace invitations and renewal chases must be sent by hand, no virus scanning on uploads and no EXIF stripping, no password reset, no two factor authentication on staff accounts (which now hold real power over the badge), and rate limiting is in-process so it resets on restart and does not span instances. The enquiry expiry sweep runs on a 15 minute in-process timer rather than a job queue.
