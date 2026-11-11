// Startup file for Hostinger's LiteSpeed Node runner (PassengerStartupFile). It is CommonJS because the runner
// require()s it; the server is an ES module with top-level await, so it is loaded with import().
// Settings come from ~/callit-app/.env, two folders up from this release; the environment wins over the file.
const path = require('node:path');
const fs = require('node:fs');

const envFile = process.env.CALLS_ENV_FILE || path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

process.env.NODE_ENV ??= 'production';
process.env.MIGRATIONS_DIR ??= path.join(__dirname, 'migrations');
process.env.PANEL_DIR ??= path.join(__dirname, 'panel');
process.env.APP_VERSION ??= require('./release.json').version;

import('./dist/main.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
