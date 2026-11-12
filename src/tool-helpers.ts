import { ApiError } from '@tryvidimus/api-client';

import { ToolError } from './server';

export const SLUG = '^[a-z0-9_.-]{1,64}$';
export const MAX_LIST = 50;
export const DEFAULT_LIST = 20;

/** Ce que le modèle peut lire d'une erreur de l'API : le code stable et la conduite à tenir, jamais un détail interne. */
export function describeApiError(error: ApiError): string {
  const advice: Record<string, string> = {
    invalid_api_key:
      'The API key is missing, invalid or revoked. Ask the user to check TRYVIDIMUS_API_KEY.',
    insufficient_scope:
      'This API key lacks the scope this tool needs. Ask the user to use a key that has it.',
    proof_not_found:
      'No proof with this identifier exists for this key (or it belongs to another mode).',
    invalid_locale:
      'The language is not a valid BCP 47 tag. Use a tag such as en, fr, es, de or pt-BR.',
    media_not_found: 'No file with this identifier exists in this proof.',
    template_not_found:
      'No active capture template has this id. List the templates, or create the session without `template_id`.',
    compare_to_not_found:
      'No proof with this id exists for this key (or it belongs to another mode). Check the id with list_proofs.',
    compare_to_not_sealed: 'The "before" proof is not sealed yet. Try again once it is sealed.',
    compare_to_mismatch:
      'The "before" proof must have the same external_reference and the same party as the new capture.',
    compare_to_is_after:
      'This proof is itself an "after"; a proof is either a "before" or an "after". Compare to the original.',
    compare_template_mismatch:
      'A follow-up capture uses the template of its "before": leave `template_id` out.',
    compare_to_already_used:
      'This "before" already has an "after": a proof has at most one partner. Do not retry.',
    proof_not_sealed: 'The proof is not sealed yet. Try again later; do not guess.',
    rate_limited: `Too many requests.${error.retryAfterSeconds ? ` Wait ${error.retryAfterSeconds} seconds before retrying.` : ''}`,
    invalid_request: `The request was refused${error.field ? ` (field: ${error.field})` : ''}. Check the arguments.`,
    network_error: 'The API could not be reached. Try again in a moment.',
  };
  return `API error ${error.status} ${error.code}. ${advice[error.code] ?? error.title}`;
}

/** Fait d'une erreur de l'API une erreur d'outil lisible ; toute autre erreur remonte telle quelle (message générique plus haut). */
export async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError) throw new ToolError(describeApiError(error));
    throw error;
  }
}

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
