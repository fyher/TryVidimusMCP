import type { ApiClient } from '@tryvidimus/api-client';

import type { Tool } from './server';
import { DEFAULT_LIST, MAX_LIST, READ_ONLY, guarded } from './tool-helpers';

type Deps = { client: ApiClient };

function getCreditsTool({ client }: Deps): Tool {
  return {
    name: 'get_credits',
    title: 'Get the credit balance',
    description:
      'Returns the credits of the account: `balance` (left), `granted` (added) and `consumed` (used). A credit is a unit of use with no price attached; sealing a proof in production consumes credits, the sandbox never does. The balance can be negative. Needs a key with the read_proof scope.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    handler: () => guarded(async () => ({ ...(await client.credits.get()) })),
  };
}

const TRANSACTIONS_INPUT: Tool['inputSchema'] = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['grant', 'consumption'],
      description: 'Only the credits added (grant) or only the credits used (consumption).',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIST,
      default: DEFAULT_LIST,
      description: `How many movements to return (1 to ${MAX_LIST}, ${DEFAULT_LIST} by default).`,
    },
    cursor: {
      type: 'string',
      maxLength: 300,
      description: 'The next_cursor of the previous page.',
    },
  },
  additionalProperties: false,
};

function listCreditTransactionsTool({ client }: Deps): Tool {
  return {
    name: 'list_credit_transactions',
    title: 'List credit movements',
    description:
      'Lists the credit movements of the account, newest first: credits added (grant) and credits used (consumption, with the proof that used them). Use `cursor` with the `next_cursor` of a previous answer to get the next page. Needs a key with the read_proof scope.',
    inputSchema: TRANSACTIONS_INPUT,
    annotations: READ_ONLY,
    handler: (args) =>
      guarded(async () => ({
        ...(await client.credits.transactions({
          limit: DEFAULT_LIST,
          ...(args as Parameters<ApiClient['credits']['transactions']>[0]),
        })),
      })),
  };
}

function listCaptureTemplatesTool({ client }: Deps): Tool {
  return {
    name: 'list_capture_templates',
    title: 'List capture templates',
    description:
      'Lists the capture templates of the organization: for each, its `id`, its label (`name`), its languages (`locales`), the shots the person is asked to take and its texts (a string, or one string per language). Use the `id` as `template_id` when you create a capture session. Archived templates are not listed. The list is paginated: pass the `next_cursor` of an answer as `cursor` to get the next page while `has_more` is true. Read-only: templates are created and changed from the API or the command line, not from here. Needs a key with the manage_templates scope.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST,
          default: DEFAULT_LIST,
          description: `How many templates to return (1 to ${MAX_LIST}, ${DEFAULT_LIST} by default).`,
        },
        cursor: {
          type: 'string',
          maxLength: 400,
          description: 'The next_cursor of the previous page.',
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handler: (args) =>
      guarded(async () => ({
        ...(await client.captureTemplates.list({
          limit: DEFAULT_LIST,
          ...(args as { limit?: number; cursor?: string }),
        })),
      })),
  };
}

/** Crédits et modèles de capture : trois outils en lecture seule (le seul outil qui écrit reste la création d'une session). */
export function createAccountTools(deps: Deps): Tool[] {
  return [getCreditsTool(deps), listCreditTransactionsTool(deps), listCaptureTemplatesTool(deps)];
}
