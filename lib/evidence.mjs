// Whether a number this pipeline produced is worth believing.
//
// WHERE THIS CAME FROM
//
// Adapted 2026-09-21 from a sibling Claude session running a trading research
// project, which has something this pipeline does not: a hard ground-truth label
// (P&L) and a few hundred thousand observations. It still nearly shipped a false
// positive, and the machinery below is what caught it. Its own summary of the
// incident: a "holding time predicts P&L" result published at Pearson +0.152,
// permutation p=0.0031 — then Spearman −0.023, and dropping 7 of 431 rows
// flipped the sign. The entire effect was seven points and one outlier.
//
// The argument for importing it here is the asymmetry, not the similarity: that
// project has a fast, hard label and still fooled itself. A job search has a
// slow, noisy label and a tracker with single-digit rows, which makes it EASIER
// to believe a scorer works, not harder.
//
// None of the trading findings transferred and none were imported. This is the
// machinery that established those findings were dead.

/** Pearson product-moment correlation. The naive number, kept for comparison. */
export function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Average ranks, so ties do not silently become an ordering. */
export function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation: the same question asked without outlier leverage. */
export function spearman(pairs) {
  if (pairs.length < 3) return null;
  const rx = ranks(pairs.map((p) => p[0]));
  const ry = ranks(pairs.map((p) => p[1]));
  return pearson(rx.map((v, i) => [v, ry[i]]));
}

/** Drop the most extreme `frac` by |outcome| and recompute. */
export function dropTail(pairs, frac = 0.02) {
  const k = Math.max(1, Math.floor(pairs.length * frac));
  const kept = [...pairs].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1])).slice(0, pairs.length - k);
  return { kept, dropped: k };
}

/**
 * Three views of one correlation, and a verdict that requires them to agree.
 *
 * A single Pearson figure is the cheapest thing to produce and the easiest to be
 * wrong about. Agreement across the raw statistic, the rank statistic, and the
 * statistic with its tail removed is what distinguishes a relationship from a
 * handful of leveraged points.
 */
export function robustCorrelation(pairs, { tailFrac = 0.02 } = {}) {
  if (!Array.isArray(pairs) || pairs.length < 3) {
    return { n: pairs?.length ?? 0, verdict: 'too-few', reason: 'fewer than 3 observations' };
  }
  const p = pearson(pairs);
  const s = spearman(pairs);
  const { kept, dropped } = dropTail(pairs, tailFrac);
  const pd = pearson(kept);
  const sign = (v) => (v == null ? 0 : Math.sign(Math.round(v * 1000) / 1000));

  const signs = [sign(p), sign(s), sign(pd)];
  const agree = signs.every((v) => v === signs[0]) && signs[0] !== 0;
  return {
    n: pairs.length,
    pearson: p, spearman: s, pearsonDropTail: pd, dropped,
    verdict: agree ? 'consistent' : 'unstable',
    reason: agree
      ? null
      : `sign disagrees across views (pearson ${fmt(p)}, spearman ${fmt(s)}, drop-tail ${fmt(pd)})`
        + ` — the relationship is carried by ${dropped} observation(s), not by the sample`,
  };
}

const fmt = (v) => (v == null ? 'n/a' : v.toFixed(3));

/**
 * A single elevated bucket is cheap; an ordered trend is not.
 *
 * `buckets` is an ordered array of rates. Returns how far the sequence is from
 * monotone. Used as POSITIVE evidence: if a listing score is real, deciles of
 * score should move in one direction, and "only the top decile is elevated" is
 * one cell and probably noise.
 */
export function monotonicity(buckets) {
  const b = (buckets ?? []).filter((v) => Number.isFinite(v));
  if (b.length < 3) return { monotone: false, direction: 0, reason: 'fewer than 3 buckets' };
  let up = 0, down = 0;
  for (let i = 1; i < b.length; i++) {
    if (b[i] > b[i - 1]) up++;
    else if (b[i] < b[i - 1]) down++;
  }
  const steps = b.length - 1;
  const direction = up > down ? 1 : down > up ? -1 : 0;
  const agreeing = Math.max(up, down);
  return {
    monotone: agreeing === steps,
    direction,
    agreeingSteps: agreeing,
    steps,
    reason: agreeing === steps ? null : `${steps - agreeing} of ${steps} steps reverse direction`,
  };
}

