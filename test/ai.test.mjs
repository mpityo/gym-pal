// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readResponse } from '../assets/js/ai.js';

const textBlock = (text) => ({ type: 'text', text });

test('readResponse returns plain text for a normal reply', () => {
  const data = { stop_reason: 'end_turn', content: [textBlock('Go light on the first set.')] };
  assert.equal(readResponse(data), 'Go light on the first set.');
});

test('readResponse parses JSON when a schema is given', () => {
  const data = { stop_reason: 'end_turn', content: [textBlock('{"headline":"ok","points":["a"],"next":"b"}')] };
  const schema = { type: 'object' };
  assert.deepEqual(readResponse(data, { schema }), { headline: 'ok', points: ['a'], next: 'b' });
});

test('readResponse throws "truncated" on max_tokens unless allowed', () => {
  const data = { stop_reason: 'max_tokens', content: [textBlock('partial')] };
  assert.throws(() => readResponse(data), (err) => err.code === 'truncated');
  assert.equal(readResponse(data, { allowTruncated: true }), 'partial');
});

test('readResponse throws "refused" on a refusal, before anything else matters', () => {
  const data = { stop_reason: 'refusal', content: [] };
  assert.throws(() => readResponse(data), (err) => err.code === 'refused');
});

test('readResponse throws "empty" on an empty reply', () => {
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: [] }), (err) => err.code === 'empty');
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: [textBlock('')] }), (err) => err.code === 'empty');
});

test('readResponse throws "bad-json" when the text is not valid JSON', () => {
  const data = { stop_reason: 'end_turn', content: [textBlock('not json')] };
  assert.throws(() => readResponse(data, { schema: { type: 'object' } }), (err) => err.code === 'bad-json');
});
