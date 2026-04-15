#!/usr/bin/env node
import { createApp } from '../src/runtime.js';
import { runStdioServer } from '../src/server.js';

const app = await createApp();
await runStdioServer(app.server);
