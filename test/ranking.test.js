import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRecommendation, rankSkills } from '../src/ranking.js';

const trustedOwners = ['vercel-labs', 'anthropics', 'microsoft'];

test('strong lexical match beats a much more installed but generic skill', () => {
  const ranked = rankSkills(
    'react best practices',
    [
      {
        id: 'community/pack/react-best-practices',
        owner: 'community',
        repo: 'pack',
        slug: 'react-best-practices',
        source: 'community/pack',
        url: 'https://skills.sh/community/pack/react-best-practices',
        name: 'React Best Practices',
        installs: 120,
      },
      {
        id: 'vercel-labs/skills/react',
        owner: 'vercel-labs',
        repo: 'skills',
        slug: 'react',
        source: 'vercel-labs/skills',
        url: 'https://skills.sh/vercel-labs/skills/react',
        name: 'React',
        installs: 50000,
      },
    ],
    { trustedOwners }
  );

  assert.equal(ranked[0].id, 'community/pack/react-best-practices');
  const recommendation = chooseRecommendation(ranked);
  assert.equal(recommendation.confidence, 'high');
  assert.equal(recommendation.autoSelectable, true);
});

test('exact slug match becomes auto-selectable', () => {
  const ranked = rankSkills(
    'find-skills',
    [
      {
        id: 'vercel-labs/skills/find-skills',
        owner: 'vercel-labs',
        repo: 'skills',
        slug: 'find-skills',
        source: 'vercel-labs/skills',
        url: 'https://skills.sh/vercel-labs/skills/find-skills',
        name: 'Find Skills',
        installs: 2000,
      },
      {
        id: 'someone/skills/search-guides',
        owner: 'someone',
        repo: 'skills',
        slug: 'search-guides',
        source: 'someone/skills',
        url: 'https://skills.sh/someone/skills/search-guides',
        name: 'Search Guides',
        installs: 100000,
      },
    ],
    { trustedOwners }
  );

  assert.equal(ranked[0].slug, 'find-skills');
  assert.equal(chooseRecommendation(ranked).autoSelectable, true);
});

test('ambiguous short queries are not auto-selected', () => {
  const ranked = rankSkills(
    'react',
    [
      {
        id: 'owner-a/skills/react-patterns',
        owner: 'owner-a',
        repo: 'skills',
        slug: 'react-patterns',
        source: 'owner-a/skills',
        url: 'https://skills.sh/owner-a/skills/react-patterns',
        name: 'React Patterns',
        installs: 1200,
      },
      {
        id: 'owner-b/skills/react-best-practices',
        owner: 'owner-b',
        repo: 'skills',
        slug: 'react-best-practices',
        source: 'owner-b/skills',
        url: 'https://skills.sh/owner-b/skills/react-best-practices',
        name: 'React Best Practices',
        installs: 1400,
      },
    ],
    { trustedOwners }
  );

  const recommendation = chooseRecommendation(ranked);
  assert.equal(recommendation.autoSelectable, false);
  assert.match(recommendation.confidence, /low|medium/);
});
