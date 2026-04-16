# skills-sh-mcp

A minimal MCP server that dynamically searches, loads, and caches skills from [skills.sh](https://skills.sh/).

This server is intentionally small:

- local stdio MCP server
- direct `skills.sh` API integration
- disk cache for search results and downloaded skill bundles
- no external runtime dependencies
- designed to run as a local `npx` or installed binary process
- optional Streamable HTTP wrapping via `lazy-mcp`

## Why this shape

The goal here is not to recreate the full `skills` CLI. It is to give an MCP client a small, dependable server that can:

1. search for relevant skills,
2. decide whether the top result is safe to auto-pick,
3. download and cache the selected skill,
4. return `SKILL.md` plus any extra files on demand.

## Search behavior

The public `skills.sh` search flow exposes install counts and basic identity fields, but not rich tags or full descriptions in the same shape as the downloaded package. Because of that, this server uses a hybrid strategy:

1. retrieve candidates from `skills.sh/api/search`
2. rank them locally using:
   - exact id, slug, and name matches
   - token overlap on skill name, slug, id, and source
   - cached description overlap when a skill was loaded before
   - install count as a tie-breaker
   - a small trusted-owner boost
3. auto-select **only** when the top candidate is high confidence
4. otherwise return the top candidates and require explicit selection

That means the server does **not** blindly choose the most-installed skill, and it does **not** assume search results alone are enough when the query is ambiguous.

## Exposed MCP tools

### `search_skills`
Search skills.sh and return:

- ranked candidates
- confidence level
- whether the top result is safe to auto-select
- the selection policy used by the server

### `load_skill`
Load and cache a skill by either:

- explicit ref: `owner/repo/slug`
- full skills.sh URL
- `owner/repo@Skill Name`
- search query

When loading by query, it only auto-loads if confidence is high. Otherwise it returns ranked candidates instead.

### `read_cached_skill_file`
Read an extra file from a cached skill package.

### `list_cached_skills`
List cached skill packages and metadata.

## Installation

### Option A: run directly from the source tree

```bash
node ./bin/skills-sh-mcp.js
```

### Option B: install from the packed tarball

```bash
npm install -g ./skills-sh-mcp-0.1.0.tgz
skills-sh-mcp
```

### Option C: use via `npx` after publishing internally

```bash
npx skills-sh-mcp
```

## MCP client configuration

Example stdio config:

```json
{
  "mcpServers": {
    "skills-sh": {
      "command": "node",
      "args": ["/absolute/path/to/skills-sh-mcp/bin/skills-sh-mcp.js"],
      "env": {
        "SKILLS_SH_CACHE_DIR": "/absolute/path/to/.cache/skills-sh-mcp"
      }
    }
  }
}
```

If you install the tarball globally, you can use:

```json
{
  "mcpServers": {
    "skills-sh": {
      "command": "skills-sh-mcp",
      "args": []
    }
  }
}
```

## Streamable HTTP via lazy-mcp

This project intentionally does **not** embed its own HTTP transport. If you want a Streamable HTTP endpoint, wrap it with `lazy-mcp`.

See:

- `docs/lazy-mcp.example.json`
- `docs/mcp-config.example.json`

## Environment variables

- `SKILLS_SH_BASE_URL` - override the skills.sh base URL, default `https://skills.sh`
- `SKILLS_SH_CACHE_DIR` - override the local cache directory
- `SKILLS_SH_FETCH_TIMEOUT_MS` - HTTP timeout, default `10000`
- `SKILLS_SH_SEARCH_TTL_MS` - search cache TTL, default `900000`
- `SKILLS_SH_TRUSTED_OWNERS` - comma-separated owner list, default `vercel-labs,anthropics,microsoft`
- `SKILLS_SH_MCP_DEBUG=1` - enable stderr debug logging

## Planned enhancements

- Add a managed trusted-owner policy source (for example a versioned config file or centrally managed config) instead of relying only on static defaults.
- Support owner trust tiers (`trusted`, `review_required`, `blocked`) to make auto-selection policy explicit and auditable.
- Add an optional strict mode where query-based auto-selection is allowed only for trusted owners.

## Cache layout

By default the cache lives under:

```text
~/.cache/skills-sh-mcp
```

Structure:

```text
search/
skills/
  <owner>__<repo>__<slug>/
    manifest.json
    files/
```

## Development

Run tests:

```bash
npm test
```

Run the server manually:

```bash
node ./bin/skills-sh-mcp.js
```

## Project docs

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/RESEARCH_NOTES.md`
- `docs/lazy-mcp.example.json`
- `docs/mcp-config.example.json`
