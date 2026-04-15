import { slugifySkillName } from './util.js';

function buildRef(owner, repo, slug) {
  const id = `${owner}/${repo}/${slug}`;
  return {
    owner,
    repo,
    slug,
    source: `${owner}/${repo}`,
    id,
    url: `https://skills.sh/${id}`,
  };
}

export function formatSkillId(ref) {
  if (!ref || !ref.owner || !ref.repo || !ref.slug) {
    throw new Error('Cannot format skill id without owner, repo, and slug.');
  }
  return `${ref.owner}/${ref.repo}/${ref.slug}`;
}

export function parseSkillRef(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new Error('Skill reference must be a non-empty string.');
  }

  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!/(^|\.)skills\.sh$/i.test(url.hostname)) {
      throw new Error('Only skills.sh URLs are supported as remote skill references.');
    }
    const parts = url.pathname
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length !== 3) {
      throw new Error(
        'skills.sh URLs must look like https://skills.sh/<owner>/<repo>/<slug>.'
      );
    }
    return buildRef(parts[0], parts[1], parts[2]);
  }

  const fullIdMatch = raw.match(/^([^/]+)\/([^/]+)\/([^/]+)$/);
  if (fullIdMatch) {
    return buildRef(fullIdMatch[1], fullIdMatch[2], fullIdMatch[3]);
  }

  const ownerRepoAtNameMatch = raw.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (ownerRepoAtNameMatch) {
    const owner = ownerRepoAtNameMatch[1];
    const repo = ownerRepoAtNameMatch[2];
    const name = ownerRepoAtNameMatch[3].trim();
    const slug = slugifySkillName(name);
    if (!slug) {
      throw new Error('Could not derive a slug from the provided skill name.');
    }
    return buildRef(owner, repo, slug);
  }

  const repoOnlyMatch = raw.match(/^([^/]+)\/([^/]+)$/);
  if (repoOnlyMatch) {
    throw new Error(
      'Repository-only references are ambiguous. Use owner/repo/slug, a skills.sh URL, or owner/repo@Skill Name.'
    );
  }

  throw new Error(
    'Unsupported skill reference format. Use owner/repo/slug, https://skills.sh/owner/repo/slug, or owner/repo@Skill Name.'
  );
}

export function normalizeApiSkillId(id, source = '') {
  const rawId = String(id ?? '').trim();
  const rawSource = String(source ?? '').trim();

  if (rawId.split('/').filter(Boolean).length === 3) {
    return parseSkillRef(rawId);
  }

  if (rawSource && rawSource.split('/').filter(Boolean).length === 2 && rawId) {
    return parseSkillRef(`${rawSource}/${rawId}`);
  }

  throw new Error(`Could not normalize API skill id "${rawId}" with source "${rawSource}".`);
}
