import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceHarness } from './helpers/serviceHarness.ts';

test('notes receive successive permanent NP print codes and keep them on reprint', async () => {
  const h = await serviceHarness('src/services/notePerceptionDocumentCode.ts');
  h.records.set('notesPerception/old', {});
  h.records.set('notesPerception/new', {});
  assert.equal(await h.api.issueNotePerceptionDocumentCode('old'), 'NP000001');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('old'), 'NP000001');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('new'), 'NP000002');
  assert.equal(h.records.get('counters/npDocuments').currentSequence, 2);
});
test('missing notes and denied counters cannot produce a print code', async () => {
  const h = await serviceHarness('src/services/notePerceptionDocumentCode.ts');
  await assert.rejects(h.api.issueNotePerceptionDocumentCode('missing'), /existe/);
  h.records.set('notesPerception/n', {});
  h.denied.add('counters/');
  await assert.rejects(h.api.issueNotePerceptionDocumentCode('n'), /Permission/);
  assert.equal(h.records.has('npDocuments/n'), false);
});

test('new notes for the same taxpayer get distinct codes and interleaved reprints retain each original', async () => {
  const h = await serviceHarness('src/services/notePerceptionDocumentCode.ts');
  for (const id of ['first', 'second', 'third']) {
    h.records.set(`notesPerception/${id}`, {
      taxateur: { contribuableId: 'same-taxpayer', contribuableName: 'Same Taxpayer' },
    });
  }
  assert.equal(await h.api.issueNotePerceptionDocumentCode('first'), 'NP000001');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('second'), 'NP000002');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('first'), 'NP000001');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('third'), 'NP000003');
  assert.equal(await h.api.issueNotePerceptionDocumentCode('second'), 'NP000002');
  assert.equal(h.records.get('counters/npDocuments').currentSequence, 3);

  // A fresh service instance reads the saved code; it does not rely on browser memory.
  const reopened = await serviceHarness('src/services/notePerceptionDocumentCode.ts');
  for (const [key, value] of h.records) reopened.records.set(key, structuredClone(value));
  assert.equal(await reopened.api.issueNotePerceptionDocumentCode('first'), 'NP000001');
  assert.equal(await reopened.api.issueNotePerceptionDocumentCode('second'), 'NP000002');
  assert.equal(reopened.records.get('counters/npDocuments').currentSequence, 3);
});
