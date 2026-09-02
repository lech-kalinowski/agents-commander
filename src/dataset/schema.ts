const message = {
  type: 'object', additionalProperties: false, required: ['role', 'content'],
  properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string', minLength: 1 } },
};
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = { type: 'string', minLength: 1 };
export const TRAINING_ROW_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:agents-commander:training-row:1',
  type: 'object', additionalProperties: false, required: ['prompt', 'completion'],
  properties: {
    prompt: { type: 'array', minItems: 1, maxItems: 128, items: message },
    completion: { type: 'array', minItems: 1, maxItems: 1, items: { ...message, properties: { ...message.properties, role: { const: 'assistant' } } } },
  },
};
export const CANDIDATE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:agents-commander:candidate:1',
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'id', 'captureId', 'projectId', 'synthetic', 'syntheticConditioning', 'sessionId', 'emissionId', 'eventId', 'sequence', 'sourceEventIds', 'capabilityRef', 'capabilityOwners', 'verb', 'coverage', 'prompt', 'completion'],
  properties: {
    schemaVersion: { const: 1 }, id: text, captureId: text, projectId: text, synthetic: { type: 'boolean' }, syntheticConditioning: { type: 'boolean' },
    sessionId: text, emissionId: text, eventId: text, sequence: { type: 'integer', minimum: 1 },
    sourceEventIds: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    capabilityRef: { type: 'string', pattern: '^cap_[1-9][0-9]*$' },
    capabilityOwners: { type: 'object', propertyNames: { pattern: '^cap_[1-9][0-9]*$' }, additionalProperties: text },
    verb: { enum: ['send', 'reply', 'broadcast', 'status', 'query'] }, targetAgent: text,
    targetPanel: { type: 'integer', minimum: 1, maximum: 1000000 }, coverage: { const: 'commander-visible' },
    ...TRAINING_ROW_SCHEMA.properties,
  },
};
export const REVIEW_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:agents-commander:review:1',
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'manifestSha256', 'decisions'],
  properties: {
    schemaVersion: { const: 1 }, manifestSha256: hash,
    decisions: { type: 'array', maxItems: 2000, items: {
      type: 'object', additionalProperties: false,
      required: ['candidateId', 'candidateSha256', 'approved', 'quality', 'context', 'privacy', 'rights', 'reviewer', 'reviewedAt', 'notes'],
      properties: {
        candidateId: text, candidateSha256: hash, approved: { type: 'boolean' }, quality: { type: 'boolean' },
        context: { type: 'boolean' }, privacy: { type: 'boolean' }, rights: { type: 'boolean' },
        reviewer: { type: 'string', maxLength: 200 }, reviewedAt: { type: ['string', 'null'], format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' },
        notes: { type: 'string', maxLength: 4000 },
      },
    } },
  },
};
