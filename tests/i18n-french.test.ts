/**
 * The French side of the EN / FR toggle.
 *
 * The office reads in French: a receipt that shows a US date ("11/6/2026",
 * which is 11 June in French) or a 12-hour clock, and a count grouped with a
 * comma ("1,234", which reads as 1.234), misleads the person reading it.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { applyLanguage, translateString } from '../src/i18n/domTranslate.ts';

before(() => {
  // applyLanguage() sets the language first and only then touches the page,
  // so it works without a DOM once the missing MutationObserver is ignored.
  try {
    applyLanguage('fr');
  } catch {
    /* no DOM in the test runner */
  }
});

describe('a date on an official document', () => {
  test('the numeric US date is read the French way', () => {
    assert.equal(translateString('11/6/2026'), '6/11/2026');
    assert.equal(translateString('12/31/2026'), '31/12/2026');
  });

  test('a month-name date still works', () => {
    assert.equal(translateString('Friday, November 6, 2026'), 'vendredi 6 novembre 2026');
    assert.equal(translateString('Nov 6, 2026'), '6 nov. 2026');
  });

  test('the 12-hour clock becomes a 24-hour clock', () => {
    assert.equal(translateString('9:30:00 PM'), '21:30:00');
    assert.equal(translateString('09:05 AM'), '09:05');
    assert.equal(translateString('12:00 AM'), '00:00');
    assert.equal(translateString('12:00 PM'), '12:00');
  });

  test('a date and a time together are both converted', () => {
    assert.equal(translateString('11/6/2026, 9:30:00 PM'), '6/11/2026, 21:30:00');
  });
});

describe('a count on a dashboard', () => {
  test('US thousands grouping becomes the French separator', () => {
    assert.equal(translateString('1,234'), '1 234');
    assert.equal(translateString('12,500,000'), '12 500 000');
    assert.equal(translateString('Total 1,234 receipts'), 'Total 1 234 receipts');
  });

  test('a plain number is left alone', () => {
    assert.equal(translateString('42'), null);
    assert.equal(translateString('1250'), null);
  });
});

describe('a label on an official document', () => {
  test('the labels the FR dictionary was missing are translated', () => {
    assert.equal(translateString('N/A'), 'S.O.');
    assert.equal(translateString('Revocation Date:'), 'Date de révocation :');
    assert.equal(translateString('Verified on:'), 'Vérifié le :');
    assert.equal(translateString('Submitted on'), 'Soumis le');
    assert.equal(translateString('License Registry'), 'Registre des licences');
    assert.equal(translateString('This certificate was revoked on'), 'Ce certificat a été révoqué le');
  });

  test('a label that carries a date with it is translated as a whole', () => {
    assert.equal(
      translateString('Submitted on 11/6/2026, 9:30:00 PM'),
      'Soumis le 6/11/2026, 21:30:00'
    );
    assert.equal(
      translateString('Revocation Date: 11/6/2026'),
      'Date de révocation : 6/11/2026'
    );
    assert.equal(
      translateString('License Registry (3)'),
      'Registre des licences (3)'
    );
  });
});
