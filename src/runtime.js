import { CacheManager } from './cache.js';
import { createServer } from './server.js';
import { SkillsShClient } from './skills-sh-client.js';
import { createToolHandlers } from './tools.js';
import { getConfigFromEnv } from './util.js';
import { SERVER_NAME, SERVER_TITLE, VERSION } from './version.js';

export async function createApp(options = {}) {
  const env = getConfigFromEnv();
  const config = {
    baseUrl: options.baseUrl || env.baseUrl,
    cacheDir: options.cacheDir || env.cacheDir,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    fetchTimeoutMs: options.fetchTimeoutMs || env.fetchTimeoutMs,
    searchTtlMs: options.searchTtlMs || env.searchTtlMs,
    trustedOwners: options.trustedOwners || env.trustedOwners,
  };

  const cache = new CacheManager({
    rootDir: config.cacheDir,
    searchTtlMs: config.searchTtlMs,
  });
  await cache.init();

  const client = new SkillsShClient({
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl,
    timeoutMs: config.fetchTimeoutMs,
  });

  const handlers = createToolHandlers({
    client,
    cache,
    trustedOwners: config.trustedOwners,
  });

  const server = createServer({
    handlers,
    serverInfo: {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: VERSION,
    },
  });

  return {
    config,
    cache,
    client,
    handlers,
    server,
  };
}
