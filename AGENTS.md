# AGENTS.md

Guidance for human and AI contributors working in this repository.

## 1. Purpose

Paperclip is a control plane for AI-agent companies.
The current implementation target is V1 and is defined in `doc/SPEC-implementation.md`.

## 2. Read This First

Before making changes, read in this order:

1. `doc/GOAL.md`
2. `doc/PRODUCT.md`
3. `doc/SPEC-implementation.md`
4. `doc/DEVELOPING.md`
5. `doc/DATABASE.md`

`doc/SPEC.md` is long-horizon product context.
`doc/SPEC-implementation.md` is the concrete V1 build contract.

When adding or changing an Apps catalog connection, also follow
`doc/connections/CONNECTOR-PLAYBOOK.md`. It is the canonical connection
authoring runbook for provider research, supported transport/auth patterns,
credential handling, branding, implementation, testing, live proof, and PR
submission.

## 3. Repo Map

- `server/`: Express REST API and orchestration services
- `ui/`: React + Vite board UI
- `packages/db/`: Drizzle schema, migrations, DB clients
- `packages/shared/`: shared types, constants, validators, API path constants
- `packages/adapters/`: agent adapter implementations (Claude, Codex, Cursor, etc.)
- `packages/adapter-utils/`: shared adapter utilities
- `packages/plugins/`: plugin system packages
- `packages/skills-catalog/`: app-shipped skills catalog (`@paperclipai/skills-catalog`)
- `packages/teams-catalog/`: app-shipped teams catalog (`@paperclipai/teams-catalog`)
- `cli/`: `paperclipai` CLI package (published bin, agent-facing commands)
- `skills/`: Paperclip runtime/operational skills (not part of the app catalog)
- `doc/`: operational and product docs

## 4. Dev Setup (Auto DB)

Use embedded PGlite in dev by leaving `DATABASE_URL` unset.

```sh
pnpm install
pnpm dev
```

This starts:

- API: `http://localhost:3100`
- UI: `http://localhost:3100` (served by API server in dev middleware mode)

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Reset local dev DB:

```sh
rm -rf data/pglite
pnpm dev
```

## 5. Core Engineering Rules

1. Keep changes company-scoped.
Every domain entity should be scoped to a company and company boundaries must be enforced in routes/services.

Explicit exception: announcement dismissals are instance-wide user preferences,
keyed by user and announcement so they persist across companies. Their audit
context must still validate company membership. The announcement publication-ID
registry is instance-level feed metadata; it contains no company or user data.

2. Keep contracts synchronized.
If you change schema/API behavior, update all impacted layers:
- `packages/db` schema and exports
- `packages/shared` types/constants/validators
- `server` routes/services
- `ui` API clients and pages

3. Preserve control-plane invariants.
- Single-assignee task model
- Atomic issue checkout semantics
- Approval gates for governed actions
- Budget hard-stop auto-pause behavior
- Activity logging for mutating actions

4. Do not replace strategic docs wholesale unless asked.
Prefer additive updates. Keep `doc/SPEC.md` and `doc/SPEC-implementation.md` aligned.

5. Keep repo plan docs dated and centralized.
When you are creating a plan file in the repository itself, new plan documents belong in `doc/plans/` and should use `YYYY-MM-DD-slug.md` filenames. This does not replace Paperclip issue planning: if a Paperclip issue asks for a plan, update the issue `plan` document per the `paperclip` skill instead of creating a repo markdown file.

6. Attach inspectable generated artifacts.
When your task produces a user-inspectable deliverable file, follow the Paperclip skill's "Generated Artifacts and Work Products" workflow before final disposition. In this repo, prefer the self-contained skill helper at `skills/paperclip/scripts/paperclip-upload-artifact.sh` so the file is available through the Paperclip API, create/update an artifact work product when the file is the deliverable, link the uploaded artifact in the final issue comment, and then set status. Do not rely on local filesystem paths as the only access path. If an important file intentionally remains workspace-only, create/update a work product with `metadata.resourceRef.kind: "workspace_file"` and a workspace-relative path, then name that work product and path in the final comment. Treat browse/search as a fallback for recovering workspace files, not the preferred deliverable path. See `doc/AGENT-ARTIFACTS.md` for details and `.mp4`/`.webm` examples.

