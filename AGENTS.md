# kridoc — agent contract

<!-- krizaka-agents-template v2: rendered from krizaka/.github docs/standards/agents-template.md (scripts/agents-md.mjs). The one AGENTS.md standard: six sections in this order, at most 150 lines, bullets and imperatives. The conformance check « agents-template » reads the headings, the length and CLAUDE.md. Detail goes to docs/ via References, not here. -->

## Project context

- Kridoc's coming-soon site (www.kridoc.com); Kridoc, Krizaka's document storage, is in design.
- Kind: `site` · team: `krizaka` · registry entry: [repos.json](https://github.com/krizaka/.github/blob/main/repos.json).
- Read this file first, then the section of [docs/agents.md](docs/agents.md) for what you touch.
- `CLAUDE.md` is the one line `@AGENTS.md` (or a symlink to this file): never a second copy of it.
- This repository is public: its jobs run on GitHub-hosted runners, never on the private Mac runner (`self-hosted`; krizaka-internal#3633).
- No `schedule:` trigger in CI (krizaka-internal#2364): template drift runs on demand (`workflow_dispatch`); everything else runs on pull requests and merges.

## Essential commands

pnpm monorepo (Node ≥ 22, pnpm 10, turbo):

```bash
pnpm install --frozen-lockfile
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

- `pnpm run check` runs lint, typecheck and test in one go; `pnpm run format:check` is the read-only format check inside lint.
- `pnpm run drift` checks the template drift; `pnpm run db:rebuild` rebuilds a local database (`DATABASE_URL`, never production).
- Run them on what you changed before every push; CI runs the rest.

## Architecture & conventions

- Follow the [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md); search its [packages reference](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/references/packages.md) before writing anything generic.
- Take libraries first: a size check, a date sum, a money format, a fetch, a retry, a rate limit, a validation regex come from `@krizaka/*`; a missing function goes into the package first, never a local copy.
- Keep ports and adapters: domain code reads no env, no ambient clock, no database client; services talk to ports; route handlers are thin (authenticate, parse, one service call, map the result).
- Write one job per function: cognitive complexity ≤ 15, nesting ≤ 2, a body under 60 lines; a form saves once; the same block twice is a function (in two repositories, a package function).
- Put limits, prices, durations and flags in settings an administrator changes, not in constants.
- Make a closed set a type (`as const` object), never strings compared by hand.
- Type errors with a stable code, mapped to HTTP once; user messages come from the catalogues.
- Name things by what they do (`media-store.ts`, never `postgres.ts`, `utils`, `helpers`, `manager`).
- Declare environment variables once, in `apps/web/lib/env.ts`, named by bounded context.
- Put the Kridoc database behind the port in `apps/web/lib/db/` (no query outside it); the schema is the dated files of `infra/migrations/YYYY-MM-DD-name.sql`.
- Hierarchy: this root file holds the rules of the whole repository; a sub-folder with its own rules adds a local `AGENTS.md` that says only what differs there. The nearest file wins.

## Guard-rails & known pitfalls (read before coding)

- The checks are the judge ([ADR-015](https://github.com/krizaka/krizaka-internal/blob/main/docs/adr/.github/ADR-015-ai-code-audit-measured-and-enforced.md), [guards](https://github.com/krizaka/.github/blob/main/docs/standards/guards.md)): never `--no-verify`, never a new `eslint-disable`, never a raised ratchet or baseline (`sg-ratchet.json`); a rule is never silenced to get green.
- Never edit the shared ast-grep rules, `sgconfig.yml` or `scripts/sg-ratchet.mjs` here: change them in the template and in the org.
- Keep `ci.yml` a wiring of the `krizaka/.github` reusable workflows; do not copy the pipeline. Deploys go through `krizaka-deploy`; the SEO contract is the `krizaka-seo-family` bin of `@krizaka/config`.
- DO routes: the App Platform spec lists no route one by one (no regex), one `/` per component; fine routing is code in the app (`lib/dev-host.ts`, `proxy.ts`) with tests.
- Never edit an applied migration: a change is a new dated file. Database tests (`lib/db/*.integration.test.ts`) need a real PostgreSQL and fail without `DATABASE_URL`; never point it at production.
- Features are off by default (`DATABASE_ENABLED`, `AUTH_ENABLED`, `MEDIA_STORAGE_ENABLED`): off means routes answer 404 and nothing is required.
- Never log a password, hash, token or key; audit lines carry the key hash, never a token or a title.
- Every string is in `apps/web/messages/*.json` (FR and EN); `pnpm run check:i18n` fails otherwise.
- `dev-preview.json` is data: claim `devPreview` only when every criterion has fresh evidence.
- Start a fix with a failing test; every bug gets its guard; the journey (end to end) proves the feature.
- Never invent a URL, a law article, a price or a figure you did not read; write `TO VALIDATE` and say who decides.
- Never commit a secret, a capture or a log; no production data in a session, only the dev data.
- Never write a person's name, address or phone number on a public surface of this public repository.

## Expected validation workflow

- [ ] Format, lint, typecheck and test what changed (the commands above); fix the cause of a red, never the guard.
- [ ] The « before you push » checklist of the skill holds for what changed.
- [ ] A feature or fix PR names its journey (`Journey: <name>` or `Journey: n/a — <reason>`).
- [ ] README and generated docs still say what the code does; the docs map category of the change is updated.
- [ ] One issue, one small PR; merge only with green CI.

## References

- [docs/agents.md](docs/agents.md): this repository's own detail (database, accounts, documents, storage API, intake), read by section.
- [Org standards](https://github.com/krizaka/.github/tree/main/docs/standards) of krizaka/.github; the [engineering charter](https://github.com/krizaka/.github/blob/main/AGENTS.template.md).
- [krizaka-engineering skill](https://github.com/krizaka/krizaka-skills/blob/main/skills/krizaka-engineering/SKILL.md).
