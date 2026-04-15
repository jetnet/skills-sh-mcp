import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

export const DEFAULT_BASE_URL = 'https://skills.sh';
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_SEARCH_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'skills-sh-mcp');
export const DEFAULT_TRUSTED_OWNERS = ['vercel-labs', 'anthropics', 'microsoft'];

export function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function envCsv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getConfigFromEnv() {
  return {
    baseUrl: process.env.SKILLS_SH_BASE_URL || DEFAULT_BASE_URL,
    cacheDir: process.env.SKILLS_SH_CACHE_DIR || DEFAULT_CACHE_DIR,
    fetchTimeoutMs: envInt('SKILLS_SH_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS),
    searchTtlMs: envInt('SKILLS_SH_SEARCH_TTL_MS', DEFAULT_SEARCH_TTL_MS),
    trustedOwners: envCsv('SKILLS_SH_TRUSTED_OWNERS', DEFAULT_TRUSTED_OWNERS),
  };
}

export function stripDiacritics(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '');
}

export function normalizeText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function stableSortBy(array, compareFn) {
  return array
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const diff = compareFn(a.value, b.value);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((entry) => entry.value);
}

export function slugifySkillName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, String(value), 'utf8');
}

export async function removeDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export function safeRelativePath(inputPath) {
  const raw = String(inputPath ?? '').trim();
  if (!raw) {
    throw new Error('Path must be a non-empty relative path.');
  }
  if (raw.includes('\0')) {
    throw new Error('Path contains invalid null bytes.');
  }

  const normalized = path.posix.normalize(raw.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/')
  ) {
    throw new Error(`Unsafe relative path: ${inputPath}`);
  }

  return normalized;
}

export function formatInstalls(installs) {
  const count = Number(installs) || 0;
  if (count <= 0) return '0 installs';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
  }
  return `${count} install${count === 1 ? '' : 's'}`;
}

export function overlapRatio(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) matches += 1;
  }
  return matches / queryTokens.length;
}

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function logDebug(...parts) {
  if (!process.env.SKILLS_SH_MCP_DEBUG) return;
  const line = parts
    .map((part) => {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(' ');
  process.stderr.write(`[skills-sh-mcp] ${line}\n`);
}
