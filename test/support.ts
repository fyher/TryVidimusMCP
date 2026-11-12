import { createApiClient, type ApiClient } from '@tryvidimus/api-client';

export const KEY = `sk_test_${'a'.repeat(43)}`;

export const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

export const problem = (
  status: number,
  code: string,
  title: string,
  headers: Record<string, string> = {},
): Response =>
  json(
    { type: 'x', title, status, code },
    { status, headers: { 'content-type': 'application/problem+json', ...headers } },
  );

export type Call = { method: string; url: URL; body: unknown; authorization: string | undefined };

/** Un client d'API branché sur un `fetch` factice : enregistre les appels, répond dans l'ordre (la dernière réponse se répète). */
export function fakeClient(...responses: Response[]): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = ((input: string, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers['Authorization'],
    });
    const response = responses[Math.min(index, responses.length - 1)] ?? json({});
    index += 1;
    return Promise.resolve(response.clone());
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'https://api.example.com', apiKey: KEY, fetch: fetchImpl }),
    calls,
  };
}
