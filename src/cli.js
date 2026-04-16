#!/usr/bin/env node
import { createApp } from './runtime.js';
import { runStdioServer } from './server.js';

const app = await createApp();
await runStdioServer(app.server);
