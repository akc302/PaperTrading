import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scheduled updater preserves honest paper history across repeats, gaps, and outages', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'level-lab-updater-'));
  const read = name => JSON.parse(readFileSync(path.join(fixture, 'data', name), 'utf8'));
  const run = (offset = 0, extra = {}) => {
    const result = spawnSync(process.execPath, ['--import', path.join(fixture, 'mock.mjs'), path.join(fixture, 'scripts/update-market.mjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, TEST_OFFSET: String(offset), TEST_FAIL: '', TEST_MISSING: '', ...extra },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  };
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    copyFileSync(path.join(root, 'engine.js'), path.join(fixture, 'engine.js'));
    copyFileSync(path.join(root, 'scripts/update-market.mjs'), path.join(fixture, 'scripts/update-market.mjs'));
    writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
    // Test fixtures are isolated from shipped data. No real network calls or waits.
    writeFileSync(path.join(fixture, 'mock.mjs'), `
      import assert from 'node:assert/strict';
      const RealDate = Date;
      const clock = RealDate.parse('2026-11-19T12:17:00Z') + Number(process.env.TEST_OFFSET);
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      const realTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 500 ? 0 : ms, ...args);
      globalThis.fetch = async (input, options) => {
        const url = new URL(input);
        assert.equal(url.origin, 'https://api.exchange.coinbase.com');
        assert.match(url.pathname, /^\\/products\\/(BTC|ETH|SOL)-USD\\/candles$/);
        assert.equal(options.method ?? 'GET', 'GET');
        if (process.env.TEST_FAIL === '1') throw new Error('Test market outage');
        const rows = [];
        for (let t = RealDate.parse(url.searchParams.get('start')) / 1000; t <= RealDate.parse(url.searchParams.get('end')) / 1000; t += 3600) {
          if (t === Number(process.env.TEST_MISSING)) continue;
          const price = 60000 + 2000 * Math.sin(t / 3600 / 5);
          rows.push([t, price - 500, price + 500, price - 100, price, 100]);
        }
        return { ok: true, json: async () => rows };
      };
    `);

    run();
    const initial = read('paper.json');
    const firstMarket = read('market.json');
    assert.equal(initial.account.cash, 10000);
    assert.deepEqual(initial.account.trades, []);
    assert.deepEqual(initial.account.positions, []);
    assert.deepEqual(initial.account.equityHistory, []);
    for (const product of ['BTC-USD', 'ETH-USD', 'SOL-USD']) {
      const bars = firstMarket.products[product].candles;
      assert.equal(bars.length, 720);
      assert.equal(bars.at(-1).time, Date.parse('2026-11-19T11:00:00Z') / 1000);
      assert.equal(new Set(bars.map(b => b.time)).size, bars.length);
    }
    assert.equal(read('reviews.json').reviews.length, 1);

    run();
    assert.deepEqual(read('paper.json').account, initial.account, 'same bars must not generate repeated fills or equity history');
    assert.equal(read('reviews.json').reviews.length, 1, 'one review per UTC day');

    run(2 * 3600 * 1000);
    const advanced = read('paper.json');
    assert.equal(advanced.account.equityHistory.length, 2, 'process only the two newly completed candles');
    assert.equal(advanced.account.lastProcessed['BTC-USD'], Date.parse('2026-11-19T13:00:00Z') / 1000);
    assert.equal(read('reviews.json').reviews.length, 1);

    run(4 * 3600 * 1000, { TEST_MISSING: String(Date.parse('2026-11-19T14:00:00Z') / 1000) });
    const gap = read('paper.json');
    assert.deepEqual(gap.account, advanced.account, 'a missing bar must pause fills without advancing the account cursor');
    assert.ok(gap.errors.some(e => e.product === 'BTC-USD' && /gap/i.test(e.message)));

    const beforeOutage = read('market.json');
    run(4 * 3600 * 1000, { TEST_FAIL: '1' });
    const outage = read('market.json');
    assert.deepEqual(outage.products, beforeOutage.products, 'outage must preserve all previously fetched candles and their timestamps');
    assert.equal(outage.updatedAt, beforeOutage.updatedAt, 'outage must not claim a fresh market update');
    assert.equal(outage.errors.length, 3);
    assert.deepEqual(read('paper.json').account, advanced.account, 'outage must preserve the complete paper ledger');

    run(24 * 3600 * 1000);
    const dailyReviews = read('reviews.json').reviews;
    assert.equal(dailyReviews.length, 2);
    assert.equal(dailyReviews[0].date, '2026-11-20');
    assert.equal(dailyReviews[1].date, '2026-11-19');
    assert.ok(dailyReviews.every(r => r.before && r.after && r.reason), 'daily review records parameter history and rationale');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
