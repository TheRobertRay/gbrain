import { afterEach, describe, expect, test } from 'bun:test';
import {
  __setChatTransportForTests,
  resetGateway,
  type ChatResult,
} from '../src/core/ai/gateway.ts';
import { extractFactsFromTurnWithOutcome } from '../src/core/facts/extract.ts';

afterEach(() => {
  __setChatTransportForTests(null);
  resetGateway();
});

function stubFacts(facts: unknown[]): void {
  __setChatTransportForTests(async (): Promise<ChatResult> => ({
    text: JSON.stringify({ facts }),
    blocks: [],
    stopReason: 'end',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    },
    model: 'test:stub',
    providerId: 'test',
  }));
}

async function extract() {
  return extractFactsFromTurnWithOutcome({
    turnText: 'Conversation segment under test.',
    source: 'test:salvage',
  });
}

describe('facts extractor candidate salvage (#3866)', () => {
  test('agent-session memory drops one-day plans while keeping recurring intent', async () => {
    stubFacts([
      { fact: 'The user plans to meditate tomorrow morning', kind: 'commitment', evidence: 'I plan to meditate tomorrow morning' },
      { fact: 'The user wants to meditate more regularly', kind: 'preference', evidence: 'I want to meditate more regularly' },
    ]);
    const outcome = await extractFactsFromTurnWithOutcome({
      turnText: 'User: I plan to meditate tomorrow morning. I want to meditate more regularly.',
      source: 'test:agent-session',
      requireEvidence: true,
      evidenceTexts: ['I plan to meditate tomorrow morning. I want to meditate more regularly.'],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.facts.map((fact) => fact.fact)).toEqual(['The user wants to meditate more regularly']);
  });
  test('agent-session evidence must quote actual User words', async () => {
    stubFacts([{ fact: 'User owns a yacht', kind: 'fact', evidence: 'owns a yacht' }]);
    const rejected = await extractFactsFromTurnWithOutcome({
      turnText: 'User: I prefer a quiet apartment',
      source: 'test:agent-session',
      requireEvidence: true,
      evidenceTexts: ['I prefer a quiet apartment'],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe('malformed_output');

    stubFacts([{ fact: 'User prefers a quiet apartment', kind: 'preference', evidence: 'I prefer a quiet apartment' }]);
    const accepted = await extractFactsFromTurnWithOutcome({
      turnText: 'User: I prefer a quiet apartment',
      source: 'test:agent-session',
      requireEvidence: true,
      evidenceTexts: ['I prefer a quiet apartment'],
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.facts[0]?.context).toContain('I prefer a quiet apartment');
      expect(accepted.facts[0]?.context).toContain('Machine-extracted candidate');
    }

    stubFacts([{ fact: 'The rent increase occurred', kind: 'event', evidence: 'it definitely happened.' }]);
    const contextual = await extractFactsFromTurnWithOutcome({
      turnText: 'User: On the rent increase part, it definitely happened.',
      source: 'test:agent-session',
      requireEvidence: true,
      evidenceTexts: ['On the rent increase part, it definitely happened.'],
    });
    expect(contextual.ok).toBe(true);
    if (contextual.ok) expect(contextual.facts[0]?.context).toContain('rent increase part');

    stubFacts([
      { fact: 'User owns a yacht', kind: 'fact', evidence: 'owns a yacht' },
      { fact: 'User prefers a quiet apartment', kind: 'preference', evidence: 'I prefer a quiet apartment' },
    ]);
    const salvaged = await extractFactsFromTurnWithOutcome({
      turnText: 'User: I prefer a quiet apartment',
      source: 'test:agent-session',
      requireEvidence: true,
      evidenceTexts: ['I prefer a quiet apartment'],
    });
    expect(salvaged.ok).toBe(true);
    if (salvaged.ok) expect(salvaged.facts.map((fact) => fact.fact)).toEqual(['User prefers a quiet apartment']);
  });
  test('keeps valid facts when another candidate is malformed', async () => {
    stubFacts([
      {
        fact: 'The migration completed',
        kind: 'event',
        entity: null,
        confidence: 1.0,
        notability: 'high',
      },
      {
        fact: 'This candidate has no valid kind',
        kind: null,
      },
    ]);

    const outcome = await extract();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.facts).toHaveLength(1);
    expect(outcome.facts[0]!.fact).toBe('The migration completed');
  });

  test('keeps malformed_output when every candidate is invalid', async () => {
    stubFacts([
      { fact: 'Missing kind', kind: null },
      { fact: null, kind: 'fact' },
    ]);

    const outcome = await extract();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('malformed_output');
      // The outcome names the resolved model so failure surfaces (absorb log,
      // warn lines) can tell the operator WHICH model misbehaved.
      expect(typeof outcome.model).toBe('string');
    }
  });

  test('keeps an explicitly empty array as a successful empty result', async () => {
    stubFacts([]);

    expect(await extract()).toEqual({ ok: true, facts: [] });
  });
});
