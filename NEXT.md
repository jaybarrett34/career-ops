# Where this left off

Branch `feat/multi-profile-web`, paused 2026-09-14. Everything below is uncommitted-free:
the tree is clean and the suite is green except one environmental failure (see bottom).

## Done since the last checkpoint

- `lib/discovered.mjs` + `config/discovered.yml` — the dynamic-expansion ledger. Every scan
  folds its companies in with a running count, the hosts seen, and which scanner found them.
  Merges on normalized name, plus host when the host is the company's own; a shared ATS host
  (greenhouse, lever, a workday tenant) never merges.
- `scan-simplify.mjs --promote` — moves `promoted: true` entries into `portals.yml`
  `tracked_companies`. Idempotent. Verified end to end against a scratch root.
- `scan-simplify.mjs` now honors `data/blacklist.md`, not just `portals.yml`
  `blacklist_companies`. Verified live: a one-row blacklist filtered 26 Marvell postings,
  `--include-blacklisted` let them through annotated.
- Suite fixes: main-module guards, nested-checkout walker guards, the scan receipt contract,
  four redundant `SYSTEM_PATHS` entries, per-source flag coverage in the argv contract.
- `profile-bundle.mjs` — export a data root as a standalone directory to git init and push,
  import a cloned one and register it. Round-tripped a real 91-file profile byte-for-byte.
- Ran the pipeline end to end on the real root: scan -> JD fetch -> two reports -> tracker ->
  tailored CV. Findings are item 2 below and the `word:Lead` entry now in portals.yml.

## Left to do, roughly in order

1. **Two decisions waiting on you** (see "Open questions" below).

2. **A graduation-window gate.** The highest-value filter left, and the finding
   from actually running the pipeline. Most Summer 2027 JDs state a required
   graduation window, it is a hard yes/no rather than a score, and nothing checks
   it. On one day's Chicago listings: Northern Trust wants Dec 2027 - Summer 2028
   (MS fits), Motorola wants "on or after December 2027" (fits), CIBC wants Dec
   2026 - Jun 2027 (BA six months early, MS six months late - a genuine SKIP that
   looked like a target until the JD was read). The window does not correlate
   with company, location or title. Needs a `graduation_window` block in
   portals.yml and a JD-text check, since it cannot be known from a listing row.

3. **Web UI for the bullet library.** Pick a listing from the pipeline, rank bullets against
   its keywords (`scoreAgainstKeywords` already exists), toggle them, compile. `compose-resume.mjs`
   already owns the `.tex` write, so the UI drives it rather than editing files.

4. **Marilyn's root has no `portals.yml`.** Scans under her profile have nothing to filter
   with. The discovered ledger is meant to be how that root builds one, so this is partly
   unblocked by item 1 — but she still needs a starting `title_filter`/`location_filter`
   for revenue cycle / admin / training roles.

5. **Bullet audit items still open** (from the pass over all bullets):
   - Kyndryl's long Kafka bullet is still function-only on most archetypes. Master supplies
     the Z: Docker enforcing parity, eliminating config drift.
   - The energy-sector bullet is still on `solutions_architect` though master calls it the
     weakest.
   - Two Outlier bullets still carry vote mechanics, which the quarantine forbids.
   - The ROTC snack bar is still on tech archetypes.
   - Cornell tutor bullets have scale but no outcome clause.

6. **Yours, not mine:** the Simplify Outlier text and headline still need fixing, and
   PRs #4064/#4065 are waiting on upstream maintainers.

## Open questions for Jay

1. **The word "process".** `QUARANTINE.md` marks it UNRESOLVED and says to strip it on the
   next rebuild unless cleared. "Modernized a legacy semiconductor data export onto a
   **process-based** JSON schema" is live on six archetypes (ai_engineer, data_engineer,
   research_ga, solutions_architect, swe, tech_consultant) through one shared bullet. One
   edit to `intel-corporation-modernized-legacy-semiconducto-6` fixes all six. Clear the word
   or name the replacement.

2. **The multi-sponsor scope bullet.** Added to the library as
   `intel-pm-sequenced-sponsor-projects` but deliberately NOT slotted into any resume:
   "Carried concurrent automation projects for four sponsoring teams inside one engineering
   org, sequencing delivery against a sponsor-maintained roadmap." You called the
   12-projects/6-areas frame "incredibly gray area between job function and career wins" for
   the tech archetypes. On a PM resume multi-stakeholder sequencing IS the job, which is why
   it is written and waiting rather than dropped. Say the word and it goes in.

## Known failure, not ours

`update-system.mjs check crashed (exit null, signal SIGTERM)` in `test-all.mjs` — it fetches
the upstream version and times out. Offline it will always fail. The live-archive Playwright
test fails the same way for the same reason.

## Commands

```
node scan-simplify.mjs --list summer2027 --since 90 --dry-run   # trawl, writes nothing
node scan-simplify.mjs --promote                                # promoted: true -> portals.yml
node audit-portals.mjs                                          # does each careers_url resolve
cd web && npm run dev                                           # the UI
```
