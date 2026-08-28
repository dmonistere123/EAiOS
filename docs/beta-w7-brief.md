# W7 Brief — Skills & playbooks authoring (D-B3)

**Written:** 2026-08-28, before build (working rule 1). **Plan:** beta-readiness-plan.md
W7. **Context:** playbooks live in `~/eaios/playbooks/*.md` (canonical
frontmatter schema, gotcha #12), skills in `~/.hermes/skills/<category>/<slug>/SKILL.md`;
discovery rides vite middleware (`/api/playbooks-index`, `/api/skills-index`).

## Scope (from the plan, narrowed honestly)

- **Playbooks: create + edit** drawer → writes md via extended
  `/api/playbooks-index` (PUT, slug confinement). **Version bump on edit**;
  editing a *published* playbook lands as a new **draft** (page contract:
  "published versions are immutable — edits create a new draft"). Closes
  the edit/new-version part of F1; Duplicate/Archive stay deferred.
- **Skills: create drawer** → writes `SKILL.md` via a NEW middleware
  (`/api/skill-create`, slug + category validation, path confinement —
  never arbitrary paths, refuse overwrite). New skill appears via the
  existing `skills.manage` list. **Skill EDITING is out of W7 scope** (plan
  scopes skills to create) — registered in ROADMAP.

## Design

- **`app/server/authoring.ts` (new, pure node):** slugify, frontmatter
  build/parse, semver patch bump, confined `writePlaybook(root, input)` and
  `writeSkill(root, input)` (resolve + prefix check; tmp+rename atomic
  write). Shared by vite.config middleware AND vitest — write logic is
  unit-tested directly, not through HTTP.
- **Middleware:** `/api/playbooks-index` gains PUT (JSON body → confined
  write → cache bust → returns the saved playbook); `/api/skill-create`
  POST (409 on existing). Both bust their 30s index caches on write.
- **Adapter:** `savePlaybook(input)` (live PUT / mock in-memory, version
  bump server-side/mock-side — client never picks the version),
  `createSkill({name, category, description, body})`. Live adapter busts
  its own 30s `playbooksCache` after a save.
- **Page (Skills.tsx):** "New playbook" + per-card "Edit" drawers (slug
  preview like Add Agent; note that published edits land as drafts);
  "New skill" drawer (category select from existing + free-form validated,
  description ≤60 hint per authoring hardline, body with section guide).
- **New-skill frontmatter** follows the authoring standards: name,
  description (≤60), version 0.1.0, `author: EAiOS executive, Hermes Agent`
  (human first, no machine-specific name — multi-CEO packaging), license
  MIT, platforms, metadata.hermes.tags.

## Acceptance checklist

- [ ] Playbook create via drawer → file on disk, card appears; edit → patch
  version bumped server-side; edit of published → new draft version.
- [ ] Slug confinement: `../evil`, absolute paths, bad slugs rejected
  (unit-tested at the store layer).
- [ ] Skill create → `~/.hermes/skills/<cat>/<slug>/SKILL.md`; overwrite
  refused; appears via `skills.manage` (verified live).
- [ ] Mock parity for both adapter writes.
- [ ] vitest + sidecar green, build clean.
- [ ] Live verification with cleanup (test playbook + test skill removed
  after); HANDOFF + ROADMAP updated same-commit.

## Honest gaps

- Skills-index cache is 30s — a brand-new skill's description/version
  enrich within half a minute (name/category appear immediately via RPC).
- No skill editing/deleting in-app (ROADMAP), no playbook
  duplicate/archive (rest of F1).
- Playbook body editing is raw markdown — no structured step editor
  (deliberate; F1's detail view is a separate item).
