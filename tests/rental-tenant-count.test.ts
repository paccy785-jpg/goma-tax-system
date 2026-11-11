import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRentalRoll, groupRentalRowsByTenant } from '../src/services/rentalService.ts';
import type { RentalLease } from '../src/types/index.ts';

const lease = (id: string, names: string[], start: string, end: string, rent: number) => ({
  id, tenantNames: names, startDate: start, endDate: end, monthlyRentUSD: rent,
} as RentalLease);

test('three tenants with four lease documents count as three tenants and retain all rental revenue', () => {
  const leases = [
    lease('a', ['Alfred'], '2026-11-01', '2026-12-31', 200),
    lease('b', ['Mugisha'], '2026-01-01', '2026-11-30', 100),
    lease('c', ['paccy'], '2026-05-01', '2026-10-31', 100),
    lease('d', ['paccy'], '2026-01-01', '2026-04-30', 100),
  ];
  const roll = computeRentalRoll(leases, 2026);
  assert.equal(roll.totalLeases, 4);
  assert.equal(roll.totalTenants, 3);
  assert.equal(groupRentalRowsByTenant(roll.rows).length, 3);
  assert.equal(roll.totalGrossUSD, 2500);
  const filtered = computeRentalRoll(leases.slice(2), 2026);
  assert.equal(filtered.totalTenants, 1);
  assert.equal(filtered.totalLeases, 2);
  assert.equal(filtered.totalGrossUSD, 1000);
});

test('co-tenants count individually, repeated names count once, and blank names count as none', () => {
  const roll = computeRentalRoll([
    lease('a', [' Alice ', 'BOB', ''], '2026-01-01', '2026-12-31', 100),
    lease('b', ['alice', 'Bob', '   '], '2026-01-01', '2026-12-31', 100),
  ], 2026);
  assert.equal(roll.totalTenants, 2);
  assert.equal(computeRentalRoll([], 2026).totalTenants, 0);
});
