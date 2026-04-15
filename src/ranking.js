import {
  formatInstalls,
  normalizeText,
  overlapRatio,
  round,
  slugifySkillName,
  stableSortBy,
  tokenize,
  unique,
} from './util.js';

function ownerIsTrusted(candidate, trustedOwners) {
  return trustedOwners.some((owner) => owner.toLowerCase() === String(candidate.owner || '').toLowerCase());
}

function scoreCandidate(query, candidate, metadata, trustedOwners) {
  const queryText = normalizeText(query);
  const querySlug = slugifySkillName(query);
  const queryTokens = tokenize(query);
  const candidateNameText = normalizeText(candidate.name);
  const candidateSlugText = normalizeText(candidate.slug);
  const candidateIdText = normalizeText(candidate.id);
  const candidateSourceText = normalizeText(candidate.source);
  const cachedDescriptionText = normalizeText(metadata?.description || '');

  const nameTokens = tokenize(candidate.name);
  const slugTokens = tokenize(candidate.slug);
  const idTokens = tokenize(candidate.id);
  const sourceTokens = tokenize(candidate.source);
  const descriptionTokens = tokenize(metadata?.description || '');

  let score = 0;
  const reasons = [];
  const signals = {
    exactId: false,
    exactSlug: false,
    exactName: false,
    trustedOwner: false,
    coverage: 0,
    allTokensInName: false,
    allTokensInSlug: false,
  };

  if (queryText && queryText === candidateIdText) {
    score += 120;
    reasons.push('exact id match');
    signals.exactId = true;
  }

  if (querySlug && querySlug === candidate.slug) {
    score += 110;
    reasons.push('exact slug match');
    signals.exactSlug = true;
  }

  if (queryText && queryText === candidateNameText) {
    score += 95;
    reasons.push('exact name match');
    signals.exactName = true;
  }

  const nameCoverage = overlapRatio(queryTokens, nameTokens);
  const slugCoverage = overlapRatio(queryTokens, slugTokens);
  const idCoverage = overlapRatio(queryTokens, idTokens);
  const sourceCoverage = overlapRatio(queryTokens, sourceTokens);
  const descriptionCoverage = overlapRatio(queryTokens, descriptionTokens);

  signals.coverage = Math.max(nameCoverage, slugCoverage, idCoverage, descriptionCoverage);
  signals.allTokensInName = queryTokens.length > 0 && nameCoverage === 1;
  signals.allTokensInSlug = queryTokens.length > 0 && slugCoverage === 1;

  if (signals.allTokensInName && !signals.exactName) {
    score += 60;
    reasons.push('all query tokens match the skill name');
  } else if (nameCoverage > 0) {
    score += nameCoverage * 48;
    if (nameCoverage >= 0.5) reasons.push('skill name overlaps strongly with the query');
  }

  if (signals.allTokensInSlug && !signals.exactSlug) {
    score += 52;
    reasons.push('all query tokens match the skill slug');
  } else if (slugCoverage > 0) {
    score += slugCoverage * 42;
    if (slugCoverage >= 0.5) reasons.push('skill slug overlaps strongly with the query');
  }

  if (idCoverage > 0) {
    score += idCoverage * 20;
  }

  if (sourceCoverage > 0) {
    score += sourceCoverage * 10;
    if (sourceCoverage === 1 && queryTokens.length) reasons.push('source matches the query');
  }

  if (descriptionCoverage > 0) {
    score += descriptionCoverage * 14;
    reasons.push('cached description supports the match');
  }

  const installs = Number(candidate.installs) || 0;
  const installScore = Math.min(18, Math.log10(installs + 1) * 6);
  score += installScore;
  if (installs > 0) {
    reasons.push(`${formatInstalls(installs)} on skills.sh`);
  }

  if (ownerIsTrusted(candidate, trustedOwners)) {
    score += 4;
    signals.trustedOwner = true;
    reasons.push('trusted owner');
  }

  if (queryTokens.length >= 2 && signals.coverage < 0.5) {
    score -= 8;
  }

  if (queryTokens.length >= 1 && !signals.exactId && !signals.exactName && !signals.exactSlug && signals.coverage === 0) {
    score -= 12;
  }

  return {
    ...candidate,
    name: metadata?.name || candidate.name,
    description: metadata?.description || null,
    cachedAt: metadata?.cachedAt || null,
    score: round(score, 3),
    reasons: unique(reasons),
    signals,
  };
}

export function rankSkills(query, candidates, options = {}) {
  const metadataById = options.metadataById || {};
  const trustedOwners = Array.isArray(options.trustedOwners) ? options.trustedOwners : [];
  const scored = candidates.map((candidate) =>
    scoreCandidate(query, candidate, metadataById[candidate.id] || null, trustedOwners)
  );

  return stableSortBy(scored, (left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if ((right.installs || 0) !== (left.installs || 0)) return (right.installs || 0) - (left.installs || 0);
    return String(left.id).localeCompare(String(right.id));
  });
}

export function chooseRecommendation(rankedSkills) {
  const ranked = Array.isArray(rankedSkills) ? rankedSkills : [];
  const first = ranked[0] || null;
  const second = ranked[1] || null;

  if (!first) {
    return {
      confidence: 'low',
      autoSelectable: false,
      scoreGap: 0,
      candidate: null,
    };
  }

  const gap = first.score - (second?.score ?? 0);
  let confidence = 'low';

  if (
    first.signals.exactId ||
    first.signals.exactSlug ||
    first.signals.exactName ||
    ((first.signals.allTokensInName || first.signals.allTokensInSlug) && gap >= 12)
  ) {
    confidence = 'high';
  } else if (first.signals.coverage >= 0.75 && gap >= 10) {
    confidence = 'high';
  } else if (first.signals.coverage >= 0.55 && gap >= 6) {
    confidence = 'medium';
  }

  return {
    confidence,
    autoSelectable: confidence === 'high',
    scoreGap: round(gap, 3),
    candidate: first,
  };
}

export function getSelectionPolicySummary() {
  return {
    retrieval: 'skills.sh search API',
    rankingSignals: [
      'exact id, slug, and name matches',
      'token overlap across skill name, slug, id, and source',
      'cached description overlap when a skill was loaded before',
      'install count as a tie-breaker, not the sole signal',
      'small boost for trusted owners',
    ],
    autoSelectionRule:
      'Only auto-select when the top result is high confidence. Otherwise return the top candidates and require explicit choice.',
    limitations: [
      'The public search API does not expose tags or descriptions in the same shape as the downloaded skill, so tags are not first-class ranking inputs here.',
      'A very popular skill will not beat a much stronger lexical match on its own.',
    ],
  };
}
