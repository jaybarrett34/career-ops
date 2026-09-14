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

## Left to do, roughly in order

1. **Web surface for `discovered`.** The ledger is the backend half. The ask was
   "emit them as new component boxes and retain them in general for future ... lock these
   more explicitly per profile." Nothing renders it yet. Needs a route reading
   `config/discovered.yml` under the active root, boxes per company with the count and hosts,
   and a per-profile lock so a promotion on one profile does not leak to another.

2. **Web UI for the bullet library.** Pick a listing from the pipeline, rank bullets against
   its keywords (`scoreAgainstKeywords` already exists), toggle them, compile. `compose-resume.mjs`
   already owns the `.tex` write, so the UI drives it rather than editing files.

3. **Marilyn's root has no `portals.yml`.** Scans under her profile have nothing to filter
   with. The discovered ledger is meant to be how that root builds one, so this is partly
   unblocked by item 1 — but she still needs a starting `title_filter`/`location_filter`
   for revenue cycle / admin / training roles.

4. **Bullet audit items still open** (from the pass over all bullets):
   - Kyndryl's long Kafka bullet is still function-only on most archetypes. Master supplies
     the Z: Docker enforcing parity, eliminating config drift.
   - The energy-sector bullet is still on `solutions_architect` though master calls it the
     weakest.
   - Two Outlier bullets still carry vote mechanics, which the quarantine forbids.
   - The ROTC snack bar is still on tech archetypes.
   - Cornell tutor bullets have scale but no outcome clause.

5. **Yours, not mine:** the Simplify Outlier text and headline still need fixing, and
   PRs #4064/#4065 are waiting on upstream maintainers.

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
