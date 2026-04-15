import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiSkillId, parseSkillRef } from '../src/refs.js';

test('parseSkillRef supports canonical full id', () => {
  const ref = parseSkillRef('vercel-labs/skills/find-skills');
  assert.deepEqual(ref, {
    owner: 'vercel-labs',
    repo: 'skills',
    slug: 'find-skills',
    source: 'vercel-labs/skills',
    id: 'vercel-labs/skills/find-skills',
    url: 'https://skills.sh/vercel-labs/skills/find-skills',
  });
});

test('parseSkillRef supports skills.sh URLs', () => {
  const ref = parseSkillRef('https://skills.sh/vercel-labs/skills/find-skills');
  assert.equal(ref.id, 'vercel-labs/skills/find-skills');
});

test('parseSkillRef supports owner/repo@Skill Name', () => {
  const ref = parseSkillRef('vercel-labs/skills@Find Skills');
  assert.equal(ref.slug, 'find-skills');
  assert.equal(ref.id, 'vercel-labs/skills/find-skills');
});

test('parseSkillRef rejects repo-only refs', () => {
  assert.throws(() => parseSkillRef('vercel-labs/skills'), /ambiguous/i);
});

test('normalizeApiSkillId handles search ids and source fallback', () => {
  const direct = normalizeApiSkillId('vercel-labs/skills/find-skills', 'vercel-labs/skills');
  assert.equal(direct.id, 'vercel-labs/skills/find-skills');

  const fallback = normalizeApiSkillId('find-skills', 'vercel-labs/skills');
  assert.equal(fallback.id, 'vercel-labs/skills/find-skills');
});
