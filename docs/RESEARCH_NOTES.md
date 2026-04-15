# Research notes

## Official skills.sh docs

Key takeaways:

- skills are installed primarily via `npx skills add ...`
- leaderboard ranking is driven by anonymous installation telemetry
- the docs are intentionally lightweight and do not document a full public API surface

## Official CLI implementation

Useful implementation cues:

- search calls `https://skills.sh/api/search?q=<query>&limit=10`
- results are mapped to `name`, `id`, `source`, `installs`
- the CLI sorts by installs when presenting quick results
- fast installs use `https://skills.sh/api/download/<owner>/<repo>/<slug>`
- official slug generation uses lowercase, space-to-dash conversion, removal of non-alphanumeric characters, and dash cleanup

## Official `find-skills` guidance

Important recommendation:

- do **not** recommend a skill solely from search results
- verify install count, source reputation, and repository quality signals before making a strong recommendation

This server mirrors that guidance by using install count only as a tie-breaker and refusing to auto-select low-confidence matches.

## Similar projects reviewed

### Skills-ContextManager

The strongest reusable idea is the small tool surface:

- load defaults
- list available skills
- load a specific skill on demand

That supports a clear separation between discovery and loading.

### agent-skill-loader

The strongest reusable ideas are:

- separate discovery from reading
- expose the main instruction file and support extra file reads
- keep the implementation MCP-first and local

## MCP transport choice

The current MCP spec treats stdio and Streamable HTTP as the two standard transports.

Decision taken here:

- implement stdio directly
- keep the server wrapper-friendly
- recommend `lazy-mcp` for Streamable HTTP instead of building another transport layer into this package

## Why no MCP SDK dependency here

The TypeScript SDK ecosystem is still in a transition period between production v1.x and in-development v2.

For a small local server, a manual newline-delimited JSON-RPC implementation is stable enough and avoids dependency churn.
