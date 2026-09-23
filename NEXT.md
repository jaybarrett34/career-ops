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
  tailored CV. Findings are item 1 below and the `word:Lead` entry now in portals.yml.
- `pretriage.mjs` — 2,856 unreadable pipeline rows down to 200, deterministic and free.
- Stripped the quarantined word from six archetypes; removed vote mechanics from the two
  Outlier bullets while keeping the senior-reviewer authority.
- Fixed `audit-portals.mjs` resolving `providers/` against the data root, which made every
  board on a separate-root profile report `no-provider`.
- Built Marilyn a `portals.yml` from her own trawl data: 14 of 16 boards live, first scan
  returns 106 matches. Her search is unblocked.
- `lib/eligibility.mjs` — the graduation-window gate. Only a CONFIRMED mismatch rejects; a
  posting naming no window passes as unknown. Degree fields are deliberately loose, so the
  AI-for-Business MS claims CS, MIS, information systems, data science and "related field".
  Tested against the real postings that fooled us: CIBC, Medline, The Hartford, Northern
  Trust, Motorola, BCG.
- `target-list.mjs` — ranks the pipeline against ALL eight resumes and says which to send.
  `--check-eligibility` reads each JD and drops confirmed mismatches.

## Left to do, roughly in order

1. **Scan cadence.** The discovered ledger only means anything across runs; every count in it
   is still from a single run. `node scan-simplify.mjs --since 7` every three days is
   zero-token. Not installed — say the word and it becomes a launchd job.

3. **Export your LinkedIn connections** (yours, one click: Settings -> Data privacy -> Get a
   copy of your data -> Connections). Drop `Connections.csv` in `data/` and `linkedin-join.mjs`
   answers "who do I already know at a company in my funnel" offline, for free. It is built and
   waiting on that file.

4. **Web UI for the bullet library.** Pick a listing from the pipeline, rank bullets against
   its keywords (`scoreAgainstKeywords` already exists), toggle them, compile. `compose-resume.mjs`
   already owns the `.tex` write, so the UI drives it rather than editing files. Low priority —
   the CLI already does this.

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

## Parked — worth doing, not now

- **The test-engineering angle.** 150 of the 231 lines in PR #4064 were tests, which is a
  differentiated fit for QA/test-engineering roles Jay is not currently targeting. 24 such
  Summer 2027 postings exist; 4 are in his metro — three at Shure (Niles/Skokie, same iCIMS
  tenant he is already opening an account on) and Motorola Test Engineer Intern (Illinois).
  Jay 2026-09-17: "might be worth utilizing eventually." Not a build — it needs a decision
  about whether he wants to be read as a test-engineering candidate, and probably a variant
  of the swe archetype that leads with the testing work rather than the schema migration.

## Open questions for Jay

Nothing blocking. The graduation-window gate (item 1 above) is the next build whenever
you want it.

## Known failure, not ours

`update-system.mjs check crashed (exit null, signal SIGTERM)` in `test-all.mjs` — it fetches
the upstream version and times out. Offline it will always fail. The live-archive Playwright
test fails the same way for the same reason.

## Commands

```
./scripts/career-ops-dev.sh          # restart the web UI and open it
./scripts/career-ops-dev.sh --clean  # same, but clear .next first (stale CSS)
open ~/Applications/"Career Ops.app" # same thing, dockable

node scan-simplify.mjs --list summer2027 --since 90 --dry-run   # trawl, writes nothing
node scan-simplify.mjs --promote                                # promoted: true -> portals.yml
node audit-portals.mjs                                          # does each careers_url resolve
cd web && npm run dev                                           # the UI
```
