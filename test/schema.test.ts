import { describe, expect, it } from 'vitest';

import { validate, type JsonSchema } from '../src/schema';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^prf_[0-9a-z]+$' },
    party: { type: 'string', enum: ['provider', 'recipient'] },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    note: { type: 'string', minLength: 2, maxLength: 5 },
    flag: { type: 'boolean' },
  },
  required: ['id'],
  additionalProperties: false,
};

describe('validate', () => {
  it('accepte une entrée correcte', () => {
    expect(
      validate(schema, { id: 'prf_abc', party: 'provider', limit: 10, note: 'ok', flag: true }),
    ).toEqual([]);
  });

  it('refuse, avec le chemin du champ et la règle', () => {
    expect(validate(schema, {})).toEqual(['arguments.id: is required']);
    expect(validate(schema, { id: 'x' })).toEqual([
      'arguments.id: does not match the expected format',
    ]);
    expect(validate(schema, { id: 'prf_a', party: 'other' })[0]).toContain(
      'must be one of provider, recipient',
    );
    expect(validate(schema, { id: 'prf_a', limit: 0 })).toEqual([
      'arguments.limit: must be at least 1',
    ]);
    expect(validate(schema, { id: 'prf_a', limit: 51 })).toEqual([
      'arguments.limit: must be at most 50',
    ]);
    expect(validate(schema, { id: 'prf_a', limit: 1.5 })).toEqual([
      'arguments.limit: must be an integer',
    ]);
    expect(validate(schema, { id: 'prf_a', note: 'a' })).toEqual([
      'arguments.note: must have at least 2 characters',
    ]);
    expect(validate(schema, { id: 'prf_a', note: 'abcdef' })).toEqual([
      'arguments.note: must have at most 5 characters',
    ]);
    expect(validate(schema, { id: 'prf_a', flag: 'yes' })).toEqual([
      'arguments.flag: must be a boolean',
    ]);
    expect(validate(schema, { id: 'prf_a', unknown: 1 })).toEqual([
      'arguments.unknown: is not a known argument',
    ]);
  });

  it.each([null, [], 'texte', 3])('refuse un argument qui n’est pas un objet : %j', (value) => {
    expect(validate(schema, value)).toEqual(['arguments: must be an object']);
  });

  it('un type inattendu est signalé, et la valeur reçue n’est JAMAIS reprise dans le message', () => {
    const secret = 'sk_test_do-not-leak';
    const messages = [
      ...validate(schema, { id: 12 }),
      ...validate(schema, { id: 'prf_a', party: secret }),
      ...validate(schema, { id: secret }),
    ];
    expect(messages.join(' ')).not.toContain(secret);
    expect(messages[0]).toBe('arguments.id: must be a string');
  });

  it('un champ facultatif absent ou `undefined` passe', () => {
    expect(validate(schema, { id: 'prf_a', limit: undefined })).toEqual([]);
  });
});
