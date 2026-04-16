# Implementation plan

## Goal

Build a minimal, local MCP server that can dynamically search, load, and cache skills from `https://skills.sh/`, without overengineering the transport or deployment model.

## Constraints

- local process first
- stdio MCP transport by default
- package should be installable locally and runnable via Node
- Streamable HTTP should be handled by an external wrapper, not built into this server
- avoid heavy dependencies and avoid cloning full repositories for the MVP
- use caching to keep repeated loads fast and resilient

## Research summary that drives the design

### skills.sh

- the official CLI already uses a public search API pattern at `skills.sh/api/search`
- the official fast-install path uses `skills.sh/api/download/<owner>/<repo>/<slug>`
- install counts are derived from anonymous CLI telemetry and drive leaderboard/popularity
- the `find-skills` skill explicitly warns against choosing solely from search results

### similar projects

#### One-Man-Company/Skills-ContextManager

Useful idea:

- keep the tool surface small
- separate discovery from on-demand loading

What we keep:

- small set of MCP tools
- dynamic loading on demand

What we do not copy:

- web UI
- broad skill/workflow management system

#### back1ply/agent-skill-loader

Useful idea:

- expose skills through a tiny tool set
- allow reading the main instruction file and extra files separately

What we keep:

- list/search first, then read/load
- explicit file reads for auxiliary files

What we do not copy:

- multi-path local library management
- install-to-workspace behavior

## Architecture

### 1. transport

Implement a manual stdio MCP server using newline-delimited JSON-RPC 2.0.

Why:

- no runtime dependency on a fast-moving SDK
- works with standard MCP clients
- easiest to wrap with `lazy-mcp` later

Supported MCP methods:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list` returns empty
- `prompts/list` returns empty

### 2. skills.sh integration

Implement a very small client:

- `searchSkills(query, limit)` -> `GET /api/search`
- `downloadSkill(ref)` -> `GET /api/download/<owner>/<repo>/<slug>`

No git clone and no GitHub Trees API for the MVP.

Reason:

- the direct download API already returns file contents
- fewer moving parts
- easier testing

### 3. cache layer

#### search cache

- key: hash of `{ query, limit }`
- TTL-based
- default TTL: 15 minutes

#### skill bundle cache

- key: canonical skill id `owner/repo/slug`
- cached indefinitely until explicit refresh
- stores:
  - manifest metadata
  - extracted `SKILL.md` path
  - materialized files on disk
  - content hash from skills.sh

Offline behavior:

- if a skill is already cached, loading works without network unless `refresh=true`

### 4. ranking policy

Use a hybrid ranking policy:

#### candidate retrieval

Use only `skills.sh/api/search` for candidate retrieval.

#### local ranking signals

- exact id match
- exact slug match
- exact name match
- token overlap across:
  - name
  - slug
  - full id
  - source
- cached description overlap when available
- install count tie-breaker
- small trusted-owner boost

#### auto-select rule

Auto-select only when:

- exact or near-exact match, or
- top candidate clearly separates from the next one

Otherwise:

- return top candidates
- require explicit choice

### 5. MCP tool design

#### `search_skills`

Inputs:

- `query`
- `limit?`
- `refresh?`

Returns:

- ranked candidates
- recommended candidate
- confidence
- `autoSelectable`
- selection policy summary

#### `load_skill`

Inputs:

- `skillRef?`
- `query?`
- `autoSelect?`
- `refresh?`
- `includeFiles?`

Behavior:

- explicit ref -> load directly
- query -> run search, auto-load only if high confidence
- otherwise return `needsDisambiguation: true`

#### `read_cached_skill_file`

Inputs:

- `skillRef`
- `path`

Returns one cached file.

#### `list_cached_skills`

Returns manifest summaries of locally cached skills.

## Security and safety checks

- reject unsafe relative file paths from remote downloads
- do not write anything except protocol messages to stdout
- write debug logs only to stderr
- do not auto-load ambiguous search results
- require canonical ref or high-confidence query resolution

## Packaging plan

### deliverables

- source tree zip
- `npm pack` tarball for local install
- README with MCP config examples
- lazy-mcp wrapper example config

## Test plan

### unit tests

- skill ref parsing
- ranking policy
- cache behavior
- safe path enforcement

### integration-style tests

- mocked search + download flow
- query-based loading
- cache reuse on second load
- ambiguous query flow
- MCP request/response handling

## intentionally out of scope

- embedded Streamable HTTP server
- full `skills` CLI feature parity
- git cloning fallback
- repository star lookup
- security audit lookup
- user-facing web UI

## future extensions

- optional GitHub metadata enrichment when a client explicitly wants stronger ranking signals
- optional cache invalidation tool
- optional resource exposure for cached files
- optional structured trust policy profiles
- managed trusted-owner registry (versioned config and/or centrally managed source)
- optional owner trust tiers (`trusted`, `review_required`, `blocked`) with policy-driven auto-selection
