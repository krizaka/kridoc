#!/usr/bin/env bash
# Runs after the production build (node-ci `after-build`; the repository root is the working directory): the SEO family contract
# on the built site, and the routes of the DO spec (no list of routes: krizaka-deploy routes).
set -euo pipefail
export NODE_ENV=production PORT=3000
# The keys the production boot requires (apps/web/lib/env.ts): throwaway CI values, no real database behind them.
export DATABASE_URL=postgres://ci:ci@localhost:5432/ci
export AUTH_SESSION_SECRET=ci-only-session-secret-not-a-real-one-0123456789
trap 'tail -100 web.log || true' ERR
(cd apps/web && pnpm exec next start -p 3000 > ../../web.log 2>&1 &)
for _ in $(seq 1 60); do curl -sf http://localhost:3000/api/healthz && break; sleep 1; done
# The host of the `seo:check` script, normalised the way a URL is (the template's placeholder host has capitals, Next lowercases it).
HOST="$(node -e "console.log(new URL(require('./package.json').scripts['seo:check'].match(/--host (\\S+)/)[1]).origin)")"
pnpm exec krizaka-seo-family --base http://localhost:3000 --host "$HOST" --types WebSite
# No retired code name in the catalogues (rule commercial-names, krizaka-internal#2036). The built pages are not gated yet: see krizaka-internal#3667.
(cd apps/web && pnpm run check:code-names)
