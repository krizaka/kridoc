# kridoc — detail for agents

Moved here from AGENTS.md when it took the org template (krizaka/.github `docs/standards/agents-template.md`). AGENTS.md is the short contract; this page is the repository's own detail, read by section.

Started from `krizaka/template-next-app`. The governance of the family is **krizaka-com's AGENTS.md** (theming with `var(--kz-*)`,
every string in `messages/*.json`, `@krizaka/ui` blocks, tests with every change, definition of done) — read it, do not copy it here.

- Shared things stay shared: the pipeline is `krizaka/.github` reusable workflows (`ci.yml` only wires it), deploys go through
  `krizaka-deploy`, the SEO contract is the `krizaka-seo-family` bin of `@krizaka/config`, the ast-grep rules and ratchet
  are the org's (`rules/`, `sgconfig.yml`, `scripts/sg-ratchet.mjs`: **do not edit them here**, change them in the template and in the org).
- **DO routes**: the spec lists no route one by one (App Platform has no regex): one `/` per component; fine routing is code in the
  app (`lib/dev-host.ts`, `proxy.ts`) with tests.
- Environment variables are declared once in `apps/web/lib/env.ts`, named by bounded context.
- **Database** (krizaka-internal#3717): Kridoc owns its PostgreSQL, shared with no other product. The `@krizaka/db` client sits behind a port in
  `apps/web/lib/db/` (`document-store.ts`; no query outside it); the schema is the dated files of `infra/migrations/YYYY-MM-DD-name.sql`
  (never edited once applied: a change is a new file). `pnpm db:rebuild` (DATABASE_URL, never production, `--yes` for a remote host)
  drops `public` and migrates from zero. The database tests (`lib/db/*.integration.test.ts`) need a real PostgreSQL and fail without
  `DATABASE_URL` (CI starts one; locally `docker run -p 55432:5432 -e POSTGRES_USER=kridoc_db -e POSTGRES_PASSWORD=ci-only-password postgres:16`).
  The feature is off by default (`DATABASE_ENABLED`): only when it is `on` does production require `DATABASE_URL` and `DATABASE_CA_CERT`.
- `dev-preview.json` is data: `devPreview` is claimed only when every criterion has fresh evidence.

## 9. Anti-slop (ADR-015)

What a model tends to write and the code does not need. Each line points at the rule that refuses it
([ADR-015](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-015-ai-code-audit-measured-and-enforced.md), [docs/standards/guards.md](https://github.com/krizaka/.github/blob/main/docs/standards/guards.md)).

1. **No defensive null on `@NullMarked` code.** No `Objects.requireNonNull` or `if (x == null)` on a value the type already
   guarantees. Enforced by NullAway at compile time; a new package is `@NullMarked` (ArchUnit).
2. **A closed set is a type.** An enum, a sealed interface or an `as const` object, never a string compared by hand;
   strategies are a `Map<Kind, Strategy>` built once at startup. Enforced by PMD / ArchUnit (Java) and `no-enum-string-compare` (ast-grep).
3. **HTTP in Java is a DTO record, `@Valid` and `ProblemDetail`.** No `Map.of("error", …)`, no entity in a response, one
   `@RestControllerAdvice` per service. Enforced by ArchUnit.
4. **No `*Utils`, `*Helper` or `*Manager`.** Name the thing by what it does (§4). Enforced by ArchUnit (ADR-015 §5).
5. **`?.` and `??` in TypeScript**, not a chain of `&&` or a ternary on null. The target rules are `@typescript-eslint/prefer-optional-chain` and `prefer-nullish-coalescing`; they are not in `@krizaka/config` yet.
6. **The build is the judge.** Compile, lint and test before every push; `krizaka-edit-check` runs on each edit (below) and
   NullAway and ArchUnit run at pre-push and in CI. A rule is never silenced to get green.

**The edit hook.** Every repository adds this to `.claude/settings.json`. After each `Edit` or `Write`, the one file is
checked in under 10 s: ESLint with the repository's config for TypeScript, PMD with the Krizaka rules for Java (never Maven).
A finding comes back to the agent (exit 2); a timeout is silent.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npx --yes -p @krizaka/config krizaka-edit-check", "timeout": 10 }]
      }
    ]
  }
}
```

In a TypeScript repository that already depends on `@krizaka/config`, use `npx --no-install krizaka-edit-check` (no download).
