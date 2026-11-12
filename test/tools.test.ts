import { ApiError } from '@tryvidimus/api-client';
import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/server';
import { createTools, describeApiError, type ToolDeps } from '../src/tools';
import { fakeClient, json, KEY, problem } from './support';

type Verify = ToolDeps['verifyBundle'];

async function run(
  responses: Response[],
  name: string,
  args: unknown,
  extra: { verifyBundle?: Verify; trustChainPem?: string } = {},
): Promise<{ result: Record<string, unknown>; calls: ReturnType<typeof fakeClient>['calls'] }> {
  const { client, calls } = fakeClient(...responses);
  const verifyBundle: Verify =
    extra.verifyBundle ?? (() => Promise.reject(new Error('non attendu')));
  const server = createMcpServer({
    name: 't',
    version: '1',
    instructions: '',
    tools: createTools({
      client,
      verifyBundle,
      ...(extra.trustChainPem ? { trustChainPem: extra.trustChainPem } : {}),
    }),
  });
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  const reply = await server.handle(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  );
  return {
    result: (JSON.parse(reply as string) as { result: Record<string, unknown> }).result,
    calls,
  };
}

const textOf = (result: Record<string, unknown>): string =>
  (result['content'] as { text: string }[])[0]?.text ?? '';

describe('les neuf outils annoncés', () => {
  it('noms, indications de sécurité et description de chacun', () => {
    const { client } = fakeClient(json({}));
    const tools = createTools({ client, verifyBundle: () => Promise.reject(new Error('x')) });
    expect(tools.map((t) => t.name)).toEqual([
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
      expect(tool.description.length, tool.name).toBeGreaterThan(60);
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
    // Seul create_capture_session écrit quelque chose ; tous les autres sont en lecture seule.
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual([
      'create_capture_session',
    ]);
    expect(tools.every((t) => !t.annotations.destructiveHint)).toBe(true);
    expect(tools.find((t) => t.name === 'get_media_access_link')?.description).toMatch(
      /ONLY when the user explicitly asks/,
    );
  });
});

describe('crédits et modèles de capture (lecture seule)', () => {
  it('get_credits : appelle GET /v1/credits avec la clé et renvoie le solde', async () => {
    const answer = { balance: -2, granted: 10, consumed: 12 };
    const { result, calls } = await run([json(answer)], 'get_credits', {});
    expect(result['structuredContent']).toEqual(answer);
    expect(calls[0]).toMatchObject({ method: 'GET', authorization: `Bearer ${KEY}` });
    expect(calls[0]?.url.pathname).toBe('/v1/credits');
  });

  it('list_credit_transactions : 20 par défaut, filtre par type, curseur transmis', async () => {
    const page = { data: [], has_more: false, next_cursor: null };
    const { calls } = await run([json(page)], 'list_credit_transactions', {
      type: 'consumption',
      cursor: 'abc',
    });
    expect(calls[0]?.url.pathname).toBe('/v1/credits/transactions');
    expect(calls[0]?.url.search).toBe('?limit=20&type=consumption&cursor=abc');
  });

  it.each([[{ type: 'refund' }], [{ limit: 0 }], [{ limit: 51 }], [{ unknown: true }]])(
    'list_credit_transactions refuse %j sans appeler l’API',
    async (args) => {
      const { result, calls } = await run([json({})], 'list_credit_transactions', args);
      expect(result['isError']).toBe(true);
      expect(calls).toHaveLength(0);
    },
  );

  it('list_capture_templates : liste les modèles ; une clé sans le droit reçoit un conseil lisible', async () => {
    const answer = { data: [{ name: 'pickup_car', steps: [] }] };
    const ok = await run([json(answer)], 'list_capture_templates', {});
    expect(ok.result['structuredContent']).toEqual(answer);
    expect(ok.calls[0]?.url.pathname).toBe('/v1/capture-templates');
    const denied = await run(
      [problem(403, 'insufficient_scope', 'Forbidden')],
      'list_capture_templates',
      {},
    );
    expect(denied.result['isError']).toBe(true);
    expect(textOf(denied.result)).toMatch(/insufficient_scope.*lacks the scope/);
  });

  it('create_capture_session accepte `template_id` (un identifiant tpl_…) et le transmet', async () => {
    const answer = {
      id: 'cps_1',
      capture_url: 'https://c.example.com/t',
      expires_at: 'd',
      mode: 'test',
    };
    const { calls } = await run([json(answer, { status: 201 })], 'create_capture_session', {
      external_reference: 'booking_1',
      party: 'provider',
      template_id: 'tpl_01m4akapdbe8e8qq3er9r5qwyj',
    });
    expect(calls[0]?.body).toMatchObject({ template_id: 'tpl_01m4akapdbe8e8qq3er9r5qwyj' });
    const refused = await run([json({})], 'create_capture_session', {
      external_reference: 'booking_1',
      party: 'provider',
      template_id: 'pickup_car',
    });
    expect(refused.result['isError']).toBe(true);
    expect(refused.calls).toHaveLength(0);
  });

  it('create_capture_session transmet `locale` ; une étiquette invalide est refusée avant tout appel', async () => {
    const answer = {
      id: 'cps_1',
      capture_url: 'https://c.example.com/t',
      expires_at: 'd',
      mode: 'test',
    };
    const ok = await run([json(answer, { status: 201 })], 'create_capture_session', {
      external_reference: 'booking_1',
      party: 'provider',
      locale: 'pt-BR',
    });
    expect(ok.calls[0]?.body).toMatchObject({ locale: 'pt-BR' });
    for (const locale of ['english', 'pt_BR', '']) {
      const refused = await run([json({})], 'create_capture_session', {
        external_reference: 'booking_1',
        party: 'provider',
        locale,
      });
      expect(refused.result['isError'], locale).toBe(true);
      expect(refused.calls).toHaveLength(0);
    }
  });

  it('invalid_locale : conseil lisible', () => {
    const error = new ApiError({ status: 422, code: 'invalid_locale', title: 'x' });
    expect(describeApiError(error)).toMatch(/BCP 47/);
  });

  it('template_not_found : conseil lisible', () => {
    const error = new ApiError({ status: 422, code: 'template_not_found', title: 'x' });
    expect(describeApiError(error)).toMatch(/No active capture template has this id/);
  });
});

describe('create_capture_session', () => {
  it('appelle l’API avec la clé, une clé d’idempotence, et renvoie le lien', async () => {
    const answer = {
      id: 'cps_1',
      capture_url: 'https://capture.example.com/tok',
      expires_at: '2026-10-07T12:00:00.000Z',
      mode: 'test',
    };
    const { result, calls } = await run([json(answer, { status: 201 })], 'create_capture_session', {
      external_reference: 'booking_4471',
      party: 'provider',
      stage: 'pickup',
    });
    expect(result['structuredContent']).toEqual(answer);
    expect(calls[0]).toMatchObject({ method: 'POST', authorization: `Bearer ${KEY}` });
    expect(calls[0]?.url.pathname).toBe('/v1/capture-sessions');
    expect(calls[0]?.body).toEqual({
      external_reference: 'booking_4471',
      party: 'provider',
      stage: 'pickup',
    });
  });

  it('refuse un identifiant qui ressemble à un e-mail ou contient des espaces, sans appeler l’API', async () => {
    for (const reference of ['jean@exemple.fr', 'une réservation', '']) {
      const { result, calls } = await run([json({})], 'create_capture_session', {
        external_reference: reference,
        party: 'provider',
      });
      expect(result['isError'], reference).toBe(true);
      expect(calls).toHaveLength(0);
    }
  });
});

describe('list_proofs et get_proof', () => {
  it('list_proofs : 20 par défaut, filtres transmis, curseur transmis', async () => {
    const page = { data: [{ id: 'prf_1', status: 'sealed' }], has_more: true, next_cursor: 'c1' };
    const { result, calls } = await run([json(page)], 'list_proofs', {
      status: 'sealed',
      external_reference: 'booking_4471',
      cursor: 'c0',
    });
    expect(result['structuredContent']).toEqual(page);
    expect(calls[0]?.url.search).toBe(
      '?limit=20&status=sealed&external_reference=booking_4471&cursor=c0',
    );
  });

  it('list_proofs : une limite au-delà de 50 est refusée avant tout appel', async () => {
    const { result, calls } = await run([json({})], 'list_proofs', { limit: 500 });
    expect(result['isError']).toBe(true);
    expect(textOf(result)).toContain('arguments.limit: must be at most 50');
    expect(calls).toHaveLength(0);
  });

  it('get_proof : l’identifiant est encodé et contrôlé ; un identifiant hostile n’atteint jamais l’API', async () => {
    const { result, calls } = await run(
      [json({ id: 'prf_abc', status: 'processing' })],
      'get_proof',
      { proof_id: 'prf_abc' },
    );
    expect(result['structuredContent']).toMatchObject({ status: 'processing' });
    expect(calls[0]?.url.pathname).toBe('/v1/proofs/prf_abc');
    for (const hostile of ['../webhook-endpoints', 'prf_abc/../../x', 'PRF_ABC', 'prf_']) {
      const attempt = await run([json({})], 'get_proof', { proof_id: hostile });
      expect(attempt.result['isError'], hostile).toBe(true);
      expect(attempt.calls, hostile).toHaveLength(0);
    }
  });
});

describe('get_media_access_link et list_webhook_endpoints', () => {
  it('get_media_access_link : renvoie le lien temporaire', async () => {
    const link = {
      url: 'https://files.example.com/signed?x=1',
      expires_at: '2026-10-07T12:15:00.000Z',
    };
    const { result, calls } = await run([json(link)], 'get_media_access_link', {
      proof_id: 'prf_abc',
      media_id: 'med_def',
    });
    expect(result['structuredContent']).toEqual(link);
    expect(calls[0]?.url.pathname).toBe('/v1/proofs/prf_abc/media/med_def/access-link');
  });

  it('list_webhook_endpoints : aucun argument accepté', async () => {
    const { result, calls } = await run([json({ data: [] })], 'list_webhook_endpoints', {});
    expect(result['structuredContent']).toEqual({ data: [] });
    expect(calls[0]?.url.pathname).toBe('/v1/webhook-endpoints');
    expect((await run([json({})], 'list_webhook_endpoints', { x: 1 })).result['isError']).toBe(
      true,
    );
  });
});

describe('verify_proof', () => {
  const bundle = { version: 1, proof_id: 'prf_abc' };
  const verdict = (status: string): Awaited<ReturnType<Verify>> =>
    ({
      status,
      checks: { schema: { ok: true } },
      errors: [],
      timestamp: { genTime: new Date('2026-10-07T07:29:47.000Z') },
    }) as never;

  it('télécharge le paquet public (sans clé), le fait vérifier, et traduit le verdict', async () => {
    let received: unknown;
    const { result, calls } = await run(
      [json(bundle)],
      'verify_proof',
      { proof_id: 'prf_abc' },
      {
        verifyBundle: (b) => ((received = b), Promise.resolve(verdict('test_mode'))),
      },
    );
    expect(received).toEqual(bundle);
    expect(calls[0]?.url.pathname).toBe('/v1/public/proofs/prf_abc/bundle');
    expect(calls[0]?.authorization).toBeUndefined();
    const data = result['structuredContent'] as Record<string, unknown>;
    expect(data).toMatchObject({ proof_id: 'prf_abc', verdict: 'test_mode' });
    expect(String(data['meaning'])).toMatch(/no legal value/);
    // Les dates deviennent du JSON pur.
    expect((data['timestamp'] as { genTime: string }).genTime).toBe('2026-10-07T07:29:47.000Z');
  });

  it.each([
    ['valid', /can be relied on/],
    ['chain_unverified', /do not call the proof fully valid/],
    ['incomplete', /not sealed/],
    ['invalid', /Do NOT present this proof as valid/],
  ])('verdict %s : explication adaptée', async (status, meaning) => {
    const { result } = await run(
      [json(bundle)],
      'verify_proof',
      { proof_id: 'prf_abc' },
      { verifyBundle: () => Promise.resolve(verdict(status)) },
    );
    expect(String((result['structuredContent'] as { meaning: string }).meaning)).toMatch(meaning);
  });

  it('transmet la chaîne de confiance fournie ; sinon n’en invente pas', async () => {
    const seen: unknown[] = [];
    const verifyBundle: Verify = (_b, options) => (
      seen.push(options),
      Promise.resolve(verdict('valid'))
    );
    await run(
      [json(bundle)],
      'verify_proof',
      { proof_id: 'prf_abc' },
      { verifyBundle, trustChainPem: 'PEM' },
    );
    await run([json(bundle)], 'verify_proof', { proof_id: 'prf_abc' }, { verifyBundle });
    expect(seen).toEqual([{ trustChainPem: 'PEM' }, {}]);
  });

  it('preuve non scellée (409) : verdict « incomplete », pas une erreur d’outil', async () => {
    const { result } = await run(
      [problem(409, 'proof_not_sealed', 'The proof is not sealed yet')],
      'verify_proof',
      { proof_id: 'prf_abc' },
    );
    expect(result['isError']).toBeUndefined();
    expect(result['structuredContent']).toMatchObject({ verdict: 'incomplete' });
  });

  it('avec le vrai vérificateur, un paquet mal formé donne « invalid », jamais « valid »', async () => {
    const { verifyBundle } = await import('@tryvidimus/verifier');
    const { result } = await run(
      [json({ n: 'importe quoi' })],
      'verify_proof',
      { proof_id: 'prf_abc' },
      { verifyBundle },
    );
    expect(result['structuredContent']).toMatchObject({ verdict: 'invalid' });
  });
});

describe('erreurs de l’API', () => {
  it.each([
    [401, 'invalid_api_key', /check TRYVIDIMUS_API_KEY/],
    [403, 'insufficient_scope', /lacks the scope/],
    [404, 'proof_not_found', /No proof with this identifier/],
    [429, 'rate_limited', /Too many requests/],
  ])('%s %s : message d’aide, sans détail interne', async (status, code, advice) => {
    const { result } = await run(
      [problem(status, code, 'Titre', { 'retry-after': '12' })],
      'get_proof',
      { proof_id: 'prf_abc' },
    );
    expect(result['isError']).toBe(true);
    expect(textOf(result)).toMatch(advice);
    expect(textOf(result)).toContain(`${status} ${code}`);
    expect(textOf(result)).not.toContain(KEY);
  });

  it('429 : indique combien de secondes attendre', () => {
    const error = new ApiError({
      status: 429,
      code: 'rate_limited',
      title: 'Too many requests',
      retryAfterSeconds: 12,
    });
    expect(describeApiError(error)).toContain('Wait 12 seconds');
  });

  it('un code inconnu reprend le titre ; un champ fautif est nommé', () => {
    expect(
      describeApiError(new ApiError({ status: 418, code: 'teapot', title: 'I am a teapot' })),
    ).toBe('API error 418 teapot. I am a teapot');
    expect(
      describeApiError(
        new ApiError({ status: 422, code: 'invalid_request', title: 'x', field: 'stage' }),
      ),
    ).toContain('field: stage');
  });

  it('une erreur réseau devient un message d’aide, sans adresse ni clé', async () => {
    const { client } = fakeClient(json({}));
    const failingFetch = (() =>
      Promise.reject(new TypeError(`connect ECONNREFUSED ${KEY}`))) as unknown as typeof fetch;
    const { createApiClient } = await import('@tryvidimus/api-client');
    const broken = createApiClient({
      baseUrl: 'https://api.example.com',
      apiKey: KEY,
      fetch: failingFetch,
    });
    const server = createMcpServer({
      name: 't',
      version: '1',
      instructions: '',
      tools: createTools({ client: broken, verifyBundle: () => Promise.reject(new Error('x')) }),
    });
    void client;
    await server.handle(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    );
    const reply = await server.handle(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_proof', arguments: { proof_id: 'prf_abc' } },
      }),
    );
    expect(reply).toContain('could not be reached');
    expect(reply).not.toContain(KEY);
    expect(reply).not.toContain('ECONNREFUSED');
  });
});

