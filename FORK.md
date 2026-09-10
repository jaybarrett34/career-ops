# Fork notes

**Upstream:** [`career-ops-hq/career-ops`](https://github.com/career-ops-hq/career-ops)
**This fork:** `jaybarrett34/career-ops`

Upstream is a general-purpose job-search system for one candidate. This fork adds the pieces
needed to run several candidates, and several CV flavors per candidate, from one install.

## Why a fork rather than local edits

`web/` is tracked upstream but is **absent from `SYSTEM_PATHS`**, so `update-system.mjs apply`
never touches it. That has one consequence worth knowing:

> **For the web UI, `git pull upstream main` is the real update path.**
> `update-system.mjs` structurally cannot advance `web/`. Running it alone leaves the core
> current and the web app frozen — this fork was created at a point where that gap had left
> `web/` several hundred lines behind, including part of `origin-guard.mjs`.

Keeping changes on a fork means upstream pulls stay clean and conflicts are confined to the
files listed below.

## Layout

| Remote | Points at | Use |
|---|---|---|
| `origin` | `jaybarrett34/career-ops` | push work here |
| `upstream` | `career-ops-hq/career-ops` | `git pull upstream main` |

## What this fork adds

Two orthogonal selectors, plus what falls out of them. Full spec:
[`docs/prd/multi-profile-web.md`](docs/prd/multi-profile-web.md).

```
Layer 1  ROOT       which person's data      -> all user-layer files
Layer 2  ARCHETYPE  which CV/targeting flavor -> targeting and CV only
```

| Phase | Adds | State |
|---|---|---|
| 1 | Data-root resolution matching the core's `path-resolver.mjs` | done, upstreamable |
| 2 | Root registry, traversal-safe selection | in progress |
| 3 | Archetype overlay | planned |
| 4 | Per-run model routing (opt-in, no model names in `web/`) | planned |
| 5 | Hand-ported motion components, no animation dependency | planned |
| 6 | Claude-in-Chrome experiment slot (documented, inert) | planned |
| 7 | Chat tabs bound to profiles, detachable surface | planned |

## Upstreamable vs local

Some of this is a fix for everyone; some is specific to running several people from one install.
Keeping them separate keeps the long-term conflict surface small.

**Upstreamable** — opened or open-able as PRs against upstream:

- `fix(web): resolve the data root exactly as the core does` — `web/careerOpsRoot()` honored only
  `CAREER_OPS_ROOT`, ignoring `CAREER_OPS_DATA_DIR` and the `.career-ops-data` marker the core
  honors, and resolved relative values against `web/` instead of the checkout. Any user with a
  marker file had the CLI and the web app reading different data roots.
- `fix: run the web suite on the minimum supported Node` — two suites aborted with
  `ERR_UNKNOWN_FILE_EXTENSION` on Node 22 because `--experimental-strip-types` was missing from
  both `web/package.json` and `test-all.mjs`. Eleven tests were not running and read as red
  lines rather than as skipped.

**Fork-local** — the multi-profile feature itself, and the two config templates.

## Files this fork touches

Kept deliberately small. Anything not listed here is untouched upstream code.

| File | Change |
|---|---|
| `README.md` | one quoted block at the top, nothing else |
| `FORK.md` | this file |
| `.gitignore` | ignore `config/roots.yml`, `config/archetypes.yml` |
| `update-system.mjs` | register the two templates in `SYSTEM_PATHS` |
| `test-all.mjs` | add `--experimental-strip-types` to the web-suite invocation |
| `config/*.example.yml` | two new templates |
| `web/src/lib/career-ops.ts` | data-root resolution |
| `web/src/lib/core/data-root.mjs` | new |
| `web/src/lib/core/roots.mjs` | new |
| `web/tests/lib/` | two new suites |
| `docs/prd/` | the spec |

## No personal data lives here

Profiles, CVs, trackers and reports are gitignored. Each person's data belongs in **its own
private repository**, which this checkout points at via `.career-ops-data` or
`CAREER_OPS_DATA_DIR`:

```
~/Projects/career-ops/          this fork - code only
~/Projects/my-career-data/      PRIVATE repo - cv.md, data/, reports/
~/Projects/family-career-data/  PRIVATE repo - a second person's search
```

Each data repo has full independent git history and never touches this remote. See
[`config/roots.example.yml`](config/roots.example.yml).

`config/roots.yml` is gitignored specifically because it maps real people to absolute paths and
its labels are usually real names. The registry is also **hand-edited on purpose**: the app never
writes a path into it, which is what prevents a request from naming a directory outside the
registry.
