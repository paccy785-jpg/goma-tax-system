import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeRegisteredVisitor } from '../src/utils/receptionQueue.ts';
import type { ReceptionEntry } from '../src/types/index.ts';

const ticket = (id: string, status: ReceptionEntry['status'] = 'Waiting') => ({
  id, visitorName: 'Visitor', status,
} as ReceptionEntry);

test('listener arriving before save completion does not duplicate the visitor', () => {
  const saved = ticket('visit-1');
  const liveQueue = [saved];
  const result = includeRegisteredVisitor(liveQueue, saved);
  assert.equal(result.length, 1);
  assert.equal(result, liveQueue);
});

test('save arriving before listener adds one visitor and repeated completion adds none', () => {
  const saved = ticket('visit-1');
  const result = includeRegisteredVisitor([], saved);
  assert.equal(result.length, 1);
  assert.equal(includeRegisteredVisitor(result, saved).length, 1);
});

test('save completion preserves a newer live status and legitimate separate visits', () => {
  const liveQueue = [ticket('visit-1', 'InService'), ticket('visit-2')];
  const result = includeRegisteredVisitor(liveQueue, ticket('visit-1'));
  assert.equal(result.length, 2);
  assert.equal(result[0].status, 'InService');
  assert.equal(includeRegisteredVisitor(result, ticket('visit-3')).length, 3);
});
