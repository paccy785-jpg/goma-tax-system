/**
 * The DGI portal's money parsing, its record keys and its branding.
 *
 * These are the parts of the DGI portal that have to be right: a figure read
 * a thousand times too small is an assessment a thousand times too small, and a
 * record filed under a random key can be created twice.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFigure } from '../src/utils/parseFigure.ts';
import {
  dgiCalculDocId,
  dgiDeclarationDocId,
  dgiPeriode,
  hasCalculForPeriod,
  hasPaymentForCalcul,
  unsettledCalculs,
} from '../src/utils/dgiRecords.ts';
import { officeLabel, BRAND, DGI_BRAND } from '../src/branding.ts';

describe('a figure of the DGI card', () => {
  test('reads the documented shapes', () => {
    assert.equal(parseFigure('1,364,414.50'), 1364414.5);
    assert.equal(parseFigure('1.364.414,50'), 1364414.5);
    assert.equal(parseFigure('136,441'), 136441);
    assert.equal(parseFigure('129.82'), 129.82);
    assert.equal(parseFigure('12,5'), 12.5);
    assert.equal(parseFigure('1 250,50'), 1250.5);
    assert.equal(parseFigure('1 250'), 1250);
  });

  test('never loses a group of a grouped figure', () => {
    // "0,500,000" is five hundred thousand. Reading it as a decimal dropped
    // every group after the second: the figure came back as 0.5.
    assert.equal(parseFigure('0,500,000'), 500000);
    assert.equal(parseFigure('1,250,500'), 1250500);
    assert.equal(parseFigure('12,500,000'), 12500000);
    assert.equal(parseFigure('00,500,000'), 500000);
  });

  test('a leading zero in front of a single group is a decimal', () => {
    assert.equal(parseFigure('0.500'), 0.5);
    assert.equal(parseFigure('0,500'), 0.5);
  });

  test('a negative figure is refused, not turned positive', () => {
    assert.ok(Number.isNaN(parseFigure('-500')));
    assert.ok(Number.isNaN(parseFigure('-1')));
  });

  test('a malformed figure is refused', () => {
    assert.ok(Number.isNaN(parseFigure('')));
    assert.ok(Number.isNaN(parseFigure('abc')));
    assert.ok(Number.isNaN(parseFigure('1-250')));
  });
});

describe('the key of a DGI record', () => {
  test('a calculation is keyed by its taxpayer and period', () => {
    assert.equal(dgiCalculDocId('biz_1', '2026-03'), 'calc_biz_1_2026-03');
  });

  test('a payment is keyed by the calculation it settles', () => {
    assert.equal(dgiDeclarationDocId('calc_biz_1_2026-03'), 'paid_calc_biz_1_2026-03');
  });

  test('the same taxpayer and period always give the same key', () => {
    assert.equal(
      dgiCalculDocId('biz_1', dgiPeriode(2026, 3)),
      dgiCalculDocId('biz_1', dgiPeriode(2026, 3))
    );
  });

  test('the period is the year and the month', () => {
    assert.equal(dgiPeriode(2026, 3), '2026-03');
    assert.equal(dgiPeriode(2026, 12), '2026-12');
  });
});

describe('a calculation already filed', () => {
  const calcul = { contribuableId: 'biz_1', periode: '2026-03' };

  test('is found for the same taxpayer and period', () => {
    assert.equal(hasCalculForPeriod([calcul], 'biz_1', '2026-03'), true);
  });

  test('is not confused with another taxpayer or another period', () => {
    assert.equal(hasCalculForPeriod([calcul], 'biz_2', '2026-03'), false);
    assert.equal(hasCalculForPeriod([calcul], 'biz_1', '2026-04'), false);
  });
});

describe('a calculation already settled', () => {
  test('is found by the calculation it settles', () => {
    assert.equal(hasPaymentForCalcul([{ calculId: 'calc_1' }], 'calc_1'), true);
    assert.equal(hasPaymentForCalcul([{ calculId: 'calc_1' }], 'calc_2'), false);
  });

  test('is not offered again in the payment card', () => {
    const calculs = [{ id: 'calc_1' }, { id: 'calc_2' }];
    const declarations = [{ calculId: 'calc_1' }];
    assert.deepEqual(
      unsettledCalculs(calculs, declarations).map((c) => c.id),
      ['calc_2']
    );
  });
});

describe('the office label', () => {
  test('shows the active portal\'s own label', () => {
    assert.equal(officeLabel('', DGI_BRAND), 'DGI — Goma');
    assert.equal(officeLabel('', BRAND), BRAND.defaultOffice);
  });

  test('normalises a label written under the other brand', () => {
    // The DGI roster showed (and saved) "DPRNK — Goma Main Office".
    assert.equal(officeLabel('DPRNK — Goma Main Office', DGI_BRAND), 'DGI — Goma');
    assert.equal(officeLabel('DPRNK — Goma Main Office', BRAND), BRAND.defaultOffice);
    assert.equal(officeLabel('DGI — Goma Main Office', DGI_BRAND), 'DGI — Goma');
  });

  test('leaves a label that is already right alone', () => {
    assert.equal(officeLabel('DGI — Goma', DGI_BRAND), 'DGI — Goma');
  });
});

describe('the DGI security rules', () => {
  const rules = fs.readFileSync(
    path.join(process.cwd(), 'firestore.dgi.rules'),
    'utf8'
  );
  const dprnkRules = fs.readFileSync(
    path.join(process.cwd(), 'firestore.rules'),
    'utf8'
  );

  /** The body of one rule block: from its `match` line to its closing brace. */
  const ruleBlock = (source: string, marker: string): string => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} is missing from the rules`);
    const end = source.indexOf('\n    }', start);
    return source.slice(start, end >= 0 ? end : start + 1200);
  };

  test('a payment may only be filed by an officer, in their own name', () => {
    const section = ruleBlock(rules, 'match /dgiDeclarations/');
    assert.match(section, /callerRole\(\) in \['Admin', 'Supervisor', 'Cashier'\]/);
    assert.match(section, /request\.resource\.data\.createdByUid == request\.auth\.uid/);
  });

  test('a calculation may only be filed by an officer, in their own name', () => {
    const section = ruleBlock(rules, 'match /dgiCalculsImpot/');
    assert.match(section, /request\.resource\.data\.createdByUid == request\.auth\.uid/);
  });

  test('a role may only be granted by an Administrator', () => {
    for (const source of [rules, dprnkRules]) {
      assert.match(
        source,
        /hasAny\(\['role'\]\)\s*\n\s*\|\| isAdmin\(\)/,
        'the users update rule must close the role field to non-administrators'
      );
    }
  });

  test('a DGI officer may reach the print queue and the shared nomenclature', () => {
    assert.match(dprnkRules, /function isDgiOfficer\(\)/);
    assert.match(dprnkRules, /match \/printStations\/\{stationId\}/);
    assert.match(
      dprnkRules,
      /allow read: if canUseApp\(\) \|\| isDgiOfficer\(\);/
    );
    assert.match(
      dprnkRules,
      /match \/nomenclaturesImpots\/\{nomId\}/,
      'the shared nomenclature must be reachable'
    );
  });

  test('an account of the DGI portal is not given a DPRNK profile', () => {
    assert.match(dprnkRules, /function isDgiAccount\(\)/);
    assert.match(dprnkRules, /&& !isDgiAccount\(\)/);
  });
});
