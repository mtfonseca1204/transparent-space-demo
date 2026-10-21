# transparent-space Documentation Policy

Last verified: `2026-04-01`

## Policy

AI-driven work in this repository must leave documentation at least as current as the code and infrastructure assumptions it changes.

## Mandatory Update Triggers

Update docs in the same task when a change introduces or modifies any of the following:

- a feature or user-visible behavior
- an API route, cron, alert, background task, or dashboard
- an env var, secret location, external dependency, or data source
- a deploy target, runtime path, owner, account, or operational command
- a cross-repo integration with Solana, Worldchain, Envio, Supabase, CoinGecko, Telegram, or email flows
- a new subproject or major internal module another agent would need to understand

## Minimum Required Doc Updates

- Shared architecture or infra impact
  - update `docs/ai/global-context.md`
- Repo-specific behavior or integration impact
  - update `docs/ai/project-context.md`
- Agent workflow or read-order impact
  - update `AGENTS.md`
- Sensitive ops impact
  - update `/Users/bruno/Documents/GitHub/_transparent-space-private/*` if that folder exists on the current machine

## Definition Of Done

- Code and docs are updated together when documentation is impacted.
- If no documentation update is needed, the final handoff must say `No documentation impact`.
- Stale docs are considered defects and should be fixed before calling the task complete.

## Operating Rules For AI Agents

- Read `AGENTS.md` before making changes.
- Prefer verified live platform state over memory.
- Do not write raw secret values into repo docs.
- Preserve verification dates and labels such as `verified live`, `verified from code`, and `user-reported`.

## Quick Decision Matrix

- Changed frontend runtime behavior or integration
  - update `project-context.md`
- Changed shared topology, ownership, hosting, or service inventory
  - update `global-context.md`
- Changed both
  - update both files in the same task
- Unsure
  - update the docs rather than leaving ambiguity behind
