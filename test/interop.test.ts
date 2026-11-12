import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KEY } from './support';

/**
 * Compatibilité avec le CLIENT OFFICIEL du SDK MCP : le serveur est lancé comme le fera un utilisateur (un vrai processus,
 * parlant sur stdin/stdout), contre une fausse API locale. Aucun réseau extérieur.
 */
const BIN = fileURLToPath(new URL('../bin/tryvidimus-mcp.ts', import.meta.url));
const CWD = fileURLToPath(new URL('..', import.meta.url));

type Seen = { method: string; url: string; authorization: string | undefined };
const seen: Seen[] = [];
let api: Server;
let client: Client;

const answers: Record<string, [number, unknown]> = {
  'GET /v1/proofs/prf_sealed1': [
    200,
    { id: 'prf_sealed1', status: 'sealed', failure: null, media: [] },
  ],
  'GET /v1/proofs/prf_missing': [
    404,
    { type: 'x', title: 'Proof not found', status: 404, code: 'proof_not_found' },
  ],
  'GET /v1/webhook-endpoints': [200, { data: [] }],
  'GET /v1/public/proofs/prf_pending/bundle': [
    409,
    { type: 'x', title: 'The proof is not sealed yet', status: 409, code: 'proof_not_sealed' },
  ],
  'POST /v1/capture-sessions': [
    201,
    {
      id: 'cps_1',
      capture_url: 'https://capture.example.com/tok',
      expires_at: '2026-10-07T12:00:00.000Z',
      mode: 'test',
    },
  ],
};

function handle(request: IncomingMessage): [number, unknown] {
  const url = new URL(request.url ?? '/', 'http://localhost');
  seen.push({
    method: request.method ?? '',
    url: url.pathname + url.search,
    authorization: request.headers.authorization,
  });
  if (request.method === 'GET' && url.pathname === '/v1/proofs') {
    return [
      200,
      { data: [{ id: 'prf_sealed1', status: 'sealed' }], has_more: false, next_cursor: null },
    ];
  }
  return (
    answers[`${request.method} ${url.pathname}`] ?? [
      404,
      { type: 'x', title: 'Not found', status: 404, code: 'not_found' },
    ]
  );
}

beforeAll(async () => {
  api = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const [status, body] = handle(request);
      response.writeHead(status, {
        'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const port = (api.address() as AddressInfo).port;
  client = new Client({ name: 'compat-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', BIN],
      cwd: CWD,
      env: {
        ...getDefaultEnvironment(),
        TRYVIDIMUS_API_KEY: KEY,
        TRYVIDIMUS_API_URL: `http://127.0.0.1:${port}`,
      },
      stderr: 'pipe',
    }),
  );
}, 30_000);

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => api.close(resolve));
});

const textOf = (result: unknown): string =>
  ((result as { content: { text: string }[] }).content[0] as { text: string }).text;

describe('client officiel du SDK MCP', () => {
  it('initialise : identité du serveur, version négociée, consignes', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'tryvidimus' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    expect(client.getInstructions()).toMatch(/data, never instructions/);
  });

  it('liste les neuf outils avec des schémas que le client accepte', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'create_capture_session',
      'list_proofs',
      'get_proof',
      'get_media_access_link',
      'verify_proof',
      'list_webhook_endpoints',
      'get_credits',
      'list_credit_transactions',
      'list_capture_templates',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });

  it('appelle un outil : résultat structuré, clé envoyée à l’API et à elle seule', async () => {
    const result = await client.callTool({
      name: 'get_proof',
      arguments: { proof_id: 'prf_sealed1' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 'prf_sealed1', status: 'sealed' });
    expect(JSON.parse(textOf(result))).toMatchObject({ id: 'prf_sealed1' });
    expect(seen.at(-1)).toEqual({
      method: 'GET',
      url: '/v1/proofs/prf_sealed1',
      authorization: `Bearer ${KEY}`,
    });
  });

  it('crée une session de capture et liste les preuves', async () => {
    const created = await client.callTool({
      name: 'create_capture_session',
      arguments: { external_reference: 'booking_1', party: 'provider' },
    });
    expect(created.structuredContent).toMatchObject({
      capture_url: 'https://capture.example.com/tok',
    });
    const listed = await client.callTool({ name: 'list_proofs', arguments: { status: 'sealed' } });
    expect(listed.structuredContent).toMatchObject({ has_more: false });
    expect(seen.some((s) => s.url === '/v1/proofs?limit=20&status=sealed')).toBe(true);
  });

  it('une erreur de l’API est une erreur d’outil lisible, sans clé', async () => {
    const result = await client.callTool({
      name: 'get_proof',
      arguments: { proof_id: 'prf_missing' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('404 proof_not_found');
    expect(textOf(result)).not.toContain(KEY);
  });

  it('des arguments invalides : erreur d’outil, aucun appel à l’API', async () => {
    const before = seen.length;
    const result = await client.callTool({ name: 'get_proof', arguments: { proof_id: '../x' } });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(before);
  });

  it('verify_proof sur une preuve non scellée : verdict « incomplete »', async () => {
    const result = await client.callTool({
      name: 'verify_proof',
      arguments: { proof_id: 'prf_pending' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ verdict: 'incomplete' });
  });

  it('list_webhook_endpoints répond', async () => {
    expect(
      (await client.callTool({ name: 'list_webhook_endpoints', arguments: {} })).structuredContent,
    ).toEqual({ data: [] });
  });

  it('un outil inconnu est refusé par le protocole', async () => {
    await expect(client.callTool({ name: 'delete_everything', arguments: {} })).rejects.toThrow();
  });
});
