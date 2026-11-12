export type JsonRpcId = string | number;

export type JsonRpcError = { code: number; message: string; data?: unknown };

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: JsonRpcError };

/** Codes d'erreur du protocole (JSON-RPC 2.0). */
export const ERROR_CODE = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export const success = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

export const failure = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const isValidId = (id: unknown): id is JsonRpcId | undefined =>
  id === undefined || typeof id === 'string' || typeof id === 'number';

export type Incoming = { id?: JsonRpcId; method: string; params?: unknown };

/** Un message JSON-RPC entrant valide (requête ou notification), ou `null`. Les lots (tableaux) sont refusés par l'appelant. */
export function asIncoming(value: unknown): Incoming | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') return null;
  const id = message['id'];
  if (!isValidId(id)) return null;
  return {
    method: message['method'],
    ...(id !== undefined ? { id } : {}),
    ...(message['params'] !== undefined ? { params: message['params'] } : {}),
  };
}
