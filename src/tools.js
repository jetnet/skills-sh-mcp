import { CacheManager } from './cache.js';
import { extractSkillMetadata } from './frontmatter.js';
import { chooseRecommendation, getSelectionPolicySummary, rankSkills } from './ranking.js';
import { parseSkillRef } from './refs.js';

export const TOOL_DEFINITIONS = [
  {
    name: 'search_skills',
    description:
      'Search skills.sh for relevant skills. Returns ranked candidates, the selection policy, and whether a top result is safe to auto-select.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          description: 'Natural-language search query, such as "postgres migrations" or "react best practices".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 8,
          description: 'Maximum number of ranked candidates to return.',
        },
        refresh: {
          type: 'boolean',
          default: false,
          description: 'Bypass the cached search response and re-query skills.sh.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'load_skill',
    description:
      'Load and cache a skill from skills.sh. Accepts either an explicit skill ref or a search query. Query-based loading only auto-selects high-confidence matches.',
    inputSchema: {
      type: 'object',
      properties: {
        skillRef: {
          type: 'string',
          description:
            'Canonical skill ref: owner/repo/slug, a full skills.sh URL, or owner/repo@Skill Name.',
        },
        query: {
          type: 'string',
          description:
            'Optional search query. The server will search first and only auto-load a result when confidence is high.',
        },
        autoSelect: {
          type: 'boolean',
          default: true,
          description:
            'When using query-based loading, auto-load only if the top result is high confidence. If false, return candidates without loading.',
        },
        refresh: {
          type: 'boolean',
          default: false,
          description: 'Re-download the skill even if it is already cached locally.',
        },
        includeFiles: {
          type: 'boolean',
          default: false,
          description: 'Include all file contents in the response. Defaults to only the main SKILL.md instructions.',
        },
      },
      additionalProperties: false,
      anyOf: [{ required: ['skillRef'] }, { required: ['query'] }],
    },
  },
  {
    name: 'read_cached_skill_file',
    description:
      'Read a single file from a previously cached skill package. Use this for auxiliary files after loading a skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skillRef: {
          type: 'string',
          description: 'A cached skill ref in owner/repo/slug, skills.sh URL, or owner/repo@Skill Name format.',
        },
        path: {
          type: 'string',
          description: 'Relative file path inside the cached skill package.',
        },
      },
      required: ['skillRef', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_cached_skills',
    description: 'List the skill packages that have already been cached locally.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function createToolHandlers(options) {
  const client = options.client;
  const cache = options.cache;
  const trustedOwners = options.trustedOwners || [];

  if (!(cache instanceof CacheManager)) {
    throw new Error('createToolHandlers requires a CacheManager instance.');
  }

  async function getMetadataById(candidates) {
    const result = {};
    for (const candidate of candidates) {
      result[candidate.id] = await cache.getMetadata(candidate.id);
    }
    return result;
  }

  async function searchSkills(args = {}) {
    const query = String(args.query ?? '').trim();
    const limit = Number(args.limit) || 8;
    const refresh = args.refresh === true;
    if (query.length < 2) {
      throw new Error('query must be at least 2 characters long.');
    }

    let apiResults = null;
    let cacheStatus = 'miss';

    if (!refresh) {
      apiResults = await cache.getSearch(query, limit);
      if (apiResults) cacheStatus = 'hit';
    }

    if (!apiResults) {
      apiResults = await client.searchSkills(query, { limit });
      await cache.setSearch(query, limit, apiResults);
    }

    const metadataById = await getMetadataById(apiResults);
    const ranked = rankSkills(query, apiResults, {
      metadataById,
      trustedOwners,
    }).slice(0, limit);
    const recommendation = chooseRecommendation(ranked);

    return {
      query,
      cacheStatus,
      selectionPolicy: getSelectionPolicySummary(),
      confidence: recommendation.confidence,
      autoSelectable: recommendation.autoSelectable,
      recommended: recommendation.candidate,
      scoreGap: recommendation.scoreGap,
      candidates: ranked,
    };
  }

  async function loadByRef(refOrString, options = {}) {
    const ref = typeof refOrString === 'string' ? parseSkillRef(refOrString) : refOrString;
    const refresh = options.refresh === true;
    const includeFiles = options.includeFiles === true;

    if (!refresh) {
      const cached = await cache.getSkill(ref.id, {
        includeFiles,
        includeInstructions: true,
      });
      if (cached) {
        return {
          loaded: true,
          fromCache: true,
          skill: cached,
        };
      }
    }

    const download = await client.downloadSkill(ref);
    const extracted = extractSkillMetadata(download.files);
    const installs = Number(options.installs) || 0;
    const saved = await cache.putSkill(ref.id, download, {
      name: options.name || extracted.name || ref.slug,
      description: options.description || extracted.description,
      installs,
    });

    const skill = includeFiles
      ? await cache.getSkill(ref.id, { includeFiles: true, includeInstructions: true })
      : saved;

    return {
      loaded: true,
      fromCache: false,
      skill,
    };
  }

  async function loadSkill(args = {}) {
    const skillRef = args.skillRef ? String(args.skillRef).trim() : '';
    const query = args.query ? String(args.query).trim() : '';
    const autoSelect = args.autoSelect !== false;
    const refresh = args.refresh === true;
    const includeFiles = args.includeFiles === true;

    if (!skillRef && !query) {
      throw new Error('Either skillRef or query is required.');
    }

    if (skillRef) {
      return loadByRef(skillRef, { refresh, includeFiles });
    }

    const searchResult = await searchSkills({
      query,
      limit: Math.max(Number(args.limit) || 5, 3),
      refresh,
    });

    if (!searchResult.candidates.length) {
      return {
        loaded: false,
        needsDisambiguation: false,
        reason: 'No matching skills were found.',
        query,
        candidates: [],
      };
    }

    if (!autoSelect || !searchResult.autoSelectable || !searchResult.recommended) {
      return {
        loaded: false,
        needsDisambiguation: true,
        reason:
          autoSelect === false
            ? 'autoSelect=false, so returning ranked candidates without loading.'
            : 'No single high-confidence result was found. Pick one of the returned candidates explicitly.',
        query,
        confidence: searchResult.confidence,
        recommended: searchResult.recommended,
        candidates: searchResult.candidates,
        selectionPolicy: searchResult.selectionPolicy,
      };
    }

    const loaded = await loadByRef(searchResult.recommended.id, {
      refresh,
      includeFiles,
      name: searchResult.recommended.name,
      description: searchResult.recommended.description,
      installs: searchResult.recommended.installs,
    });

    return {
      ...loaded,
      selection: {
        query,
        confidence: searchResult.confidence,
        scoreGap: searchResult.scoreGap,
        selected: searchResult.recommended,
      },
    };
  }

  async function readCachedSkillFile(args = {}) {
    const skillRef = String(args.skillRef ?? '').trim();
    const relativePath = String(args.path ?? '').trim();
    if (!skillRef || !relativePath) {
      throw new Error('skillRef and path are required.');
    }

    const skill = await cache.getSkill(skillRef, {
      includeFiles: false,
      includeInstructions: false,
    });
    if (!skill) {
      throw new Error('Skill is not cached locally. Load it first with load_skill.');
    }

    const file = await cache.readSkillFile(skillRef, relativePath);
    if (!file) {
      throw new Error(`File not found in cache: ${relativePath}`);
    }

    return {
      skill: {
        id: skill.id,
        name: skill.name,
        source: skill.source,
      },
      file,
    };
  }

  async function listCachedSkills() {
    const skills = await cache.listSkills();
    return {
      cacheDir: cache.rootDir,
      count: skills.length,
      skills,
    };
  }

  return {
    search_skills: searchSkills,
    load_skill: loadSkill,
    read_cached_skill_file: readCachedSkillFile,
    list_cached_skills: listCachedSkills,
  };
}
