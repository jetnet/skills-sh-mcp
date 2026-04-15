import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/runtime.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'skills-sh-mcp-tools-'));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createMockFetch() {
  const calls = [];
  const handler = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));

    if (parsed.pathname === '/api/search') {
      const q = parsed.searchParams.get('q');
      if (q === 'react best practices') {
        return jsonResponse({
          skills: [
            {
              id: 'community/pack/react-best-practices',
              name: 'React Best Practices',
              installs: 150,
              source: 'community/pack',
            },
            {
              id: 'vercel-labs/skills/react',
              name: 'React',
              installs: 50000,
              source: 'vercel-labs/skills',
            },
          ],
        });
      }
      if (q === 'react') {
        return jsonResponse({
          skills: [
            {
              id: 'owner-a/skills/react-patterns',
              name: 'React Patterns',
              installs: 1200,
              source: 'owner-a/skills',
            },
            {
              id: 'owner-b/skills/react-best-practices',
              name: 'React Best Practices',
              installs: 1400,
              source: 'owner-b/skills',
            },
          ],
        });
      }
      return jsonResponse({ skills: [] });
    }

    if (parsed.pathname === '/api/download/community/pack/react-best-practices') {
      return jsonResponse({
        hash: 'hash-rbp',
        files: [
          {
            path: 'SKILL.md',
            contents:
              '---\nname: React Best Practices\ndescription: Advice for building React codebases.\n---\n\n# React Best Practices\n\nUse this for React architecture.',
          },
          {
            path: 'checklist.md',
            contents: '- keep components small',
          },
        ],
      });
    }

    return jsonResponse({ error: 'not found' }, 404);
  };

  handler.calls = calls;
  return handler;
}

test('search_skills ranks candidates and exposes selection metadata', async () => {
  const cacheDir = await makeTempDir();
  const fetchImpl = createMockFetch();
  const app = await createApp({ cacheDir, fetchImpl, trustedOwners: ['vercel-labs'] });

  const result = await app.handlers.search_skills({ query: 'react best practices', limit: 5 });
  assert.equal(result.candidates[0].id, 'community/pack/react-best-practices');
  assert.equal(result.autoSelectable, true);
  assert.equal(result.recommended.id, 'community/pack/react-best-practices');
  assert.equal(result.selectionPolicy.retrieval, 'skills.sh search API');
});

test('load_skill by query auto-loads only high confidence matches and then reuses cache', async () => {
  const cacheDir = await makeTempDir();
  const fetchImpl = createMockFetch();
  const app = await createApp({ cacheDir, fetchImpl, trustedOwners: ['vercel-labs'] });

  const first = await app.handlers.load_skill({ query: 'react best practices' });
  assert.equal(first.loaded, true);
  assert.equal(first.fromCache, false);
  assert.equal(first.skill.id, 'community/pack/react-best-practices');
  assert.match(first.skill.instructions, /React architecture/);

  const second = await app.handlers.load_skill({
    skillRef: 'community/pack/react-best-practices',
  });
  assert.equal(second.loaded, true);
  assert.equal(second.fromCache, true);
  assert.equal(second.skill.id, 'community/pack/react-best-practices');

  const searchCalls = fetchImpl.calls.filter((url) => url.includes('/api/search')).length;
  const downloadCalls = fetchImpl.calls.filter((url) => url.includes('/api/download')).length;
  assert.equal(searchCalls, 1);
  assert.equal(downloadCalls, 1);
});

test('load_skill returns candidates instead of auto-selecting ambiguous queries', async () => {
  const cacheDir = await makeTempDir();
  const fetchImpl = createMockFetch();
  const app = await createApp({ cacheDir, fetchImpl, trustedOwners: ['vercel-labs'] });

  const result = await app.handlers.load_skill({ query: 'react' });
  assert.equal(result.loaded, false);
  assert.equal(result.needsDisambiguation, true);
  assert.equal(Array.isArray(result.candidates), true);
  assert.equal(result.candidates.length, 2);
});