describe('avant / après', () => {
  const created = {
    id: 'cps_1',
    capture_url: 'https://c.example.com/t',
    expires_at: 'd',
    mode: 'test',
    compare_to: 'prf_01m4akapdbe8e8qq3er9r5qwyj',
  };

  it('create_capture_session transmet `compare_to` ; un identifiant qui n’est pas prf_… est refusé avant tout appel', async () => {
    const ok = await run([json(created, { status: 201 })], 'create_capture_session', {
      external_reference: 'booking_1',
      party: 'provider',
      compare_to: 'prf_01m4akapdbe8e8qq3er9r5qwyj',
    });
    expect(ok.calls[0]?.body).toMatchObject({ compare_to: 'prf_01m4akapdbe8e8qq3er9r5qwyj' });
    const refused = await run([json({})], 'create_capture_session', {
      external_reference: 'booking_1',
      party: 'provider',
      compare_to: 'booking_1',
    });
    expect(refused.result['isError']).toBe(true);
    expect(refused.calls).toHaveLength(0);
  });

  it('un « avant » déjà complété : conseil lisible (ne pas réessayer)', async () => {
    const { result } = await run(
      [problem(409, 'compare_to_already_used', 'used')],
      'create_capture_session',
      {
        external_reference: 'booking_1',
        party: 'provider',
        compare_to: 'prf_01m4akapdbe8e8qq3er9r5qwyj',
      },
    );
    expect(result['isError']).toBe(true);
    expect(textOf(result)).toMatch(/compare_to_already_used.*at most one partner.*Do not retry/s);
  });

  it('list_proofs transmet `linked` (booléen → true/false), y compris false', async () => {
    const page = { data: [], has_more: false, next_cursor: null };
    const lonely = await run([json(page)], 'list_proofs', { linked: false });
    expect(lonely.calls[0]?.url.search).toContain('linked=false');
    const paired = await run([json(page)], 'list_proofs', { linked: true });
    expect(paired.calls[0]?.url.search).toContain('linked=true');
    const all = await run([json(page)], 'list_proofs', {});
    expect(all.calls[0]?.url.search).not.toContain('linked');
    const bad = await run([json(page)], 'list_proofs', { linked: 'maybe' });
    expect(bad.result['isError']).toBe(true);
    expect(bad.calls).toHaveLength(0);
  });
});

describe('list_capture_templates : pages', () => {
  const page = { data: [], has_more: true, next_cursor: 'c1' };

  it('transmet limit et cursor, 20 par défaut, et rend has_more / next_cursor', async () => {
    const first = await run([json(page)], 'list_capture_templates', {});
    expect(first.calls[0]?.url.search).toContain('limit=20');
    expect(first.result['structuredContent']).toMatchObject({ has_more: true, next_cursor: 'c1' });
    const next = await run([json(page)], 'list_capture_templates', { limit: 5, cursor: 'c1' });
    expect(next.calls[0]?.url.search).toContain('limit=5');
    expect(next.calls[0]?.url.search).toContain('cursor=c1');
  });

  it('une limite hors bornes est refusée avant tout appel', async () => {
    const refused = await run([json(page)], 'list_capture_templates', { limit: 500 });
    expect(refused.result['isError']).toBe(true);
    expect(refused.calls).toHaveLength(0);
  });
});
