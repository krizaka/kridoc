<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://krizaka-assets.b-cdn.net/brand/kachizaka/logo-dark.svg">
    <img src="https://krizaka-assets.b-cdn.net/brand/kachizaka/logo-light.svg" alt="Kridoc" width="96">
  </picture>
</p>

# Kridoc

> **Kridoc by Krizaka**: one name everywhere, the repository, the packages, the ids and every word a visitor reads (the catalogues
> `apps/web/messages/*.json`). The former code name is history only (krizaka-internal#2659); a test fails if it comes back in a rendered word.

**Status: in design.** Kridoc is Krizaka's document storage. Its need and scope are being settled; nothing is built or offered
yet: no sign-up, no waiting list, no date.

[![CI](https://github.com/krizaka/kridoc/actions/workflows/ci.yml/badge.svg)](https://github.com/krizaka/kridoc/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## What is here

Today, one thing: the **coming-soon page** of `www.kridoc.com` (`apps/web`; its hosting is being decided), French by default and English, built with
`@krizaka/ui` and `@krizaka/fonts`, in both themes. It says what Kridoc is in one line, that it is in design, and links back to
[krizaka.com](https://www.krizaka.com). It holds no customer data.

The product's code arrives here once its scope is decided. krizaka.com shows Kridoc as a card « En conception » / « In design ».

## Commands

```bash
pnpm install
pnpm check      # lint (ESLint, i18n, ast-grep ratchet), typecheck, tests
pnpm build
```

## How it is built

Started from [`krizaka/template-next-app`](https://github.com/krizaka/template-next-app): the pipeline is the org's reusable
workflows (`.github/workflows/ci.yml` only wires them), the SEO contract is `scripts/check-seo-family.mjs` (an identical copy in
every Krizaka site), and the rules for agents are in [AGENTS.md](AGENTS.md) and [docs/agents.md](docs/agents.md).

## Workflows

What runs in the Actions tab of this repository.

- **CI** (`ci.yml`): Lint, tests and build of the repository. Runs on push, on every pull request, in the merge queue.
- **Dependabot auto-merge** (`dependabot-automerge.yml`): Auto-merges safe Dependabot updates. Runs on every pull request.
- **Template drift** (`drift.yml`): Checks the repository against the template it started from. Runs on demand.
- **Merge resolution** (`merge-resolution.yml`): Fails a PR that drops what main added without a deletion-explained line. Runs on every pull request.
- **Promote to production** (`production.yml`): Fast-forwards the production branch to the release tag. Runs when a release is published, on demand.
- **Release PR** (`release-please.yml`): Keeps one release PR open from the merged commits; its merge tags the release. Runs on push.
- **Security scan** (`security.yml`): Secret scan (gitleaks) and workflow scan (zizmor); both are required checks. Runs on every pull request, in the merge queue, on push.

## Licence

The code of this repository (the coming-soon site) is under the [Apache License 2.0](LICENSE). Kridoc's trademarks:
[TRADEMARKS](https://github.com/krizaka/.github/blob/main/TRADEMARKS.md).

## Deploys

A release train, as krizaka-com runs it: release-please keeps one « chore: release » pull request; merging it tags `vX.Y.Z`, and
`production.yml` fast-forwards the `production` branch to the tag (`scripts/promote-production.mjs`, never forced, never backwards).
The App Platform app `kridoc` (`.do/app.yaml`, www.kridoc.com) deploys from `production`, never from `main`.

## Layout

As Verikora and Folioviv: `apps/web` (this site), room kept for `apps/mobile` (Expo) and `apps/desktop` (Tauri) and for `packages/*`
(the workspace is `apps/*` + `packages/*`). Mobile and desktop come once the design phase sets their scope (krizaka-internal#1916).
