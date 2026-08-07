# Deploying AETERNA

The whole stack is one Node process with SQLite on local disk and vendor
uploads in a local folder. That shape makes deployment cheap and simple, and it
dictates one hard rule: **one machine with a persistent disk**. No serverless,
no horizontal scaling, no ephemeral filesystems, until the "what changes at
scale" section says otherwise.

## Requirements

- Node 22 or newer (the built-in `node:sqlite` driver)
- A persistent disk for `data/` (database, uploads, email outbox)
- Outbound HTTPS (Anthropic, Stripe, Resend or Postmark, Unsplash image CDN)
- No build step and no dependencies to install

## Recommended hosts

Any of these fit the single-process-plus-disk shape. Ordered by how little
there is to think about:

| Host | Shape | Rough cost | Notes |
| --- | --- | --- | --- |
| Fly.io | Machine + volume | ~$5 to 10/mo | `fly launch`, attach a volume, mount at `/app/data` |
| Railway | Service + volume | ~$5/mo | Volume mounted at `data/` |
| Hetzner or any VPS | systemd + Caddy | ~5 EUR/mo | Most control, most to maintain |
| Render | Web service + disk | ~$7/mo | Disk add-on required, the free tier has no persistent disk |

Whatever the host: run `node server/index.js`, mount a persistent volume at
`data/`, put TLS in front.

## The fast path: Fly.io with the included config

A `Dockerfile` and `fly.toml` ship in the repository. The image is node:22-alpine,
runs as a non-root user, keeps state in `/data`, and answers a container
healthcheck on `/api/health`.

```bash
fly launch --no-deploy --copy-config   # accept or rename the app
fly volumes create aeterna_data --region lhr --size 1
fly secrets set AETERNA_SECRET=$(openssl rand -hex 32)
fly secrets set APP_ORIGIN=https://<your-app>.fly.dev
fly deploy
```

Then create the first admin over `fly ssh console` (the exact one-liner is in
the checklist below and in fly.toml's comments). Set the optional keys
(Anthropic, Stripe, Resend) as `fly secrets` whenever they are ready; the app
reports its honest mode for each until then.

Security posture the server handles itself when `APP_ORIGIN` is https:
session cookies carry the `Secure` flag, `Strict-Transport-Security` is sent,
and every HTML response carries a Content Security Policy with `script-src 'self'`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (4173) | Listen port |
| `APP_ORIGIN` | **yes in production** | e.g. `https://aeterna.co.uk`. Used in emails, RSVP links and Stripe redirects |
| `AETERNA_SECRET` | **yes in production** | Session signing key. 32+ random bytes. Without it a per-disk dev secret is generated |
| `AETERNA_DATA_DIR` | no | Override the data directory, e.g. a mounted volume path |
| `ANTHROPIC_API_KEY` | no | Live AI planner. Without it the offline engine answers and says so |
| `STRIPE_SECRET_KEY` | no | Real payments. Without it checkout reports 503 and the recorded-intent mock runs |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Webhook signature verification |
| `RESEND_API_KEY` or `POSTMARK_TOKEN` | no | Email delivery. Without either, emails go to `data/outbox` and every response says so |
| `EMAIL_FROM` | with email | e.g. `AETERNA <hello@aeterna.co.uk>` from a verified sending domain |
| `AETERNA_DEMO` | never in production | Seeds demo accounts and enables the listing-claim endpoint |
| `AETERNA_RATE_MULTIPLIER` | never in production | Relaxes rate limits for the test suite |

Generate the secret once: `openssl rand -hex 32`.

## Going live checklist

1. **DNS and TLS.** Point the domain at the host, terminate TLS at the platform
   proxy or Caddy. Set `APP_ORIGIN` to the https URL.
2. **Secrets.** Set `AETERNA_SECRET`. Confirm `AETERNA_DEMO` is unset: the demo
   flag seeds an admin account with a known password.
3. **Create the real admin.** With demo mode off there is no admin seed. Insert
   one directly on the box (single deliberate step, not an open endpoint):
   `node -e "const{run,id,now}=require('./server/db');const{hashPassword}=require('./server/lib/auth');run('INSERT INTO users (id,email,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)',id('usr'),'you@aeterna.co.uk',hashPassword(process.env.PW),'admin','AETERNA team',now())" `
4. **AI planner.** Set a working `ANTHROPIC_API_KEY`. The boot banner and
   `/api/health` report the probed truth, not the key's presence.
5. **Stripe.** Create the webhook endpoint in the Stripe dashboard pointing at
   `https://<domain>/api/stripe/webhook`, subscribe to
   `checkout.session.completed` and `customer.subscription.deleted`, copy the
   `whsec_...` into `STRIPE_WEBHOOK_SECRET`. Test mode first: run one vendor
   checkout and one couple upgrade with card `4242 4242 4242 4242`, confirm the
   entitlement flips.
6. **Email.** Verify the sending domain with Resend or Postmark (SPF and DKIM
   records), set the key and `EMAIL_FROM`. Until then everything lands in
   `data/outbox` and the interface says the email was not delivered.
7. **Health.** Point uptime monitoring at `/api/health`. It includes the AI
   planner's probed status.

## Backups

Everything that matters lives in `data/`. SQLite in WAL mode backs up safely
with its own tooling while the server runs:

```bash
sqlite3 data/aeterna.db ".backup data/backup-$(date +%F).db"
tar -czf backup-$(date +%F).tar.gz data/backup-$(date +%F).db data/uploads
```

Nightly cron, ship the tarball off the machine (rclone to object storage),
keep 30 days. Test a restore once before launch, not after the first incident.

## Updating

```bash
git pull && systemctl restart aeterna     # or the platform's deploy command
```

Schema migrations are additive and run automatically at boot. Rollback is
git checkout of the previous tag plus restart; migrations never destroy
columns, so an older build runs against a newer database.

## What changes at scale, in the order it will actually bite

1. **~50 real vendors: email and Stripe stop being optional.** Everything else
   holds.
2. **A few thousand users: move rate limiting and the sweeps out of process.**
   Both are in-memory today, reset on restart, and assume one process.
3. **Uploads outgrow the disk: object storage.** `server/lib/uploads.js` is the
   only file that touches the filesystem for images, so S3-compatible storage
   is a one-module change.
4. **SQLite write contention (tens of thousands of users): Postgres.** The data
   layer is small (`server/db.js`) and every query goes through it. This is a
   real but bounded migration, and far later than intuition suggests: SQLite in
   WAL mode comfortably serves this product's read-heavy shape to low tens of
   thousands of users.
5. **Two machines: not before all of the above.** The single-process design is
   a feature until the numbers say otherwise.

## Security notes for production

- Staff accounts control the Verified badge and have no 2FA yet. Until they
  do, use a long unique password and consider IP-restricting `/admin` at the
  proxy.
- Uploads are magic-byte checked but not virus scanned and EXIF is not
  stripped. GPS coordinates in vendor photos survive upload.
- The rate limits are per-process and reset on restart.
- Set `x-forwarded-proto` and `host` correctly at the proxy: RSVP links and
  Stripe redirect URLs are built from them (or from `APP_ORIGIN`, which wins).