7. Name the three data paths correctly.
This repo has three separate data paths. Do not confuse them. Match a change to a path by its file path, not by the word "observability" or "telemetry" alone.

- **Telemetry** is the Paperclip first-party event system. It is opt-out and it sends data to a Paperclip endpoint by default. Its paths are:
  - `packages/shared/src/telemetry/`
  - the generated contract `packages/shared/src/telemetry/generated/paperclip-telemetry.ts`
  - each caller of `packages/shared/src/telemetry/events.ts` or `packages/shared/src/telemetry/client.ts`
- **Observability** is the OpenTelemetry trace path. An operator must set an OTLP endpoint. Until an operator sets the endpoint, the tracer is a no-operation. Its paths are:
  - `server/src/instrumentation.ts`
  - `doc/observability.md`
  - `packages/adapter-utils/src/duplex-observability.ts`
  - `server/src/services/duplex-observability-recorder.ts`
  - the span attributes in `packages/adapter-utils/src/acpx-engine/startup-timing.ts`
- **The run log** holds rows in the local `heartbeat_run_events` table. The data stays in the instance database. Its paths are:
  - `doc/run-log-events.md`
  - `packages/db/src/schema/heartbeat_run_events.ts`
  - the append path `appendRunEvent` in `server/src/services/heartbeat.ts`

Apply a review level that matches the path:

- **Telemetry change (strict review).** The author updates the generated contract first. The author updates `packages/shared/src/telemetry/README.md` in the same pull request. The author requests a privacy review. Reason: a Telemetry event goes to a Paperclip endpoint by default, so a mistake sends data immediately.
- **Observability change (lighter review).** The operator endpoint gate stays in place. The no-operation behaviour stays when no endpoint is set. A privacy review is not necessary while the change stays inside the closed span-attribute allowlist.
- **Run-log change (no extra review).** A run-log change needs neither review level above, because the data stays in the instance database.

**Exclusion.** The word "observability" in a file such as `server/src/services/recovery-observability.ts` names a different concept. Apply this rule by path, not by word match.

## 6. Database Change Workflow

When changing data model:

1. Edit `packages/db/src/schema/*.ts`
2. Ensure new tables are exported from `packages/db/src/schema/index.ts`
3. Generate migration:

```sh
pnpm db:generate
```

4. Validate compile:

```sh
pnpm -r typecheck
```

Notes:
- `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`
- `pnpm db:generate` compiles `packages/db` first

## 7. Verification Before Hand-off

Default local/agent test path:

```sh
pnpm test
```

This is the cheap default and only runs the Vitest suite. Browser suites stay opt-in:

```sh
pnpm test:e2e
pnpm test:release-smoke
```

Run the browser suites only when your change touches them or when you are explicitly verifying CI/release flows.

For normal issue work, run the smallest relevant verification first. Do not default to repo-wide typecheck/build/test on every heartbeat when a narrower check is enough to prove the change.

Run this full check before claiming repo work done in a PR-ready hand-off, or when the change scope is broad enough that targeted checks are not sufficient:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 8. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:

- apply company access checks
- enforce actor permissions (board vs agent)
- write activity log entries for mutations
- return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 9. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors
- Form and wizard footers: keep Save & exit (or Cancel/Back) left and the primary action right in the same vertically aligned row. Each step owns the entire footer; never append Save & exit as a separate row. See `DESIGN.md`.

## 10. Pull Request Requirements

When creating a pull request (via `gh pr create` or any other method), you **must** read and fill in every section of [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). Do not craft ad-hoc PR bodies — use the template as the structure for your PR description. Required sections:

