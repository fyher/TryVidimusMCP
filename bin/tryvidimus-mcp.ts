import { readFileSync } from 'node:fs';

import { runMcp, StartupError } from '../src/index';

// Point d'entrée : le seul endroit qui lit l'environnement, le disque et les flux du processus.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
const log = (message: string): void => void process.stderr.write(`tryvidimus-mcp: ${message}\n`);

try {
  const chainFile = process.env['TRYVIDIMUS_TRUST_CHAIN_FILE'];
  await runMcp({
    env: process.env,
    input: process.stdin,
    output: process.stdout,
    log,
    version,
    ...(chainFile ? { trustChainPem: readFileSync(chainFile, 'utf8') } : {}),
  });
} catch (error) {
  log(error instanceof StartupError ? error.message : 'could not start');
  process.exitCode = 1;
}
