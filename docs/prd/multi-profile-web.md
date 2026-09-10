# PRD: Layered Multi-Profile Web UI

**Status:** APPROVED 2026-09-10 · Phase 1 COMPLETE
**Branch:** `feat/multi-profile-web`
**Author:** Claude (Opus 5) with Fable as advisor
**Date:** 2026-09-10

---

## Overview

**What:** Add two orthogonal selectors to the career-ops web app — a **root switcher** (which
person's data) and an **archetype overlay** (which CV/targeting flavor within that person) —
plus selectable model routing for pipeline runs, targeted motion components, and a documented
Claude-in-Chrome experiment slot.

**Why:** The app assumes exactly one candidate with exactly one CV and one targeting profile.
Jay maintains **8 archetypes** (`swe`, `ai_engineer`, `data_engineer`, `solutions_architect`,
`pm_tech_lead`, `tech_consultant`, `research_ga`, `housing_ga`) with different `.tex` files,
keyword weights, and bullet emphasis — and a second person's search (`get-mom-hired`) exists in
a separate repo with no way to reach it. Today, switching either means editing files by hand.

**Scope:** Large. Staged so each phase ships and is verifiable on its own.

---

## The two layers (orthogonal by construction)

```
Layer 1 — ROOT       [ Jay ▾ ]          → careerOpsRoot() → ALL user-layer files
Layer 2 — ARCHETYPE  [ ai_engineer ▾ ]  → overlay        → targeting + CV only
```

| | Root switch changes | Archetype switch changes |
|---|---|---|
| `cv.md`, `config/profile.yml`, `modes/_profile.md` | ✅ | ❌ |
| `data/applications.md` (tracker) | ✅ separate | ❌ shared |
| `data/scan-history.tsv` | ✅ separate | ❌ shared |
| `reports/` | ✅ separate | ❌ shared |
| `portals.yml` targeting | ✅ separate | ⚠️ overlay only (see FR6) |
| which `.tex` compiles | ✅ | ✅ |
| scoring keyword weights | ✅ | ✅ |

**Invariant the design must not break** (from `api/profile/route.ts`):
> *"The web orchestrates the real file — no parallel store."*

Switching a profile changes **which user-layer files are read**. It never creates a web-side
database, cache, or mirror of user data.

---

## Requirements

### Functional — Layer 1: Root switcher

- [x] **FR1** `web/`'s `careerOpsRoot()` honors the core's full resolution order: `CAREER_OPS_ROOT`
      → `CAREER_OPS_DATA_DIR` → `.career-ops-data` marker file → repo default. **It currently
      honors only the first**, diverging from `path-resolver.mjs`. This is a standalone bug fix
      and ships first, independently.
- [x] **FR1a** ⚠️ **Resolution base — the subtle half of FR1.** `path-resolver.mjs` resolves the
      marker and env values relative to `__dirname` (**the core checkout**). `web/`'s current
      resolver uses `process.cwd()` (**`web/`**) then `..`. A relative value like `../shared-data`
      therefore resolves to *two different directories* under the two implementations — same
      string, different base, silently different data root.
      **Required:** resolve relative to the **core root**, identically to `path-resolver.mjs`.
      **Preferred implementation:** import `getCareerOpsRoot` from the core rather than
      re-implementing it — it is the same repository, and two implementations of one rule is how
      this diverged in the first place. **Spike first:** confirm the import survives Next's
      bundler; `career-ops.ts`'s `rootScript()` carries a `turbopackIgnore` comment precisely
      because Turbopack statically traces core paths as module imports. If the import cannot cross
      that boundary cleanly, port the function verbatim with a comment naming `path-resolver.mjs`
      as the source of truth and a test asserting the two agree.
- [ ] **FR2** A registry of known roots lives at `config/roots.yml` (gitignored, user layer):
      `{id, label, path, enabled}`. Absent file → single implicit root = today's behavior.
      **The registry is hand-edited only. The web app never writes a path into it** — not now, and
      no "Add root" form later. FR3 closes the read side of the traversal primitive; this closes
      the write side. Adding a root is a deliberate act of editing a file on disk.
- [ ] **FR3** The active root is **server-side session state**, not a client value. A client that
      can name an arbitrary path is a directory-traversal read primitive against the user's disk.
- [ ] **FR4** Every root in the registry is validated on selection: path exists, is a directory,
      and contains at least one of `cv.md` / `config/profile.yml`. Invalid → refuse with a clear
      message, keep the previous root.

### Functional — Layer 2: Archetype overlay

- [ ] **FR5** Archetypes are read from the user layer, never hardcoded in `web/`. Source of truth
      is `config/archetypes.yml` (gitignored): `{id, label, tex, keywords[], model?, score?}`.
      Absent → the switcher hides itself entirely and behavior is exactly today's.
- [ ] **FR6** Selecting an archetype overlays **targeting and CV only**: which `.tex` compiles,
      which keywords weight scoring, which CV a report links. It never rewrites `portals.yml`,
      the tracker, or `modes/_profile.md`.
- [ ] **FR7** The active archetype is recorded on every artifact it produces, in **machine-findable
      form**, so a later reader can tell which flavor generated it:
      - **Tracker:** a *tagged* segment in the Notes column — `archetype=ai_engineer` — matching the
        existing `via=Agency` convention (`merge-tracker.mjs`). Never prose; a parser must be able
        to find it. Written through `set-status.mjs` / the TSV path, never by hand-editing the table.
      - **Reports:** a named key inside the existing `## Machine Summary` YAML block, not loose
        front-matter.

### Functional — Model routing (Fable)

- [ ] **FR8** `claudeCliArgs()` gains an optional `--model` passthrough. Fable is **not** a new
      `KNOWN` CLI entry — it rides the existing, audited Claude permission path, so
      `clis-permissions.test.mjs`'s guarantee is unchanged.
- [ ] **FR9** **No model name is hardcoded in `web/`.** `modes/_shared.md` states the tier→model
      table is *"the only place model/provider names appear."* Web reads a model **string** from
      user-layer config and passes it through opaquely.
- [ ] **FR10** Model is selectable per run and defaults to unset (current behavior). Fable is
      opt-in for **building** pipelines (authoring, refactoring, judgment) — **not** the default
      for **running** them over hundreds of scan hits.

### Functional — UI

- [ ] **FR11** 3–5 `reactbits.dev` components, each where **motion carries information**, not
      decoration. Candidates: `AnimatedList` (pipeline inbox arrival/removal), `SpotlightCard`
      (job cards), `CountUp` (stat tiles), `GradientText` (active-profile indicator).
- [ ] **FR12** Any new animation respects `prefers-reduced-motion`.
- [ ] **FR13** The active root + archetype are visible on **every** page, not just a settings
      screen. Acting on the wrong person's data is the failure mode this prevents.

### Functional — Chat router with tabs (Phase 7)

**What already exists — this is an extension, not a build.** `assistant-console.tsx` (692 lines)
plus `/api/assistant/route.ts` already route typed messages to the user's chosen CLI via
`spawnHeadlessCli`, parse `<<act:ID {json}>>` envelopes into real actions (navigate, evaluate,
generatePdf, setStatus, apply, remember, setProfile), render inline worker cards, and gate writes
behind confirm cards. **Message routing to Claude Code is solved.** What is missing is session
management and surface.

- [ ] **FR16** **Multiple concurrent conversations as tabs.** Today a single `localStorage` key
      (`career-ops:chat`) holds one transcript; a new topic destroys the old one. Tabs give each
      conversation its own transcript, its own in-flight workers, and its own scroll position.
- [ ] **FR17** ⭐ **Each chat tab binds to a profile (root + archetype).** This is where Phase 7
      and Phases 2–3 reinforce each other rather than merely coexisting: a tab labeled
      *Jay · ai_engineer* and a tab labeled *Mom · operations* each act on their own data root.
      The bound profile is shown in the tab, and **the tab's messages execute against that
      profile**, so a message typed in one tab can never touch the other's tracker.
- [ ] **FR18** **Detached / popup surface**, claude.ai-shaped: the console can pop out to a wide
      reading layout for long conversations, and dock back to the corner for quick actions.
      State survives the transition — no reload, no lost transcript.
- [ ] **FR19** **Transcripts persist to disk**, not just `localStorage`:
      `.career-ops-web/chats/{id}.json` (gitignored, already the runs directory's home). Survives
      cleared browser data, and is readable by the CLI itself — which matters, because the agent
      is asked to read `.career-ops-web/runs/{id}.md` today and this is the same pattern.
- [ ] **FR20** **The confirm-gate is per-tab and non-negotiable.** Every write action
      (`setProfile`, `setStatus`, `generatePdf`, `apply`) keeps its existing confirm card in every
      tab. Tabs multiply conversations, never permissions. A background tab may **never** complete
      a write the user is not looking at.
- [ ] **FR21** **Model selection is per-tab** and composes with FR8–FR10: a *build the pipeline*
      tab can run Fable while a *triage 500 hits* tab runs the cheap tier, concurrently.

### Functional — Claude-in-Chrome experiment slot

- [ ] **FR14** A documented, **disabled-by-default** slot for a Chrome-driven LinkedIn reader,
      with the hypothesis stated plainly: the extension reuses the user's authenticated session
      where headless Playwright gets walled.
- [ ] **FR15** Ships as documentation + a stub interface, **not** a working scraper. See
      "Open Questions" for the ToS position.

### Non-Functional

- [ ] **NFR1** **Data contract.** All new state in gitignored user-layer paths
      (`config/roots.yml`, `config/archetypes.yml`, `config/.active-profile.json`). Nothing user-
      specific enters the system layer.
- [ ] **NFR2** **Upstream shape.** `origin` is `career-ops-hq/career-ops` with no fork, and `web/`
      is tracked (251 files) but **not** in `SYSTEM_PATHS` — so `update-system.mjs apply` will not
      clobber it, but `git pull` will conflict. All work stays on `feat/multi-profile-web`.
- [ ] **NFR3** **Test baseline: 486 pass / 2 fail** on web **0.10.0** (`apply-cv-resolver`,
      `explore-ai-dedup`, both failing before any change). Ship must not exceed those 2. New logic
      gets tests in `web/tests/lib/`.
      *(Re-baselined after the 1.32.0 update: the first measurement, 452/2, was taken on web 0.9.0
      before the fork brought web/ up to 0.10.0 — `update-system.mjs` cannot advance `web/`
      because it is absent from `SYSTEM_PATHS`.)*
- [ ] **NFR4** **Zero-cost default.** Profile switching adds no model calls. Jay shares usage
      limits with a TopstepX trading instance; scanning and switching stay zero-token.
- [ ] **NFR5** **Backward compatible.** With no `roots.yml` and no `archetypes.yml`, the app
      behaves exactly as it does today. Both switchers hide themselves.

---

## User Stories

- As **Jay**, I want to switch to `ai_engineer` and have Generate PDF compile `ai_engineer.tex`,
  so I stop hand-picking the right file per application.
- As **Jay**, I want to switch to a second person's root and see only their tracker, so I never
  apply to a job under the wrong identity.
- As **Jay**, I want Fable available for *authoring* a pipeline but not for *running* it over 500
  scan hits, so a judgment task gets a strong model and a bulk task doesn't burn shared limits.
- As **Jay**, I want the active person and archetype visible on every screen, so I can't act on
  the wrong data by accident.

---

## Technical Approach

### Files to create

| File | Purpose |
|------|---------|
| `config/roots.yml` | Root registry (gitignored, user layer) |
| `config/archetypes.yml` | Archetype registry (gitignored, user layer) |
| `web/src/lib/core/roots.ts` | Registry read + validation |
| `web/src/lib/core/archetypes.ts` | Overlay read + resolution |
| `web/src/lib/core/active-profile.ts` | Server-side active-selection state |
| `web/src/app/api/profiles/route.ts` | List / select root + archetype |
| `web/src/components/profile-switcher.tsx` | The two-layer selector |
| `web/tests/lib/roots.test.mjs` | FR2–FR4, traversal refusal |
| `web/tests/lib/archetypes.test.mjs` | FR5–FR7, absent-file fallback |
| `docs/CHROME_LINKEDIN_EXPERIMENT.md` | FR14–FR15 |
| `web/src/lib/core/chat-sessions.ts` | Tab store + disk persistence (FR16, FR19) |
| `web/src/app/api/chats/route.ts` | List / create / delete transcripts |
| `web/src/components/chat-tabs.tsx` | Tab strip + detach control (FR16, FR18) |
| `web/tests/lib/chat-sessions.test.mjs` | FR16–FR21, incl. per-tab confirm isolation |

### Files to modify

| File | Change |
|------|--------|
| `web/src/lib/career-ops.ts` | `careerOpsRoot()` → full resolution order + active root (FR1) |
| `web/src/lib/claude-invocation.mjs` | Optional `--model` passthrough (FR8) |
| `web/src/components/app-shell.tsx` | Mount the switcher (FR13) |
| `web/src/lib/apply/cv-selection.mjs` | Archetype-aware `.tex` selection (FR6) |
| `web/package.json` | reactbits deps (FR11) |
| `web/src/components/assistant-console.tsx` | Single-transcript → tab-scoped store (FR16–FR21) |
| `web/src/app/api/assistant/route.ts` | Accept tab id + per-tab profile/model (FR17, FR21) |

### Architecture

```
Request → active-profile.ts (server session)
            ├── root id      → roots.ts      → validated absolute path
            │                                       ↓
            │                                 careerOpsRoot()
            │                                       ↓
            │                    ALL user-layer reads (cv, tracker, reports, portals)
            │
            └── archetype id → archetypes.ts → overlay { tex, keywords, model? }
                                                    ↓
                                    cv-selection.mjs   scoring    claudeCliArgs(--model)
```

### Dependencies

reactbits.dev components are **copy-in source**, not an npm package — but most pull GSAP or
Framer Motion. Framer Motion (`motion`) is ~50KB gzipped. **Decision required** (Open Question 3):
adopt one animation dependency, or hand-port the 3–5 components to CSS transitions and add zero
dependencies. The app already ships `@paper-design/shaders-react` and `hero-glow.tsx`, so it is
not visually bare today.

---

## Edge Cases & Error Handling

| Scenario | Expected behavior |
|---|---|
| `roots.yml` absent | Single implicit root; switcher hidden; today's behavior exactly |
| `roots.yml` malformed YAML | Refuse to switch, keep current root, surface the parse error. **Never** overwrite it — matches the existing data-loss guard in `api/profile/route.ts` |
| Root path missing or deleted | Mark disabled in the list with the reason; refuse selection |
| Root path outside allowed set | Refuse. Client sends an **id**, never a path (FR3) |
| Archetype references a missing `.tex` | Fall back to default CV, warn once, do not fail the run |
| Archetype switched mid-run | Run finishes under the archetype it started with; the switch applies to the next run |
| Two browser tabs, different roots | Server-side state is global per server — last write wins. **Documented, not solved** (see OQ4) |
| Model string names a nonexistent model | The CLI's own error surfaces verbatim; web does not validate model names (FR9) |
| `prefers-reduced-motion` set | Animations become instant state changes (FR12) |
| Chat tab open when its bound root is removed from `roots.yml` | Tab goes read-only with a banner; transcript preserved; no further sends |
| Two tabs run workers at once | Allowed and expected — each worker carries its own tab's profile; results never cross |
| A write action confirmed in a background tab | Confirm cards are per-tab and require that tab focused; a background tab cannot silently write (FR20) |
| `.career-ops-web/chats/` unwritable | Fall back to `localStorage`, warn once, never lose the live transcript |
| Existing single `career-ops:chat` transcript on upgrade | Migrated into tab 1 on first load; never discarded |

---

## Acceptance Criteria

- [ ] **AC1** With no `roots.yml`/`archetypes.yml`, the app is byte-identical in behavior. Both switchers hidden.
- [x] **AC2** `careerOpsRoot()` resolves `CAREER_OPS_ROOT` → `CAREER_OPS_DATA_DIR` → `.career-ops-data` → `..`, matching `path-resolver.mjs`, with a test per branch.
- [ ] **AC3** Selecting a root changes tracker, reports, and CV together; no row from root A appears under root B.
- [ ] **AC4** Selecting an archetype changes which `.tex` compiles on Generate PDF; the tracker is unchanged.
- [ ] **AC5** A crafted request naming a filesystem path instead of a registry id is refused.
- [ ] **AC6** `grep -rE "claude-(fable|opus|sonnet|haiku)" web/src/` returns **zero** hits (FR9).
- [ ] **AC7** Test suite ≤ 2 failures, and both are the known baseline pair.
- [ ] **AC8** Active root + archetype visible on every page.
- [ ] **AC9** Chrome/LinkedIn slot is documented and inert — no scraping code ships enabled.
- [ ] **AC10** Two chat tabs bound to different roots run workers concurrently; each writes only to its own root's tracker, verified by assertion, not by eye.
- [ ] **AC11** A write action in an unfocused tab does not complete without that tab's confirm (FR20).
- [ ] **AC12** An existing `career-ops:chat` transcript survives upgrade as tab 1.
- [ ] **AC13** Popping the console out and docking it back loses neither transcript nor in-flight worker state.

---

## Out of Scope

- Migrating the second person's data into this repo (it stays its own root)
- Per-archetype **trackers** — one tracker per root, deliberately
- Rewriting `portals.yml` per archetype (overlay only, FR6)
- Any change to scoring **weights** themselves (Blocks A–F stay as-is)
- Auth / multi-user serving — this is a local-first, single-operator app
- Applying the pending **1.32.0** core update (see below)
- A working LinkedIn scraper (FR15)
- Rebuilding the chat **routing** — it already works; Phase 7 adds sessions and surface only
- Cloud-synced or cross-device chat history (local-first, by design)

---

## Decisions taken (were open, now closed)

**D1 — LinkedIn: documented + inert, no scraper.** Automated collection from LinkedIn violates
their User Agreement and they litigate it actively. `linkedin-join.mjs` already handles the
**official export CSV**, which is permitted, needs no automation, and works today. The Chrome slot
ships as a written experiment record — the hypothesis, what to try, what to watch — with no
enabled scraping code. This is not a request for permission; it is the scope.

**D2 — Multi-tab: cookie-scoped, not last-write-wins.** Active root + archetype scope to a cookie
so two tabs can hold different profiles independently. Server-side global state means opening a
second tab silently repoints the first — which is precisely the data-mixing failure FR13 exists to
prevent, and "acting as the wrong person" is the most expensive mistake this feature can make.
Costs roughly a day over the naive version. Worth it.

## Open Questions

*(OQ1 and OQ4 were open in the first draft and are now decided — see "Decisions taken" below.)*

- [ ] **OQ2 — Fable default.** Confirm: Fable selectable for *building* pipelines, never the
      default for bulk *running*. Your limits are shared with the trading instance.
- [ ] **OQ3 — Animation dependency.** Adopt Framer Motion (~50KB, unlocks most reactbits
      components as written), or hand-port to CSS and add nothing?
- [ ] **OQ5 — Core update.** `update-system.mjs` reports **1.31.0 → 1.32.0** available
      (`system-files-changed`). Recommend applying **before** this work, not during — it rewrites
      system files by raw checkout, not merge. Apply now, or after?

---

## Staging

| Phase | Content | Independently shippable |
|---|---|---|
| **1** | FR1 root-resolution bug fix + tests | ✅ Yes — genuinely upstream-shaped, fixes real divergence |
| **2** | FR2–FR4 root registry + switcher | ✅ Yes |
| **3** | FR5–FR7 archetype overlay | ✅ Yes |
| **4** | FR8–FR10 model routing | ✅ Yes |
| **5** | FR11–FR13 UI components | ✅ Yes |
| **6** | FR14–FR15 Chrome slot (docs) | ✅ Yes |
| **7** | FR16–FR21 chat tabs + detached surface + per-tab profile/model | ✅ Yes — but lands *after* Phases 2–3, since FR17 binds tabs to profiles |

Phase 1 is worth doing regardless of whether the rest is approved.

**Phase 1 should also go upstream as its own PR.** It fixes a genuine divergence between
`web/careerOpsRoot()` and the core's `path-resolver.mjs` — a bug for any user with a
`.career-ops-data` marker, not something specific to this feature. `origin` *is*
`career-ops-hq/career-ops`, so upstreaming it is the one piece that need not live on a local
branch forever, and every accepted upstream line is one less line that conflicts on the next
`git pull`. Everything else here is Jay-specific and stays on `feat/multi-profile-web`.
