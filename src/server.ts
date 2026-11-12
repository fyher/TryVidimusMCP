import { asIncoming, ERROR_CODE, failure, success, type JsonRpcResponse } from './jsonrpc';
import { validate, type JsonSchema } from './schema';

/** Une erreur dont le message peut être montré tel quel au modèle (jamais d'information interne). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  /** Renvoie un objet JSON ; une `ToolError` devient une erreur d'outil lisible par le modèle. */
  handler(args: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type McpServerOptions = {
  name: string;
  version: string;
  instructions: string;
  tools: Tool[];
  /** Journal de diagnostic (stderr) : jamais de clé, de corps de requête ni de contenu de fichier. */
  log?: (message: string) => void;
};

/** Versions du protocole que ce serveur sait parler, de la plus récente à la plus ancienne. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

const MAX_RESULT_CHARS = 100_000;

export type McpServer = {
  /** Traite une ligne reçue ; renvoie la ligne de réponse, ou `undefined` (notification : pas de réponse). */
  handle(line: string): Promise<string | undefined>;
};

type Params = Record<string, unknown>;

const asParams = (params: unknown): Params =>
  params !== null && typeof params === 'object' && !Array.isArray(params) ? (params as Params) : {};

function toolResult(data: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(data, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    return toolFailure(
      'The result is too large. Narrow the request (filters, a smaller limit) and try again.',
    );
  }
  return { content: [{ type: 'text', text }], structuredContent: data };
}

function toolFailure(message: string): Record<string, unknown> {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function callTool(
  tool: Tool,
  args: unknown,
  log: (message: string) => void,
): Promise<Record<string, unknown>> {
  const given = args === undefined ? {} : args;
  const problems = validate(tool.inputSchema, given);
  // Une entrée invalide est une erreur d'outil (pas du protocole) : le modèle la lit et se corrige.
  if (problems.length > 0) return toolFailure(`Invalid arguments: ${problems.join('; ')}`);
  try {
    return toolResult(await tool.handler(given as Record<string, unknown>));
  } catch (error) {
    if (error instanceof ToolError) return toolFailure(error.message);
    log(
      `tool ${tool.name} failed unexpectedly (${error instanceof Error ? error.name : 'unknown'})`,
    );
    return toolFailure('Unexpected error. Nothing was changed by this call.');
  }
}

function initializeResult(options: McpServerOptions, params: Params): Record<string, unknown> {
  const asked = params['protocolVersion'];
  const version =
    SUPPORTED_PROTOCOL_VERSIONS.find((supported) => supported === asked) ??
    SUPPORTED_PROTOCOL_VERSIONS[0];
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: options.name, version: options.version },
    instructions: options.instructions,
  };
}

const toolList = (tools: Tool[]): Record<string, unknown> => ({
  tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  })),
});

type Session = { initialized: boolean };

async function dispatch(
  options: McpServerOptions,
  session: Session,
  request: { method: string; id: number | string; params: Params },
): Promise<JsonRpcResponse> {
  const { method, id, params } = request;
  if (method === 'initialize') {
    session.initialized = true;
    return success(id, initializeResult(options, params));
  }
  if (method === 'ping') return success(id, {});
  if (!session.initialized) {
    return failure(
      id,
      ERROR_CODE.invalidRequest,
      'The server is not initialized: send "initialize" first',
    );
  }
  if (method === 'tools/list') return success(id, toolList(options.tools));
  if (method === 'tools/call') {
    const tool = options.tools.find((candidate) => candidate.name === params['name']);
    if (!tool) return failure(id, ERROR_CODE.invalidParams, 'Unknown tool');
    return success(
      id,
      await callTool(tool, params['arguments'], options.log ?? ((): void => undefined)),
    );
  }
  return failure(id, ERROR_CODE.methodNotFound, 'Method not found');
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const session: Session = { initialized: false };
  return {
    async handle(line: string): Promise<string | undefined> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return JSON.stringify(failure(null, ERROR_CODE.parse, 'Parse error'));
      }
      const message = asIncoming(parsed);
      if (!message)
        return JSON.stringify(failure(null, ERROR_CODE.invalidRequest, 'Invalid request'));
      // Une notification (sans identifiant) n'attend jamais de réponse : « initialized », « cancelled »…
      if (message.id === undefined) return undefined;
      const request = { method: message.method, id: message.id, params: asParams(message.params) };
      return JSON.stringify(await dispatch(options, session, request));
    },
  };
}
