// Choosing which bullets to put on a resume for one specific listing.
//
// THE RULE THIS OBEYS
//
// AGENTS.md: "Keywords get reformulated, never fabricated." Everything here
// SELECTS among sentences the user already wrote and had verified. It never
// writes a bullet, never rephrases one to hit a keyword, and never proposes a
// claim the library cannot already support. A keyword nothing covers is
// reported as a gap and left alone — that is the user's to fill, with the
// confirmation flow `add`/`expand` provide, not the tool's to invent.

import { compileKeyword } from '../title-keywords.mjs';

/**
 * Terms the user's own material actually contains.
 *
 * This replaces running a generic skill extractor over the JD, which was the
 * first attempt and was not usable: a capitalized-token scanner returns
 * "December", "Lunch", "GPA", "Chicago" and "Presentation" from ordinary prose,
 * and then reports SQL as unclaimable while it sits in the skills line. Both
 * halves of that are wrong in the same way -- the question is not "what words
 * are in this posting" but "which of the things I can truthfully say does this
 * posting ask for". Only the second can be answered from the user's material,
 * and only the second is what a swap can act on.
 *
 * The skills line is included because it is on the page regardless of which
 * bullets are chosen, so a term there is covered no matter what.
 */
export function resumeVocabulary(library, skillsText = '') {
  const terms = new Set();
  const add = (t) => {
    const v = String(t ?? '').trim().replace(/[.,;:()]+$/, '');
    // Two characters is the floor so "C" and "R" do not match every sentence;
    // they are real languages but unmatchable without false positives.
    if (v.length >= 3) terms.add(v);
  };
  // The skills line is already a curated list of terms, comma-separated.
  for (const raw of String(skillsText).split(/[,\\\n]+/)) {
    add(raw.replace(/\\textbf\{[^}]*\}/g, '').replace(/[{}$\\]/g, '').replace(/^\s*[A-Za-z &]+:\s*/, '').trim());
  }
  // Proper nouns inside the bullets — tool and technology names the user wrote.
  // The FIRST word of a bullet or sentence is skipped: every bullet opens with a
  // capitalized verb ("Designed", "Shipped", "Built"), and taking those made
  // "Designed" and "Summer" read as skills the posting was asking for.
  for (const b of library) {
    for (const sentence of String(b.text ?? '').split(/(?:^|[.;:])\s*/)) {
      const rest = sentence.replace(/^\S+\s*/, ''); // drop the leading capitalized verb
      for (const m of rest.matchAll(/\b([A-Z][A-Za-z0-9.+#]*(?:\s+[A-Z][A-Za-z0-9.+#]*)*)\b/g)) add(m[1]);
    }
    for (const t of (b.tags ?? [])) add(t);
  }
  // Ordinary English that happens to be capitalized mid-sentence is not a skill.
  // These are the ones this library actually produced; the list is data, not a
  // theory of language, and grows only when a real term is wrongly admitted.
  const NOT_A_SKILL = new Set(['summer', 'applications', 'learning', 'coursework', 'designed',
    'senior', 'present', 'remote', 'university', 'college', 'analysis', 'business', 'english',
    'computer science', 'mathematics', 'engineering', 'technology', 'operations', 'management']);
  return [...terms].filter((t) => !NOT_A_SKILL.has(t.toLowerCase()));
}

/** The vocabulary terms this posting actually asks for. */
export function keywordsFromJd(vocabulary, jdText) {
  const seen = new Set();
  for (const t of vocabulary) if (covers(jdText, t)) seen.add(t);
  // Drop a term fully contained in a longer matched term ("Git" under "GitHub
  // Actions") so the count is not inflated by its own substrings.
  const out = [...seen];
  return out.filter((t) => !out.some((o) => o !== t && o.toLowerCase().includes(t.toLowerCase())));
}

/**
 * Match a keyword against text with word boundaries.
 *
 * Substring matching is wrong on exactly this data: `Java` appears inside
 * `JavaScript` and `Go` inside `Google`, and both of those longer words are on
 * the resume. A tailor that counts those as coverage reports a keyword as
 * satisfied when the resume never claims it.
 */
export function covers(text, keyword) {
  const k = String(keyword ?? '').trim();
  if (!k) return false;
  // Single alphanumeric words get boundary treatment; multi-word phrases and
  // anything with punctuation ("ci/cd", "test-driven development") are matched
  // as written, since a boundary rule would break them.
  const m = compileKeyword(/^[a-z0-9+#]+$/i.test(k) ? `word:${k.toLowerCase()}` : k.toLowerCase());
  return m(String(text ?? '').toLowerCase());
}

/** Every keyword in `keywords` that this bullet's text covers. */
export function bulletCoverage(bullet, keywords) {
  const text = `${bullet.text ?? ''} ${bullet.short ?? ''} ${(bullet.tags ?? []).join(' ')}`;
  return keywords.filter((k) => covers(text, k));
}

/** The set of keywords a chosen list of bullets covers between them. */
export function setCoverage(bullets, keywords) {
  const hit = new Set();
  for (const b of bullets) for (const k of bulletCoverage(b, keywords)) hit.add(k);
  return hit;
}

/**
 * Does this bullet say what the work PRODUCED, or only what it was?
 *
 * The counterweight to keyword coverage. Coverage and mention counts are both
 * ATS metrics; nothing in them notices when a swap trades "...so consumers
 * migrated without a break" for a denser line that merely lists technologies.
 * A page can gain keywords and lose the reason a human believes you did the job
 * -- and the human is who decides.
 *
 * Detected as a result connective or a figure, which is how Jay's own bullets
 * carry the "accomplishing Z" half of did-X-through-Y-accomplishing-Z.
 */
// Verb forms matter. The first version matched "cutting" but not "cut" and told
// a good bullet ("...to cut token spend on boilerplate prototyping") it had no
// outcome. A detector that misfires on real material is worse than none: it
// argues for edits that make the page weaker.
const OUTCOME = new RegExp([
  '\\bso (?:that )?\\w',
  '\\b(?:enabl|eliminat|reduc|surfac|unblock|resolv|clear|sav|accelerat|remov|prevent)(?:e|es|ed|ing)?\\b',
  '\\b(?:cut|cuts|cutting|fix|fixes|fixed|yield|yields|yielded|yielding|hit|hits|hitting)\\b',
  '\\bwithout\\b', '\\brather than\\b', '\\binstead of\\b',
  '\\bto a [\\w-]+ bar\\b', '\\bno downstream\\b',
  '\\d',
].join('|'), 'i');

export function hasOutcome(bullet) {
  return OUTCOME.test(`${bullet.text ?? ''} ${bullet.short ?? ''}`);
}

/** How many of these bullets say what the work produced. */
export function outcomeDensity(bullets) {
  const n = bullets.filter(hasOutcome).length;
  return { withOutcome: n, total: bullets.length };
}

/**
 * Bullets stating the same fact, so at most one of a group is ever chosen.
 *
 * BOTH spellings are read on purpose. config/bullets.yml writes `variant_of`;
 * validateLibrary normalizes it to `variantOf`. Reading only the YAML spelling
 * meant every validated bullet became its own group, and a tailor happily put
 * two phrasings of one Kyndryl pipeline on the same page.
 */
export function variantGroup(bullet) {
  return bullet.variantOf ?? bullet.variant_of ?? bullet.id;
}

/**
 * Choose `slots` bullets from `candidates` by greedy set cover.
 *
 * NOT top-N by per-bullet keyword count, which is what ranking gives you and
 * what it gets wrong: three bullets each matching "Python, CI/CD" score higher
 * individually than one matching "Kafka", so ranking fills the page with
 * synonyms of one strength and drops the only line covering another. Coverage
 * of the SET is the thing a reader and an ATS both actually see, so each pick
 * is made for what it adds to what is already chosen.
 *
 * `locked` bullets are kept regardless — they hold the slot they are in.
 */
export function chooseByCoverage(candidates, keywords, slots, { locked = [], incumbents = [] } = {}) {
  const chosen = [...locked];
  const used = new Set(chosen.map(variantGroup));
  const covered = setCoverage(chosen, keywords);
  // Whatever is on the resume today wins every tie. Without this the tailor
  // rewrites bullets that gain nothing -- it reported "before 5/8 -> after 5/8"
  // while swapping six lines, which is churn presented as optimization and
  // quietly discards phrasing the user may have chosen deliberately.
  const isIncumbent = new Set(incumbents.map((b) => b.id));
  // Incumbents are considered FIRST rather than compared against afterwards. A
  // tie-break inside the loop still lost when a challenger was reached first and
  // became `best` while nothing was there to compare it to, which is how one
  // Kyndryl phrasing kept replacing an identical-scoring sibling.
  const order = [...candidates].sort((a, b) => (isIncumbent.has(b.id) ? 1 : 0) - (isIncumbent.has(a.id) ? 1 : 0));

  while (chosen.length < slots) {
    let best = null, bestGain = 0;
    for (const b of order) {
      if (used.has(variantGroup(b))) continue;
      const gain = bulletCoverage(b, keywords).filter((k) => !covered.has(k)).length;
      if (gain > bestGain) { best = b; bestGain = gain; }
    }
    // No remaining bullet adds a keyword: keep the incumbents rather than
    // reshuffling for nothing.
    if (bestGain === 0) {
      for (const b of incumbents) {
        if (chosen.length >= slots) break;
        if (used.has(variantGroup(b))) continue;
        chosen.push(b); used.add(variantGroup(b));
      }
    }
    // Nothing left adds a keyword. Fill the remaining slots with the strongest
    // unused bullets rather than leaving the resume short: a slot spent on a
    // bullet that covers nothing new is still a bullet the reader wants.
    if (!best) {
      const rest = order
        .filter((b) => !used.has(variantGroup(b)))
        .sort((a, b) => bulletCoverage(b, keywords).length - bulletCoverage(a, keywords).length);
      for (const b of rest) {
        if (chosen.length >= slots) break;
        chosen.push(b); used.add(variantGroup(b));
      }
      break;
    }
    chosen.push(best);
    used.add(variantGroup(best));
    for (const k of bulletCoverage(best, keywords)) covered.add(k);
  }
  return chosen;
}

/**
 * Re-choose each org's bullets against one listing, keeping every org's slot
 * count exactly as the archetype has it.
 *
 * Per-org is not a detail: a Kyndryl bullet cannot fill an Intel slot, and the
 * .tex places bullets under the employer heading they belong to. Rebalancing
 * across orgs would silently move a line from one job to another.
 */
export function tailorResume(library, currentIds, keywords) {
  const byId = new Map(library.map((b) => [b.id, b]));
  const current = currentIds.map((id) => byId.get(id)).filter(Boolean);

  const orgOrder = [];
  const slotsByOrg = new Map();
  for (const b of current) {
    if (!slotsByOrg.has(b.org)) { slotsByOrg.set(b.org, 0); orgOrder.push(b.org); }
    slotsByOrg.set(b.org, slotsByOrg.get(b.org) + 1);
  }

  const out = [];
  const perOrg = [];
  for (const org of orgOrder) {
    const slots = slotsByOrg.get(org);
    const pool = library.filter((b) => b.org === org);
    const was = current.filter((b) => b.org === org);
    const now = chooseByCoverage(pool, keywords, slots, { incumbents: was });
    out.push(...now);
    perOrg.push({
      org,
      slots,
      before: was.map((b) => b.id),
      after: now.map((b) => b.id),
      coveredBefore: [...setCoverage(was, keywords)],
      coveredAfter: [...setCoverage(now, keywords)],
    });
  }

  const before = setCoverage(current, keywords);
  const after = setCoverage(out, keywords);
  // Unique coverage and total mentions answer different questions and this tool
  // needs both. Unique is what a human reader sees: does the resume speak to
  // this requirement at all. Mentions is closer to what keyword-weighted ATS
  // scoring sees, and it is the one a swap usually moves -- a term appearing
  // under three employers instead of one reads as depth rather than a one-off.
  const mentions = (bs) => bs.reduce((n, b) => n + bulletCoverage(b, keywords).length, 0);
  return {
    ids: out.map((b) => b.id),
    perOrg,
    mentionsBefore: mentions(current),
    mentionsAfter: mentions(out),
    outcomeBefore: outcomeDensity(current),
    outcomeAfter: outcomeDensity(out),
    // A swap that buys keywords by dropping the reason a human believes the
    // claim is the failure worth naming out loud.
    //
    // Scoped PER ORG and gated on the count actually falling. Naming every
    // dropped bullet that happened to have an outcome cries wolf: if its
    // replacement also has one, the page lost nothing and the warning is noise.
    // What matters is whether that employer's entry got thinner, not which
    // particular sentence moved.
    outcomeLost: perOrg.flatMap((o) => {
      const was = current.filter((b) => b.org === o.org);
      const now = out.filter((b) => b.org === o.org);
      if (outcomeDensity(now).withOutcome >= outcomeDensity(was).withOutcome) return [];
      return was.filter((b) => hasOutcome(b) && !now.some((n) => n.id === b.id)).map((b) => b.id);
    }),
    coveredBefore: [...before],
    coveredAfter: [...after],
    // A keyword no bullet in the whole library covers. Reported, never filled:
    // the resume cannot honestly claim it until the user adds the fact.
    unclaimable: keywords.filter((k) => !library.some((b) => bulletCoverage(b, [k]).length)),
    // Covered somewhere in the library but not by anything now on the page —
    // i.e. a swap that was possible and was not taken. Should be empty after a
    // successful tailor; non-empty means the slots ran out.
    stillMissing: keywords.filter((k) => !after.has(k) && library.some((b) => bulletCoverage(b, [k]).length)),
    changed: out.map((b) => b.id).join(',') !== current.map((b) => b.id).join(','),
  };
}
