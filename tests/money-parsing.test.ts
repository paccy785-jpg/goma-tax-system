/**
 * Reproduction tests for the money parsing / formatting layer.
 *
 * Run with:  node --import tsx --test tests/*.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, impotDu, TAUX_FIXE_PCT } from '../src/utils/taxCalc.ts';
import { formatMoney } from '../src/utils/money.ts';
import { roundMoney } from '../src/utils/frenchNumber.ts';

describe('parseAmount — thousand grouping', () => {
  test('reads a single French group as thousands, not as a decimal mark', () => {
    assert.equal(parseAmount('1,250'), 1250);
    assert.equal(parseAmount('12,500'), 12500);
    assert.equal(parseAmount('123,500'), 123500);
  });

  test('keeps a real decimal comma when the decimals are not a group of three', () => {
    assert.equal(parseAmount('1250,5'), 1250.5);
    assert.equal(parseAmount('0,500'), 0.5);
    assert.equal(parseAmount('1,5'), 1.5);
  });

  test('reads several comma groups as one number instead of dropping the tail', () => {
    // A US-dollar system: an officer grouping thousands with commas.
    assert.equal(parseAmount('1,250,500'), 1250500);
    assert.equal(parseAmount('12,500,000'), 12500000);
    assert.equal(parseAmount('123,456,789'), 123456789);
  });

  test('a grouped amount never comes back smaller than it was typed', () => {
    for (const raw of ['1,250,500', '12,500,000', '1,250,000,000']) {
      const parsed = parseAmount(raw);
      const digits = raw.replace(/\D/g, '');
      assert.equal(
        parsed,
        Number(digits),
        `parseAmount('${raw}') must equal the typed digits, got ${parsed}`
      );
    }
  });

  test('a negative grouped amount keeps both its sign and its digits', () => {
    assert.equal(parseAmount('-1,250'), -1250);
    assert.equal(parseAmount('-1,250,500'), -1250500);
    assert.equal(parseAmount('-12,500,000'), -12500000);
    assert.equal(parseAmount('-1,25'), -1.25);
    assert.equal(parseAmount('-1 250'), -1250);
  });

  test('the magnitude of a grouped amount never depends on its sign', () => {
    for (const raw of ['1,250', '1,250,500', '12,500,000', '123,500']) {
      assert.equal(
        parseAmount(`-${raw}`),
        -parseAmount(raw),
        `parseAmount('-${raw}') must be the negative of parseAmount('${raw}')`
      );
    }
  });
});

describe('parseAmount — rejections', () => {
  test('returns NaN rather than a wrong number for junk', () => {
    assert.ok(Number.isNaN(parseAmount('abc')));
    assert.ok(Number.isNaN(parseAmount('')));
    assert.ok(Number.isNaN(parseAmount('   ')));
    assert.ok(Number.isNaN(parseAmount('1e5')));
    assert.ok(Number.isNaN(parseAmount('12.34.56')));
  });
});

describe('the tax base an officer types', () => {
  // The amount fields are type="text" with inputMode="decimal", so the raw
  // text the officer typed reaches parseAmount untouched. "1,250,500" is what
  // a US-dollar system produces when someone groups thousands with commas.
  test('a grouped revenue is taxed on the whole amount', () => {
    const typed = '1,250,500';
    const revenuBrut = parseAmount(typed);
    assert.equal(revenuBrut, 1250500);
    // (3) Impôt dû = (1) Revenu brut × (2) Taux, at the fixed 15 %.
    assert.equal(impotDu(revenuBrut, TAUX_FIXE_PCT), 187575);
  });

  test('the amount the slip prints is the amount that was taxed', () => {
    const revenuBrut = parseAmount('1,250,500');
    assert.equal(formatMoney(revenuBrut), formatMoney(1250500));
  });
});

describe('formatMoney — rounding', () => {
  test('rounds a half-cent up, like the stored figure', () => {
    // roundMoney() is the value stored in Firestore; formatMoney() is what the
    // officer reads. They must never disagree on the same number.
    for (const v of [8.075, 10.075, 1234.565, 1.005, 2.675]) {
      assert.equal(
        formatMoney(v),
        formatMoney(roundMoney(v)),
        `formatMoney(${v}) must show the same figure roundMoney() stored (${roundMoney(v)})`
      );
    }
  });

  test('formats the documented examples', () => {
    // The group separator is a narrow no-break space (U+202F), so an amount
    // never wraps mid-number.
    assert.equal(formatMoney(105), '105$');
    assert.equal(formatMoney(1250), '1 250$');
    assert.equal(formatMoney(37.04), '37,04$');
    assert.equal(formatMoney(-60), '-60$');
  });

  test('renders an absent amount as a dash, not a zero', () => {
    assert.equal(formatMoney(null), '—');
    assert.equal(formatMoney(undefined), '—');
    assert.equal(formatMoney(NaN), '—');
  });
});

describe('malformed mixed grouping', () => {
  test('rejects a misplaced separator rather than silently changing the amount', () => {
    for (const raw of ['1,2.50', '1.2,50', '1,,250.50', '12,34.56']) assert.ok(Number.isNaN(parseAmount(raw)), raw);
    assert.equal(parseAmount('1,234.56'), 1234.56);
    assert.equal(parseAmount('1.234,56'), 1234.56);
  });
});

describe('invalid amounts and credits', () => {
  test('rounding cannot turn an invalid amount into a valid zero', () => {
    assert.ok(Number.isNaN(roundMoney(NaN)));
    assert.ok(Number.isNaN(roundMoney(Infinity)));
  });
  test('half-cent credits round symmetrically with charges', () => {
    assert.equal(roundMoney(-8.075), -8.08);
    assert.equal(formatMoney(-8.075), '-8,08$');
  });
});
