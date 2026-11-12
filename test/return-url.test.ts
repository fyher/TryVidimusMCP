import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/server';
import { createTools } from '../src/tools';
import { fakeClient, json, problem } from './support';

async function call(
  responses: Response[],
  args: unknown,
): Promise<{ result: Record<string, unknown>; calls: ReturnType<typeof fakeClient>['calls'] }> {
  const { client, calls } = fakeClient(...responses);
  const server = createMcpServer({
    name: 't',
    version: '1',
    instructions: '',
    tools: createTools({ client, verifyBundle: () => Promise.reject(new Error('non attendu')) }),
  });
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  const reply = await server.handle(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_capture_session', arguments: args },
    }),
  );
  return {
    result: (JSON.parse(reply as string) as { result: Record<string, unknown> }).result,
    calls,
  };
}

const SESSION = {
  id: 'cps_1',
  capture_url: 'https://c.example.com/t',
  expires_at: 'd',
  mode: 'test',
};
const valid = { external_reference: 'booking_1', party: 'provider' };

describe('create_capture_session : return_url', () => {
  it('la transmet à l’API', async () => {
    const { calls, result } = await call([json(SESSION, { status: 201 })], {
      ...valid,
      return_url: 'https://app.example.com/b/1/done',
    });
    expect(result['isError']).toBeFalsy();
    expect(calls[0]?.body).toMatchObject({ return_url: 'https://app.example.com/b/1/done' });
  });

  it('l’outil l’annonce, avec la consigne de ne pas deviner un site', () => {
    const { client } = fakeClient(json({}));
    const tool = createTools({ client, verifyBundle: () => Promise.reject(new Error('x')) }).find(
      (t) => t.name === 'create_capture_session',
    );
    const property = (
      tool?.inputSchema.properties as Record<string, { description: string; maxLength: number }>
    )['return_url'];
    expect(property?.maxLength).toBe(2048);
    expect(property?.description).toMatch(/do not guess/i);
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  });

  it('une adresse hors liste : l’erreur de l’API est rendue à l’agent, sans fuite', async () => {
    const { result } = await call(
      [
        problem(
          422,
          'return_url_not_allowed',
          "This return URL's site is not in your allowed return origins",
        ),
      ],
      { ...valid, return_url: 'https://evil.example.net/x' },
    );
    expect(result['isError']).toBe(true);
    const text = (result['content'] as { text: string }[])[0]?.text ?? '';
    expect(text).toMatch(/return_url_not_allowed|allowed return origins/);
  });

  it('une adresse de plus de 2048 caractères est refusée avant tout appel', async () => {
    const { result, calls } = await call([json(SESSION, { status: 201 })], {
      ...valid,
      return_url: `https://app.example.com/${'a'.repeat(2048)}`,
    });
    expect(result['isError']).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
