import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/server';
import { MAX_LINE_CHARS, runStdio } from '../src/stdio';

function setup(): {
  input: PassThrough;
  written: () => string[];
  done: Promise<void>;
  logs: string[];
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const logs: string[] = [];
  const server = createMcpServer({
    name: 't',
    version: '1',
    instructions: '',
    tools: [],
    log: (m) => logs.push(m),
  });
  const done = runStdio({ input, output, server, log: (m) => logs.push(m) });
  return { input, written: () => chunks.join('').split('\n').filter(Boolean), done, logs };
}

const ping = (id: number): string => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });

describe('transport stdio', () => {
  it('une réponse par ligne, JSON valide, terminée par un saut de ligne', async () => {
    const { input, written, done } = setup();
    input.write(`${ping(1)}\n${ping(2)}\n`);
    input.end();
    await done;
    expect(written().map((line) => JSON.parse(line).id)).toEqual([1, 2]);
  });

  it('reconstitue un message reçu en plusieurs morceaux, ignore \\r et les lignes vides', async () => {
    const { input, written, done } = setup();
    input.write(ping(1).slice(0, 10));
    input.write(`${ping(1).slice(10)}\r\n\n   \n`);
    input.write(`${ping(2)}\n`);
    input.end();
    await done;
    expect(written().map((line) => JSON.parse(line).id)).toEqual([1, 2]);
  });

  it('traite un dernier message sans saut de ligne final, puis résout à la fermeture', async () => {
    const { input, written, done } = setup();
    input.end(ping(9));
    await done;
    expect(written().map((line) => JSON.parse(line).id)).toEqual([9]);
  });

  it('une notification ne produit aucune ligne de sortie', async () => {
    const { input, written, done } = setup();
    input.end('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await done;
    expect(written()).toEqual([]);
  });

  it('une ligne démesurée est jetée (journal sans contenu) et la suivante est traitée normalement', async () => {
    const { input, written, done, logs } = setup();
    input.write('x'.repeat(MAX_LINE_CHARS + 10));
    input.write(`suite de la ligne jetée\n${ping(3)}\n`);
    input.end();
    await done;
    expect(written().map((line) => JSON.parse(line).id)).toEqual([3]);
    expect(logs).toEqual(['a message exceeded the maximum size and was dropped']);
  });

  it('un JSON invalide reçoit une erreur de protocole, sans arrêter le flux', async () => {
    const { input, written, done } = setup();
    input.write('{pas du json\n');
    input.end(`${ping(4)}\n`);
    await done;
    const lines = written().map((line) => JSON.parse(line));
    expect(lines[0].error.code).toBe(-32700);
    expect(lines[1].id).toBe(4);
  });
});
