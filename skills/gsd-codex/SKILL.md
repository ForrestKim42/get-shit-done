---
name: gsd-codex
description: Adapt the official Get Shit Done (GSD) workflow for Codex sessions. Use when the user asks to run GSD-style project planning/execution flows (for example /gsd:new-project, /gsd:plan-phase, /gsd:execute-phase, /gsd:verify-work, debugging, roadmap updates), and Codex needs the corresponding command, workflow, agent, or template references.
---

# GSD for Codex

Use this skill as a compatibility layer for the official GSD methodology.

## Operating Rules

1. Load only the specific reference files required for the current command.
2. Treat `references/commands/*.md` as user-facing entry points and `references/workflows/*.md` as execution details.
3. Use `references/agents/*.md` only when the command requires delegation behavior.
4. Preserve safety constraints from the current environment; do not assume permission-skipping flags are allowed.
5. Keep outputs aligned to the active repository conventions and existing planning files.

## Navigation

- Command docs: `references/commands/`
- Workflow docs: `references/workflows/`
- Agent roles: `references/agents/`
- Core references: `references/references/`
- Templates: `references/templates/`
- Generated index: `references/INDEX.md`

## Common Adaptations for Codex

1. If an upstream flow expects runtime-specific slash command behavior, execute the equivalent steps directly in this session.
2. If an upstream flow expects a tool not available here, apply the nearest supported equivalent and record the substitution in the output.
3. Keep plans concrete and verifiable; include explicit file paths and checks.

