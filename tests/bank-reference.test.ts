/**
 * A bank transfer reference pays one declaration.
 *
 * The claim on a reference is taken in the transaction that files the
 * confirmation, so two agents confirming at the same moment cannot both
 * acknowledge the same transfer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReference, referenceClaimId } from '../src/utils/bankReference.ts';

describe('a bank reference', () => {
  test('the same transfer always lands on the same claim', () => {
    assert.equal(
      referenceClaimId(normalizeReference('TRF-2026-000123')),
      referenceClaimId(normalizeReference('TRF-2026-000123'))
    );
  });

  test('case and repeated spacing do not make a new reference', () => {
    const one = referenceClaimId(normalizeReference('TRF 2026 000123'));
    assert.equal(one, referenceClaimId(normalizeReference('  trf 2026 000123  ')));
    assert.equal(one, referenceClaimId(normalizeReference('TRF   2026   000123')));
  });

  test('a different separator is a different reference', () => {
    // The bank prints one form of its slip number; a dash and a space are
    // part of the reference the bank issued, not a variation of the typing.
    assert.notEqual(
      referenceClaimId(normalizeReference('TRF-2026-000123')),
      referenceClaimId(normalizeReference('TRF 2026 000123'))
    );
  });

  test('two different transfers do not share a claim', () => {
    assert.notEqual(
      referenceClaimId(normalizeReference('TRF-2026-000123')),
      referenceClaimId(normalizeReference('TRF-2026-000124'))
    );
  });

  test('the claim id is a safe document id', () => {
    const id = referenceClaimId(normalizeReference('TRF/2026 #42'));
    assert.match(id, /^ref_[0-9a-z]+$/);
  });
});
