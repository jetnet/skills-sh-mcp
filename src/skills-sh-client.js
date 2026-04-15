import { DEFAULT_BASE_URL, DEFAULT_FETCH_TIMEOUT_MS } from './util.js';
import { normalizeApiSkillId, parseSkillRef } from './refs.js';

function clampLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

export class SkillsShClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs) || DEFAULT_FETCH_TIMEOUT_MS;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required.');
    }
  }

  async requestJson(url) {
    const response = await this.fetchImpl(url, {
      headers: {
        accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new Error(`skills.sh request failed (${response.status} ${response.statusText}): ${body}`);
    }

    return response.json();
  }

  async searchSkills(query, options = {}) {
    const q = String(query ?? '').trim();
    if (q.length < 2) {
      throw new Error('Query must be at least 2 characters long.');
    }

    const limit = clampLimit(options.limit ?? 8);
    const url = `${this.baseUrl}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const json = await this.requestJson(url);
    const skills = Array.isArray(json.skills) ? json.skills : [];

    const normalized = [];
    for (const skill of skills) {
      const ref = normalizeApiSkillId(skill.id, skill.source || '');
      normalized.push({
        id: ref.id,
        owner: ref.owner,
        repo: ref.repo,
        slug: ref.slug,
        source: ref.source,
        url: ref.url,
        name: String(skill.name || ref.slug),
        installs: Number(skill.installs) || 0,
      });
    }

    const deduped = new Map();
    for (const item of normalized) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }

    return [...deduped.values()];
  }

  async downloadSkill(refOrString) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    const url = `${this.baseUrl}/api/download/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${encodeURIComponent(ref.slug)}`;
    const json = await this.requestJson(url);
    const files = Array.isArray(json.files) ? json.files : [];
    const hash = String(json.hash || '');

    return {
      ...ref,
      hash,
      files: files.map((file) => ({
        path: String(file.path || ''),
        contents: String(file.contents ?? ''),
      })),
    };
  }
}

async function safeReadBody(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 240) : 'no response body';
  } catch {
    return 'unable to read response body';
  }
}