- **Thinking Path** — trace reasoning from project context to this change (see `CONTRIBUTING.md` for examples)
- **What Changed** — bullet list of concrete changes
- **Verification** — how a reviewer can confirm it works
- **Risks** — what could go wrong
- **Model Used** — the AI model that produced or assisted with the change (provider, exact model ID, context window, capabilities). Write "None — human-authored" if no AI was used.
- **Checklist** — all items checked

## 11. Definition of Done

A change is done when all are true:

1. Behavior matches `doc/SPEC-implementation.md`
2. Typecheck, tests, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
5. PR description follows the [PR template](.github/PULL_REQUEST_TEMPLATE.md) with all sections filled in (including Model Used)

## Design system

`DESIGN.md` at the repo root is the source of truth for UI design decisions. The token-only rule applies to all `ui/` changes: every color, spacing, radius, type, shadow, and motion value in `ui/src/components/**` and `ui/src/pages/**` comes from the token layer in `ui/src/index.css` — no hex, raw px, arbitrary Tailwind bracket values, or raw `font-size`/`fontSize` declarations in components, outside the documented allowlist in `ui/src/index.css`. Run `pnpm check:token-gates` (`scripts/check-token-gates.mjs`) before committing UI changes — it fails on any violation not covered by that allowlist.

## Local checkout divergence and update pulls (operator note, 2026-09-26)

This checkout (`/ssd/paperclip`, tracks `paperclipai/paperclip` `master`) intentionally carries **uncommitted local changes** on top of upstream. The running Paperclip instance (`~/.paperclip/instances/default`, served at `paperclip.potatojetson.dpdns.org`) is built from this tree, so losing these changes regresses the product the operator uses.

What is divergent:

