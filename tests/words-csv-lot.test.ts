/**
 * Reproduction tests for the French wording, the CSV export and the
 * cadastral lot number.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { amountInFrenchWords } from '../src/utils/frenchNumber.ts';
import { csvCell } from '../src/utils/csv.ts';
import { isRangIdValid, normalizeRangId } from '../src/utils/rangId.ts';

describe('the amount in words on an official slip', () => {
  test('keeps the sign on an amount below one unit', () => {
    // The slip prints the digits and the words side by side: "-0,50$" next to
    // "cinquante centimes" said the taxpayer both owed and was owed money.
    assert.match(amountInFrenchWords(-0.5), /^moins /);
    assert.match(amountInFrenchWords(-0.01), /^moins /);
    assert.match(amountInFrenchWords(-0.99), /^moins /);
  });

  test('keeps the sign on a whole amount', () => {
    assert.match(amountInFrenchWords(-1250), /^moins /);
    // Negative zero is zero: there is no sign to convey.
    assert.equal(amountInFrenchWords(-0), 'zéro dollar américain');
  });

  test('leaves a positive amount alone', () => {
    assert.equal(amountInFrenchWords(0.5), 'cinquante centimes');
    assert.equal(amountInFrenchWords(0), 'zéro dollar américain');
    assert.equal(amountInFrenchWords(1250), 'mille deux cent cinquante dollars américains');
  });

  test('the sign is present in every case', () => {
    for (const v of [-0.01, -0.5, -1, -1250.5, -1_250_000]) {
      assert.match(amountInFrenchWords(v), /^moins /, `${v} must keep its sign`);
    }
  });
});

describe('a CSV cell', () => {
  test('keeps a negative amount a number', () => {
    // Guarding the minus sign turned every refund and credit balance into a
    // text cell, and the spreadsheet stopped summing the column.
    assert.equal(csvCell(-1234.5), '"-1234.5"');
    assert.equal(csvCell(1234.5), '"1234.5"');
    assert.equal(csvCell(-0.01), '"-0.01"');
  });

  test('still neutralises a formula', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
    assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
    assert.equal(csvCell('+1'), '"\'+1"');
  });

  test('does not mistake text for a number', () => {
    // "-abc" is not a number, so it still has to be guarded.
    assert.equal(csvCell('-abc'), '"\'-abc"');
  });

  test('quotes and doubles embedded quotes', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  });
});

describe('a cadastral lot number', () => {
  test('the same lot has one spelling', () => {
    assert.equal(normalizeRangId('012'), '12');
    assert.equal(normalizeRangId('0012'), '12');
    assert.equal(normalizeRangId(' 012 '), '12');
    assert.equal(normalizeRangId('12'), '12');
    assert.equal(normalizeRangId('0'), '0');
  });

  test('two spellings of one lot can never be filed apart', () => {
    assert.equal(normalizeRangId('012'), normalizeRangId('12'));
    assert.equal(normalizeRangId('00012'), normalizeRangId('12'));
  });

  test('a lot number is still validated as a whole number', () => {
    assert.equal(isRangIdValid('12'), true);
    assert.equal(isRangIdValid('012'), true);
    assert.equal(isRangIdValid('12a'), false);
    assert.equal(isRangIdValid(''), false);
    assert.equal(isRangIdValid('1234567'), false);
  });
});
