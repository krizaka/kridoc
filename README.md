<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://krizaka-assets.b-cdn.net/brand/kachizaka/logo-dark.svg">
    <img src="https://krizaka-assets.b-cdn.net/brand/kachizaka/logo-light.svg" alt="Kridoc" width="96">
  </picture>
</p>

# Kridoc

> **Kridoc by Krizaka** is the commercial name; `kachizaka` is the code name (repository, packages, ids). Visitors read Kridoc
> everywhere (the catalogues `apps/web/messages/*.json`); a test fails on the code name in a rendered word.

**Status: in design.** Kridoc is Krizaka's document storage. Its need and scope are being settled; nothing is built or offered
yet: no sign-up, no waiting list, no date.

[![CI](https://github.com/krizaka/kachizaka/actions/workflows/ci.yml/badge.svg)](https://github.com/krizaka/kachizaka/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/krizaka/kachizaka/badge)](https://scorecard.dev/viewer/?uri=github.com/krizaka/kachizaka)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=krizaka_kachizaka&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=krizaka_kachizaka)

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

## Licence

The code of this repository (the coming-soon site) is under the [Apache License 2.0](LICENSE). Kridoc's trademarks:
[TRADEMARKS](https://github.com/krizaka/.github/blob/main/TRADEMARKS.md).
