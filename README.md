# Bank Feedback & Customer Experience System

QR-based customer feedback for bank branches, districts and departments, with a separate,
permission-controlled admin portal. Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · Prisma 7 · PostgreSQL.

- **Customers** scan a QR code and open `/f/[code]`: anonymous, no login, mobile-first, under a minute.
- **Light / dark theme:** a Light · Dark · System switch is on every screen; it follows the OS by default and the choice is remembered in the browser. The printable QR sheet is always light.
- **Staff** use `/admin`: questionnaires, QR codes, feedback (view and forward to a colleague), reports, users and roles. Every page, server action, route handler and service enforces RBAC and organizational scope on the server.

## Setup

```bash
cp .env.example .env        # set DATABASE_URL and AUTH_SECRET (>= 32 chars)
npm install
npm run db:deploy           # apply migrations (prisma migrate deploy)
npm run db:seed             # permissions, roles, sample organization, demo users, sample survey + QR
npm run dev
```

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

The seed prints a random password for the demo users (`admin@`, `sysadmin@`, `head@`, `district@`, `bole@`,
`analyst@` — all `@bank.local`) and the sample QR link (`/f/XXXXXXXX`). Set `SEED_PASSWORD` in `.env` to choose the
password instead; it is re-applied to existing seeded accounts too, so an old password stops working.

**Production:** run `npm run db:seed:prod` (not `db:seed`; `prisma db seed` does not set `NODE_ENV`). It requires
`SEED_PASSWORD`, creates only `admin@bank.local` (forced to choose a new password at first sign-in), creates no demo
data, and deactivates any demo accounts left over from a development database. Start production from a fresh
database, and replace `admin@bank.local` with a real mailbox so "Forgot password" works.

Set `NEXT_PUBLIC_APP_URL` to the real public domain **before printing QR codes** (it is embedded in them) and
optionally `NEXT_PUBLIC_BANK_NAME` for the customer page header.

## Scripts

| Script                                  | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run dev` / `build` / `start`       | Next.js                                                |
| `npm run typecheck` / `lint` / `format` | TypeScript, ESLint, Prettier                           |
| `npm test`                              | Vitest: unit + integration against the `.env` database |
| `npm run db:migrate`                    | `prisma migrate dev` (needs shadow-database rights)    |
| `npm run db:deploy`                     | `prisma migrate deploy`                                |

## Architecture

```
src/lib/rbac         permission catalog, pure scope logic, authorize primitives
src/lib/auth         password/session crypto, cookie handling (Next-only)
src/lib/questionnaire  shared engine: question types, conditional logic, answer validation
src/lib/export       CSV / Excel writers (formula-injection safe)
src/server/services  business logic; every function takes the actor and authorizes first
src/server/actions   thin "use server" wrappers: session → service → safe result
src/app              routes (/f public, /admin staff, /login)
prisma/              schema, migrations, seed
tests/               unit + database integration tests (auth, RBAC, questionnaires, QR, feedback, security)
```

Authorization chain: session → active user → role assignments → permission → scope → action.
Roles carry permissions only; a role _assignment_ carries a scope (bank / district / branch / department).
Scoped reads are filtered in the database query, never in React, and out-of-scope ids return 404.

### Questionnaires

`DRAFT → PUBLISHED → ACTIVE ⇄ PAUSED → CLOSED`. Only drafts are editable. Publishing freezes an immutable
version snapshot, so historical feedback always matches the form it was answered on. QR codes point to a
_location_; each location shows its currently ACTIVE questionnaire (branch/department → district → bank-wide).

## Security model

- **Sessions:** opaque 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`__Host-` + `Secure` in production);
  only an HMAC of the token is stored; 8 h hard limit, 30 min idle; revoked instantly on deactivation or password change.
- **Email (SMTP):** with `SMTP_*` set, new users get an invitation link to choose their own password (nobody handles a password), and “Forgot password” emails a one-time link (60 min, single use, only a hash stored, identical answer whether or not the account exists, rate-limited, ends all sessions on success). Without SMTP the app falls back to administrator-set passwords. `SMTP_ALLOW_SELF_SIGNED=true` turns off certificate checking; use it only on a trusted network. Tests never send mail (in-memory capture driver).
- **Login:** bcrypt, generic error messages, per-account lockout, per-source and per-account rate limits.
- **Privilege escalation:** you can only grant/edit roles, assign scopes and manage users whose access you already hold.
- **Public endpoint:** every answer is re-validated server-side with the shared engine; layered rate limits;
  customer-safe error messages only; answers to hidden questions are dropped; contact details exist only on opt-in.
- **Forwarding:** a user with `feedback.forward` can send a record they can see to an active colleague who holds `feedback.view`. It shares only that record; there are no assignments or statuses, just a read marker. The action is audited.
- **Personal data:** phone numbers need the separate `feedback.view_contact` permission over the record's location.
- **Exports:** limited to the intersection of the user's view and export scopes, audited, and neutralize spreadsheet formulas.
- **Headers:** CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, no-store on authenticated pages.
- **Audit log:** logins, user/role/organization changes, questionnaire lifecycle, QR changes, exports, deletions. Secrets are never logged.
- `tests/security.test.ts` fails if a new server action does not reject signed-out callers.

### Deployment notes

- Put the app behind a reverse proxy that **overwrites** `X-Forwarded-For` (rate limiting and IP hashing trust it) and terminates HTTPS.
- CSP currently allows inline scripts (Next.js bootstrap). Tighten with per-request nonces via `proxy.ts` if your policy requires it.
- Scans count page opens (repeat opens from a device within 5 min count once), not unique customers.
- Reporting days follow East Africa Time (UTC+3), see `src/lib/time.ts`.

## Migrations without shadow-database rights

If the DB user cannot create databases, `prisma migrate dev` fails (P3014). Generate SQL with
`prisma migrate diff --from-migrations … --to-schema … --script`, place it in a new
`prisma/migrations/<timestamp>_<name>/migration.sql`, and apply with `npm run db:deploy`.
