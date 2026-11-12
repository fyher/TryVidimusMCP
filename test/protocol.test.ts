import { describe, expect, it } from 'vitest';

import { createMcpServer, SUPPORTED_PROTOCOL_VERSIONS, ToolError, type Tool } from '../src/server';

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', maxLength: 20 } },
    required: ['text'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args) => Promise.resolve({ echoed: args['text'] }),
};
const failing: Tool = {
  ...echo,
  name: 'refuse',
  handler: () => Promise.reject(new ToolError('Not allowed here.')),
};
const crashing: Tool = {
  ...echo,
  name: 'crash',
  handler: () => Promise.reject(new Error('boom postgres://user:pw@host')),
};
const huge: Tool = {
  ...echo,
  name: 'huge',
  handler: () => Promise.resolve({ blob: 'x'.repeat(200_000) }),
};

type Reply = {
  id: number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

async function session(logs: string[] = []): Promise<{
  call: (message: unknown) => Promise<Reply | undefined>;
  raw: (line: string) => Promise<string | undefined>;
}> {
  const server = createMcpServer({
    name: 'test',
    version: '1.2.3',
    instructions: 'Be careful.',
    tools: [echo, failing, crashing, huge],
    log: (m) => logs.push(m),
  });
  const raw = (line: string): Promise<string | undefined> => server.handle(line);
  const call = async (message: unknown): Promise<Reply | undefined> => {
    const reply = await raw(JSON.stringify(message));
    return reply === undefined ? undefined : (JSON.parse(reply) as Reply);
  };
  return { call, raw };
}

const replied = (line: string | undefined): string => {
  if (line === undefined) throw new Error('une réponse était attendue');
  return line;
};

const rpc = (id: number, method: string, params?: unknown): object => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const initialize = (id = 1, version = '2025-06-18'): object =>
  rpc(id, 'initialize', {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: 'client', version: '1' },
  });

