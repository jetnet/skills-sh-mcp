import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CacheManager } from '../src/cache.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'skills-sh-mcp-cache-'));
}

test('cache stores and retrieves skill packages', async () => {
  const tempDir = await makeTempDir();
  const cache = new CacheManager({ rootDir: tempDir, searchTtlMs: 60_000 });
  await cache.init();

  await cache.putSkill(
    'acme/skills/test-skill',
    {
      hash: 'hash-123',
      files: [
        {
          path: 'SKILL.md',
          contents: '---\nname: Test Skill\ndescription: Example description.\n---\n\n# Test Skill\n\nUse this skill.',
        },
        { path: 'notes/extra.md', contents: 'Extra details' },
      ],
    },
    { installs: 42 }
  );

  const cached = await cache.getSkill('acme/skills/test-skill', {
    includeFiles: true,
    includeInstructions: true,
  });
  assert.equal(cached.id, 'acme/skills/test-skill');
  assert.equal(cached.name, 'Test Skill');
  assert.equal(cached.description, 'Example description.');
  assert.match(cached.instructions, /Use this skill/);
  assert.equal(cached.files.length, 2);

  const file = await cache.readSkillFile('acme/skills/test-skill', 'notes/extra.md');
  assert.equal(file.contents, 'Extra details');

  const listed = await cache.listSkills();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].slug, 'test-skill');
});

test('cache rejects unsafe file paths from downloads', async () => {
  const tempDir = await makeTempDir();
  const cache = new CacheManager({ rootDir: tempDir, searchTtlMs: 60_000 });
  await cache.init();

  await assert.rejects(
    () =>
      cache.putSkill('acme/skills/test-skill', {
        hash: 'hash-123',
        files: [{ path: '../bad.txt', contents: 'nope' }],
      }),
    /unsafe relative path/i
  );
});

test('search cache respects ttl', async () => {
  const tempDir = await makeTempDir();
  const cache = new CacheManager({ rootDir: tempDir, searchTtlMs: 50 });
  await cache.init();
  await cache.setSearch('react', 5, [{ id: 'x/y/react' }]);
  assert.deepEqual(await cache.getSearch('react', 5), [{ id: 'x/y/react' }]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(await cache.getSearch('react', 5), null);
});
