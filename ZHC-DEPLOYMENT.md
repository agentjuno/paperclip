# ZHC Institute — Paperclip Integration

## Architecture

```
zhcinstitute.com           → zhc-nextjs (Vercel)
app.zhcinstitute.com       → This Paperclip fork (Railway / Fly.io / Render)
```

Members authenticate on zhcinstitute.com via wallet sign-in, which sets a
`zhc_gating_session` cookie on `.zhcinstitute.com`. When they visit
`app.zhcinstitute.com`, the ZHC auth bridge middleware reads that cookie,
verifies it, and auto-provisions a Paperclip user + company for the wallet.

## What was customized (merge-safe)

| File | Purpose |
|------|---------|
| `server/src/middleware/zhc-auth-bridge.ts` | **New file** — reads ZHC wallet session, auto-provisions user + company |
| `server/src/app.ts` | Added `zhcSessionSecret` option + mount bridge before actorMiddleware |
| `server/src/index.ts` | Passes `ZHC_GATING_SESSION_SECRET` env var to createApp |
| `server/src/middleware/auth.ts` | Skip re-resolution if upstream middleware already set actor |
| `ui/src/zhc-theme.css` | **New file** — ZHC brand theme (dark + sand/gold accents) |
| `ui/src/main.tsx` | Import zhc-theme.css after index.css |
| `.env.example` | Added `ZHC_GATING_SESSION_SECRET` |

All core Paperclip files remain untouched. To pull upstream:

```sh
git fetch upstream
git merge upstream/main
```

Conflicts should be minimal since our changes are additive.

## Environment Variables

### Required for ZHC integration

```env
# Must match the GATING_SESSION_SECRET in zhc-nextjs
ZHC_GATING_SESSION_SECRET=your-shared-secret

# Production deployment
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=public
PAPERCLIP_PUBLIC_URL=https://app.zhcinstitute.com
BETTER_AUTH_SECRET=generate-a-strong-secret
HOST=0.0.0.0
PORT=3100

# Database (use provider's Postgres)
DATABASE_URL=postgres://user:pass@host:5432/paperclip
```

### In zhc-nextjs (.env)

```env
NEXT_PUBLIC_PAPERCLIP_URL=https://app.zhcinstitute.com
```

## Cookie sharing

Both apps must share the `.zhcinstitute.com` cookie domain.

- zhc-nextjs sets `zhc_gating_session` with `domain=.zhcinstitute.com`
- Paperclip reads it via the ZHC auth bridge middleware

Check the zhc-nextjs gating verify endpoint to ensure the cookie domain is set:

```js
// In /api/gating/verify route handler, set cookie with:
cookies().set(GATING_COOKIE_NAME, token, {
  domain: '.zhcinstitute.com',  // ← ensure this is set
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 1200, // 20 minutes
})
```

## Multi-tenancy flow

1. Member logs in at zhcinstitute.com (wallet sign → JWT cookie)
2. Member clicks "My Company" → opens app.zhcinstitute.com
3. ZHC auth bridge reads cookie, verifies HMAC signature
4. First visit → auto-creates: Paperclip `user` row + `company` + `company_membership` (owner)
5. Return visit → resolves existing user, loads their company
6. Each member's data is isolated by `companyId` (standard Paperclip scoping)

## Local development

```sh
# Terminal 1: Paperclip (port 3100)
pnpm dev

# Terminal 2: zhc-nextjs (port 3000)
cd ../zhc-nextjs && npm run dev
```

For local dev, the cookie domain trick won't work (different ports, same host).
You can test the auth bridge by manually setting the `zhc_gating_session` cookie
in the browser for localhost, or temporarily use `local_trusted` mode.

## Pulling upstream updates

```sh
git fetch upstream
git merge upstream/main
# Resolve any conflicts (should be rare given our isolated changes)
pnpm install
pnpm -r typecheck
pnpm test:run
```
