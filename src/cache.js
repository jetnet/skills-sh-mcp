import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ensureDir,
  pathExists,
  readJsonIfExists,
  removeDir,
  safeRelativePath,
  sha256,
  writeJson,
  writeText,
} from './util.js';
import { extractSkillMetadata } from './frontmatter.js';
import { parseSkillRef } from './refs.js';

function encodeSkillDirName(ref) {
  return `${ref.owner}__${ref.repo}__${ref.slug}`;
}

export class CacheManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir;
    this.searchTtlMs = options.searchTtlMs;
    this.searchDir = path.join(this.rootDir, 'search');
    this.skillsDir = path.join(this.rootDir, 'skills');
  }

  async init() {
    await ensureDir(this.rootDir);
    await ensureDir(this.searchDir);
    await ensureDir(this.skillsDir);
  }

  searchCachePath(query, limit) {
    const key = sha256(JSON.stringify({ query, limit }));
    return path.join(this.searchDir, `${key}.json`);
  }

  async getSearch(query, limit) {
    const filePath = this.searchCachePath(query, limit);
    const payload = await readJsonIfExists(filePath);
    if (!payload) return null;

    const cachedAt = Number(payload.cachedAtMs) || 0;
    const ageMs = Date.now() - cachedAt;
    if (ageMs > this.searchTtlMs) {
      return null;
    }

    return payload.results ?? null;
  }

  async setSearch(query, limit, results) {
    const filePath = this.searchCachePath(query, limit);
    await writeJson(filePath, {
      query,
      limit,
      cachedAtMs: Date.now(),
      results,
    });
  }

  skillDir(refOrString) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    return path.join(this.skillsDir, encodeSkillDirName(ref));
  }

  manifestPath(refOrString) {
    return path.join(this.skillDir(refOrString), 'manifest.json');
  }

  filesRoot(refOrString) {
    return path.join(this.skillDir(refOrString), 'files');
  }

  async hasSkill(refOrString) {
    return pathExists(this.manifestPath(refOrString));
  }

  async putSkill(refOrString, downloadPayload, extraMetadata = {}) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    const dir = this.skillDir(ref);
    const filesRoot = this.filesRoot(ref);
    const normalizedFiles = Array.isArray(downloadPayload.files)
      ? downloadPayload.files.map((file) => ({
          path: safeRelativePath(file.path),
          contents: String(file.contents ?? ''),
        }))
      : [];

    await removeDir(dir);
    await ensureDir(filesRoot);

    for (const file of normalizedFiles) {
      const destination = path.join(filesRoot, file.path);
      await writeText(destination, file.contents);
    }

    const extracted = extractSkillMetadata(normalizedFiles);
    const manifest = {
      id: ref.id,
      owner: ref.owner,
      repo: ref.repo,
      slug: ref.slug,
      source: ref.source,
      url: ref.url,
      hash: String(downloadPayload.hash ?? ''),
      cachedAt: new Date().toISOString(),
      fileCount: normalizedFiles.length,
      filePaths: normalizedFiles.map((file) => file.path).sort(),
      skillFilePath: extracted.skillFilePath,
      name: extraMetadata.name || extracted.name || ref.slug,
      description: extraMetadata.description || extracted.description || null,
      installs: Number(extraMetadata.installs) || 0,
    };

    await writeJson(this.manifestPath(ref), manifest);
    return this.getSkill(ref.id, { includeFiles: false, includeInstructions: true });
  }

  async getSkill(refOrString, options = {}) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    const manifest = await readJsonIfExists(this.manifestPath(ref));
    if (!manifest) return null;

    const includeFiles = options.includeFiles === true;
    const includeInstructions = options.includeInstructions !== false;
    let instructions = null;
    let files = null;

    if (includeInstructions && manifest.skillFilePath) {
      instructions = await fs.readFile(path.join(this.filesRoot(ref), manifest.skillFilePath), 'utf8');
    }

    if (includeFiles) {
      files = [];
      for (const relativePath of manifest.filePaths || []) {
        const contents = await fs.readFile(path.join(this.filesRoot(ref), relativePath), 'utf8');
        files.push({ path: relativePath, contents });
      }
    }

    return {
      ...manifest,
      instructions,
      files,
    };
  }

  async getMetadata(refOrString) {
    const skill = await this.getSkill(refOrString, {
      includeFiles: false,
      includeInstructions: false,
    });
    return skill
      ? {
          id: skill.id,
          source: skill.source,
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          installs: skill.installs,
          url: skill.url,
          cachedAt: skill.cachedAt,
        }
      : null;
  }

  async readSkillFile(refOrString, relativePath) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    const safePath = safeRelativePath(relativePath);
    const fullPath = path.join(this.filesRoot(ref), safePath);
    try {
      const contents = await fs.readFile(fullPath, 'utf8');
      return {
        id: ref.id,
        path: safePath,
        contents,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async listSkills() {
    await ensureDir(this.skillsDir);
    const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readJsonIfExists(path.join(this.skillsDir, entry.name, 'manifest.json'));
      if (!manifest) continue;
      skills.push(manifest);
    }

    return skills.sort((a, b) => String(b.cachedAt).localeCompare(String(a.cachedAt)));
  }
}
