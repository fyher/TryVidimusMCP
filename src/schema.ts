/** Le sous-ensemble de JSON Schema que les outils utilisent : objets fermés, chaînes, entiers, booléens. */
export type JsonSchema =
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties: false;
      description?: string;
    }
  | {
      type: 'string';
      description?: string;
      enum?: string[];
      pattern?: string;
      minLength?: number;
      maxLength?: number;
      examples?: string[];
    }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: 'boolean'; description?: string };

/**
 * Les erreurs de validation d'une valeur, par chemin. Elles nomment le champ et la règle, **jamais la valeur reçue** :
 * un modèle peut y avoir mis un secret ou un texte long.
 */
export function validate(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  switch (schema.type) {
    case 'object':
      return validateObject(schema, value, path);
    case 'string':
      return validateString(schema, value, path);
    case 'integer':
      return validateInteger(schema, value, path);
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path}: must be a boolean`];
  }
}

function validateObject(
  schema: Extract<JsonSchema, { type: 'object' }>,
  value: unknown,
  path: string,
): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path}: must be an object`];
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const name of schema.required ?? []) {
    if (record[name] === undefined) errors.push(`${path}.${name}: is required`);
  }
  for (const [name, field] of Object.entries(record)) {
    const known = schema.properties[name];
    if (!known) errors.push(`${path}.${name}: is not a known argument`);
    else if (field !== undefined) errors.push(...validate(known, field, `${path}.${name}`));
  }
  return errors;
}

function validateString(
  schema: Extract<JsonSchema, { type: 'string' }>,
  value: unknown,
  path: string,
): string[] {
  if (typeof value !== 'string') return [`${path}: must be a string`];
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${path}: must have at least ${schema.minLength} characters`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${path}: must have at most ${schema.maxLength} characters`);
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match the expected format`);
  }
  return errors;
}

function validateInteger(
  schema: Extract<JsonSchema, { type: 'integer' }>,
  value: unknown,
  path: string,
): string[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) return [`${path}: must be an integer`];
  const errors: string[] = [];
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: must be at least ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${path}: must be at most ${schema.maximum}`);
  }
  return errors;
}