describe('cycle de vie', () => {
  it('initialize : version négociée, capacité « outils » seulement, identité et consignes', async () => {
    const { call } = await session();
    const reply = await call(initialize());
    expect(reply?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test', version: '1.2.3' },
      instructions: 'Be careful.',
    });
    expect(Object.keys(reply?.result?.['capabilities'] as object)).toEqual(['tools']);
  });

  it.each(SUPPORTED_PROTOCOL_VERSIONS)('accepte la version %s telle quelle', async (version) => {
    const { call } = await session();
    expect((await call(initialize(1, version)))?.result?.['protocolVersion']).toBe(version);
  });

  it('une version inconnue : le serveur répond avec la sienne la plus récente', async () => {
    const { call } = await session();
    expect((await call(initialize(1, '2099-01-01')))?.result?.['protocolVersion']).toBe(
      SUPPORTED_PROTOCOL_VERSIONS[0],
    );
    expect(
      (await call(rpc(2, 'initialize', { capabilities: {} })))?.result?.['protocolVersion'],
    ).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it('avant initialize : ping répond, le reste est refusé', async () => {
    const { call } = await session();
    expect((await call(rpc(1, 'ping')))?.result).toEqual({});
    expect((await call(rpc(2, 'tools/list')))?.error?.code).toBe(-32600);
    expect(
      (await call(rpc(3, 'tools/call', { name: 'echo', arguments: { text: 'a' } })))?.error?.code,
    ).toBe(-32600);
  });

  it('les notifications (sans identifiant) ne reçoivent aucune réponse, connues ou non', async () => {
    const { call } = await session();
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    expect(
      await call({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }),
    ).toBeUndefined();
    expect(await call({ jsonrpc: '2.0', method: 'notifications/inconnue' })).toBeUndefined();
  });

  it('méthode inconnue : -32601 ; l’identifiant de la requête est repris (texte ou nombre)', async () => {
    const { call } = await session();
    await call(initialize());
    expect((await call(rpc(7, 'resources/list')))?.error).toEqual({
      code: -32601,
      message: 'Method not found',
    });
    const text = JSON.parse(
      replied(
        await (await session()).raw(JSON.stringify({ jsonrpc: '2.0', id: 'abc', method: 'ping' })),
      ),
    ) as Reply & { id: string };
    expect(text.id).toBe('abc');
  });
});

describe('messages invalides', () => {
  it('JSON illisible : -32700, identifiant null', async () => {
    const { raw } = await session();
    expect(JSON.parse(replied(await raw('{pas du json')))).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it.each([
    ['un lot (tableau)', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'],
    ['sans version jsonrpc', '{"id":1,"method":"ping"}'],
    ['méthode absente', '{"jsonrpc":"2.0","id":1}'],
    ['identifiant invalide', '{"jsonrpc":"2.0","id":{},"method":"ping"}'],
    ['pas un objet', '42'],
    ['null', 'null'],
  ])('%s : -32600', async (_name, line) => {
    const { raw } = await session();
    expect(JSON.parse(replied(await raw(line))).error.code).toBe(-32600);
  });
});

describe('outils', () => {
  async function ready(
    logs: string[] = [],
  ): Promise<(message: unknown) => Promise<Reply | undefined>> {
    const { call } = await session(logs);
    await call(initialize());
    return call;
  }

  it('tools/list : nom, titre, description, schéma d’entrée et indications de chaque outil', async () => {
    const call = await ready();
    const tools = (await call(rpc(2, 'tools/list')))?.result?.['tools'] as Record<
      string,
      unknown
    >[];
    expect(tools.map((t) => t['name'])).toEqual(['echo', 'refuse', 'crash', 'huge']);
    expect(tools[0]).toMatchObject({
      title: 'Echo',
      description: 'Echoes.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(tools[0]?.['inputSchema']).toMatchObject({
      type: 'object',
      required: ['text'],
      additionalProperties: false,
    });
    expect(tools[0]).not.toHaveProperty('handler');
  });

  it('tools/call : texte JSON et contenu structuré identiques', async () => {
    const call = await ready();
    const result = (
      await call(rpc(3, 'tools/call', { name: 'echo', arguments: { text: 'bonjour' } }))
    )?.result;
    expect(result?.['structuredContent']).toEqual({ echoed: 'bonjour' });
    expect(
      JSON.parse(((result?.['content'] as { text: string }[])[0] as { text: string }).text),
    ).toEqual({ echoed: 'bonjour' });
    expect(result).not.toHaveProperty('isError');
  });

  it('outil inconnu : erreur de protocole -32602', async () => {
    const call = await ready();
    expect((await call(rpc(4, 'tools/call', { name: 'nope', arguments: {} })))?.error?.code).toBe(
      -32602,
    );
    expect((await call(rpc(5, 'tools/call', {})))?.error?.code).toBe(-32602);
  });

  it('arguments invalides : erreur D’OUTIL (isError) que le modèle peut lire, sans reprendre la valeur reçue', async () => {
    const call = await ready();
    const bad = (await call(rpc(6, 'tools/call', { name: 'echo', arguments: { text: 12 } })))
      ?.result;
    expect(bad?.['isError']).toBe(true);
    expect(JSON.stringify(bad)).toContain('arguments.text: must be a string');
    const missing = (await call(rpc(7, 'tools/call', { name: 'echo' })))?.result;
    expect(JSON.stringify(missing)).toContain('arguments.text: is required');
    const extra = (
      await call(rpc(8, 'tools/call', { name: 'echo', arguments: { text: 'a', plus: 1 } }))
    )?.result;
    expect(JSON.stringify(extra)).toContain('is not a known argument');
  });

  it('une ToolError est montrée telle quelle ; toute autre erreur reste GÉNÉRIQUE (aucun détail interne) et est journalisée sans message', async () => {
    const logs: string[] = [];
    const call = await ready(logs);
    const refused = (await call(rpc(9, 'tools/call', { name: 'refuse', arguments: { text: 'a' } })))
      ?.result;
    expect(refused).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Not allowed here.' }],
    });
    const crashed = (await call(rpc(10, 'tools/call', { name: 'crash', arguments: { text: 'a' } })))
      ?.result;
    expect(crashed?.['isError']).toBe(true);
    expect(JSON.stringify(crashed)).not.toMatch(/boom|postgres|pw@host/);
    expect(logs.join(' ')).not.toMatch(/boom|postgres|pw@host/);
    expect(logs).toHaveLength(1);
  });

  it('un résultat trop gros est refusé avec une consigne, jamais tronqué en JSON invalide', async () => {
    const call = await ready();
    const result = (await call(rpc(11, 'tools/call', { name: 'huge', arguments: { text: 'a' } })))
      ?.result;
    expect(result?.['isError']).toBe(true);
    expect(JSON.stringify(result)).toContain('too large');
  });
});