1. **OpenCode new-agent wizard fix** (reported upstream as [#14078](https://github.com/paperclipai/paperclip/issues/14078); a fix was deliberately NOT proposed upstream — report only). Files: `ui/src/components/new-agent/NewAgentSetup.tsx`, `ui/src/components/ai-connections/AiConnectionPicker.tsx`, `ui/src/components/ai-connections/AiConnectionField.tsx`, `ui/src/lib/agent-setup-fields.ts`, `ui/src/lib/provider-credential.ts`, `tests/ai-connections-app/app.spec.ts`, plus new `ui/src/components/ai-connections/AiConnectionPicker.test.tsx`. Behavior to preserve: for OpenCode/Pi the wizard starts with **no managed AI connection** (harness sign-in via `opencode auth login` is the default, matching onboarding), the AI-connection picker offers a clear/"environment sign-in" choice, API-key fields are opt-in, and the model catalog refreshes on load.
2. **`PAPERCLIP_OPENCODE_MCP` per-agent MCP injection** (local feature, not upstream). Files: `packages/adapters/opencode-local/src/server/runtime-config.ts` (+ `runtime-config.test.ts`). Behavior: a JSON object in OpenCode's `mcp` shape, set in an agent's `adapterConfig.env.PAPERCLIP_OPENCODE_MCP`, is merged (with `{env:VAR}` expansion from the run env) over the copied global `mcp` block in the runtime config. Needed because Paperclip force-disables project-level opencode config on runs, so per-repo MCP enablement has no native path. Used by the `woo-product-agent` agent (company `d82f6b70-…`): it injects the `woocommerce` MCP server with credentials resolved from company secrets bound to the agent env.
3. **OpenCode model fallback on quota exhaustion** (local feature, not upstream). Files: `packages/adapters/opencode-local/src/server/execute.ts` (+ `execute.test.ts`), `packages/adapters/opencode-local/src/index.ts` (config-doc line), `ui/src/adapters/opencode-local/config-fields.tsx` (+ `config-fields.test.tsx`). Behavior: `adapterConfig.fallbackModels` (provider/model ids, visible/editable in the agent Runtime page under Advanced → "Fallback models") rotates a run to the next model — continuing the same opencode session — only when the failure is classified as provider quota/rate-limit exhaustion (429, 402, rate limit, quota, insufficient funds/credits, plus the Chinese quota messages z.ai returns). Auth/config errors still fail fast. Every run starts on the configured primary, so recovery after a quota window is automatic; run notes and billing attribution record the model actually used. Used by all five KIDAA agents: primary `zai/GLM-5.1_F`, fallback `opencode/muse-spark-1.3-contributor-free` (the free Zen variant).
4. **Pre-existing local work** (present before the fix above; not authored during that session): `ui/src/components/OnboardingWizard.tsx`, `ui/src/components/OnboardingWizard.test.tsx`, `ui/src/components/AdapterLoginChrome.tsx`, `ui/src/adapters/adapter-display-registry.ts`, untracked `PAPERCLIP_MULTIMODEL_SETUP.md` and `gitpush_donotrunwithsudo.sh`.
5. **Agent-chat clear-history button** (local feature, 2026-09-30, committed on local master via branch `local/chat-clear-bulk-delete`; upstream PR may follow). Files: `server/src/routes/issues.ts` (`DELETE /issues/:id/comments` — conversation-owner-only bulk tombstone + session reset: bumps `conversationSessionGeneration`, clears `conversationBoundaryCommentId`, expires pending `ask_user_questions`, deletes `agentTaskSessions`, activity `issue.conversation_cleared`), `packages/shared` (types + `bulkDeleteIssuesSchema`), `ui/src/api/issues.ts` (`clearComments`), `ui/src/pages/IssueDetail.tsx` (eraser icon button next to the agent-settings breadcrumb button + destructive confirm dialog), tests in `server/src/__tests__/agent-conversations.test.ts` and `ui/src/pages/IssueDetail.test.tsx`. Behavior to preserve: only the conversation owner sees the button; clearing deletes all messages for both sides and the agent starts a fresh session with no memory; the streamlined thread then shows an empty chat.
6. **Inbox bulk select + bulk delete/archive** (local feature, 2026-09-30, committed on local master via branch `local/chat-clear-bulk-delete`; upstream PR may follow). Files: `server/src/routes/issues.ts` (`POST /companies/:companyId/issues/bulk-delete` — board-only, ≤100 ids per call, per-item `{issueId, ok, error}` results, same semantics as `DELETE /issues/:id`), `ui/src/pages/Inbox.tsx` (Mine tab: "Select" toolbar toggle, per-row checkboxes, sticky bulk bar with Select all / Deselect all / Archive / Delete… with confirm dialog), `ui/src/api/issues.ts` (`bulkDelete`), tests in `server/src/__tests__/agent-conversations.test.ts` and `ui/src/pages/Inbox.test.tsx`. Note: implemented in the Streamlined inbox only; `LegacyInbox.tsx` keeps single-item actions. Hard delete is irreversible (cascade removes comments/attachments; ledger rows detach) — the confirm dialog says so.

Rules for any future agent doing an update pull on this machine:

- Run `git status --short` **before and after** any `git pull` / fetch / merge. Never proceed blindly past a dirty tree.
- If pull refuses ("Your local changes would be overwritten by merge"), do **not** `stash`, checkout, or discard the files above to force it through. Stop and ask the operator whether to commit the local work to a local branch first, then merge.
- Items 5–6 are **committed** on local master (ahead of `origin/master`). A `git pull` will therefore merge rather than refuse; resolve conflicts in those files keeping the feature behavior intact. If an upstream PR for them merges, the local commits may be dropped in favor of the upstream version (operator decision) — re-run the agent-conversations + Inbox/IssueDetail UI tests after doing so.
- If upstream ships an official fix for #14078, verify the shipped wizard still defaults OpenCode agents to harness sign-in with no forced OpenRouter binding; only then may the local patch be dropped (operator decision).
- After any successful update: rebuild (`pnpm install && pnpm build`) and restart the instance so the served UI matches the tree, then re-verify the wizard behavior above with a quick manual check or the `ui/src/components/ai-connections` tests.