/**
 * What a sample this size can actually support.
 *
 * The honest framing for a tracker holding single-digit rows: it cannot estimate
 * anything. It can only falsify something loudly wrong. So the useful output is
 * not a confidence interval but a statement of which claims are available, and a
 * pre-declared threshold below which the scorer is considered broken.
 *
 * `baseline` is the rate assumed under the null (a plausible response rate).
 */
export function claimsAvailable(n, { baseline = 0.15 } = {}) {
  // Standard error of a proportion at the baseline. With n small this is wide
  // enough that any observed rate is consistent with the null.
  const se = n > 0 ? Math.sqrt((baseline * (1 - baseline)) / n) : Infinity;
  // The smallest difference a two-sided test at .05 could detect.
  const detectable = 1.96 * se;
  if (n < 10) {
    return {
      n, se, detectable,
      canEstimate: false,
      canFalsify: n >= 5,
      guidance: n >= 5
        ? `n=${n}: cannot estimate a rate. Usable only as a smoke test — declare a failure threshold in advance and check whether it is breached.`
        : `n=${n}: reports nothing. Any rate computed here is an artifact of the denominator.`,
    };
  }
  return {
    n, se, detectable,
    canEstimate: detectable < 0.20,
    canFalsify: true,
    guidance: detectable < 0.20
      ? `n=${n}: can detect a difference of ${(detectable * 100).toFixed(0)}pp or larger.`
      : `n=${n}: only a difference of ${(detectable * 100).toFixed(0)}pp or larger is detectable — treat smaller gaps as noise.`,
  };
}

/**
 * Bonferroni threshold for however many comparisons have been made so far.
 *
 * The count belongs in a FILE, not in someone's head: the sibling project
 * reached 29 tests over its life and its best result (p=0.0050) did not clear
 * the corrected bar (p<0.0017). Without a running total it would have shipped.
 */
export function correctedAlpha(comparisons, alpha = 0.05) {
  const k = Math.max(1, Math.floor(comparisons || 1));
  return { comparisons: k, alpha, corrected: alpha / k };
}

/** Parse an append-only budget ledger into a count. */
export function countComparisons(tsv) {
  return String(tsv ?? '').split('\n').filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('date\t')).length;
}

// Digits AND number words. The first version matched digits only and therefore
// could not see "Built six CI/CD pipelines across five repositories" -- which is
// precisely the claim master had flagged UNVERIFIED and which shipped anyway. A
// detector blind to the case that motivated it is worse than none.
const FIGURE = new RegExp([
  '(?<![\\w-])\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|\\+|x|k|M)?(?![\\w-])',
  '\\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|hundred|thousand|million)\\b',
].join('|'), 'i');

/**
 * Which quantified claims have never been confirmed.
 *
 * The bullets are string literals in a YAML file and the fact-checker compares
 * them against another file of string literals, so a figure here has never been
 * through a code path that could fail — and a value that is never computed also
 * never fails. That is exactly how a count this project's own master file had
 * flagged "COUNT UNVERIFIED — confirm before it appears on a resume" shipped on
 * resumes for weeks: nothing was wrong, nothing was checked, and the two are
 * indistinguishable from the outside.
 */
export function unverifiedClaims(bullets) {
  return (bullets ?? [])
    .filter((b) => {
      const m = FIGURE.exec(String(b.text ?? ''));
      return m && !/^(19|20)\d\d$/.test(m[0].trim());
    })
    .filter((b) => !b.verified)
    .map((b) => ({ id: b.id, org: b.org, figure: FIGURE.exec(String(b.text))[0].trim() }));
}
