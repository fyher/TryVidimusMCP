// Fabrique le paquet npm dans `dist-npm/` : `pnpm build:npm`. Ne publie rien.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-npm');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const SHEBANG = '#!/usr/bin/env node\n';
// Les dépendances CommonJS embarquées ont parfois besoin de `require` : on le recrée dans le fichier ESM.
const REQUIRE_SHIM =
  "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);\n";

const source = read(join(ROOT, 'package.json'));
const server = existsSync(join(ROOT, 'server.json')) ? read(join(ROOT, 'server.json')) : undefined;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [join(ROOT, 'bin/tryvidimus-mcp.ts')],
  outfile: join(OUT, 'dist/tryvidimus-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  banner: { js: SHEBANG + REQUIRE_SHIM },
  metafile: true,
  logLevel: 'warning',
});

// Un exécutable qui contient du code tiers doit en garder les licences : esbuild retire les commentaires de licence, on écrit donc le texte de chacune.
const modules = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
  if (match) modules.set(match[2], resolve(ROOT, match[1]));
}
const sections = [...modules.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, dir]) => {
    const real = realpathSync(dir);
    const manifest = read(join(real, 'package.json'));
    const file = readdirSync(real).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    if (!file) throw new Error(`${name} : aucun fichier de licence, impossible de l'embarquer`);
    return `## ${name} ${manifest.version} (${manifest.license})\n\n${readFileSync(join(real, file), 'utf8').trim()}\n`;
  });
writeFileSync(
  join(OUT, 'THIRD_PARTY_LICENSES.md'),
  `# Third-party licenses\n\nThis program contains the following open-source code, under its own license.\n\n${sections.join('\n')}`,
);

const manifest = {
  name: '@tryvidimus/mcp',
  version: source.version,
  description: 'MCP server for tryVidimus: let an AI assistant open captures, read proofs and verify them.',
  license: 'MIT',
  homepage: 'https://tryvidimus.com',
  keywords: ['tryvidimus', 'mcp', 'model-context-protocol', 'claude'],
  engines: { node: '>=22' },
  bin: { 'tryvidimus-mcp': 'dist/tryvidimus-mcp.mjs' },
  files: ['dist', 'README.md', 'LICENSE', 'THIRD_PARTY_LICENSES.md'],
  publishConfig: { access: 'public' },
  ...(server ? { mcpName: server.name } : {}),
};
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(ROOT, 'LICENSE'), join(OUT, 'LICENSE'));
cpSync(join(ROOT, 'PACKAGE_README.md'), join(OUT, 'README.md'));
console.log(`paquet écrit dans ${OUT}`);
