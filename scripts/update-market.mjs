/** Scheduled paper account. Public market data only; never accesses a Coinbase account. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeCandles, createAccount, processCandles, reviewStrategy } from '../engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PRODUCTS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const HOUR = 3600;
const MAX_BARS = 1000;
const now = new Date();
const stamp = now.toISOString();
const cutoff = Math.floor(now.getTime() / 1000 / HOUR) * HOUR;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(path.join(DATA, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function saveJSON(name, value) {
  await writeFile(path.join(DATA, name), JSON.stringify(value, null, 2) + '\n');
}

async function fetchCandles(product) {
  const rows = [];
  // Coinbase caps a request at 300 candles. Three bounded windows collect 30 days.
  for (let start = cutoff - 720 * HOUR; start < cutoff; start += 240 * HOUR) {
    const end = Math.min(start + 240 * HOUR, cutoff);
    const url = new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
    url.searchParams.set('granularity', String(HOUR));
    url.searchParams.set('start', new Date(start * 1000).toISOString());
    url.searchParams.set('end', new Date(end * 1000).toISOString());
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Level-Lab-Paper-Research/1.0' },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Coinbase market request failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Coinbase returned an invalid candle response.');
    rows.push(...normalizeCandles(page));
    // Keep public requests comfortably below the exchange's unauthenticated rate limit.
    await sleep(500);
  }
  const bars = normalizeCandles(rows).filter(c => c.time + HOUR <= cutoff);
  if (bars.length < 48) throw new Error('Fewer than 48 valid completed market candles received.');
  if (bars.at(-1).time < cutoff - HOUR) throw new Error('Latest completed Coinbase candle is missing; paper trading paused.');
  return bars;
}

await mkdir(DATA, { recursive: true });
const market = await readJSON('market.json', { products: {} });
const paper = await readJSON('paper.json', {
  version: 1, updatedAt: stamp, autoTrade: true, products: ['BTC-USD'],
  config: { ...DEFAULT_CONFIG }, account: createAccount(10000),
});
const reviews = await readJSON('reviews.json', { updatedAt: stamp, reviews: [] });
if (!market.products || typeof market.products !== 'object') throw new Error('Invalid saved market data.');
if (!paper.account || !Array.isArray(paper.products)) throw new Error('Invalid saved paper account.');
paper.config = { ...DEFAULT_CONFIG, ...paper.config };
market.errors = [];
const refreshed = new Set();

for (const product of PRODUCTS) {
  try {
    const received = await fetchCandles(product);
    const candles = normalizeCandles([...(market.products[product]?.candles ?? []), ...received])
      .filter(c => c.time + HOUR <= cutoff).slice(-MAX_BARS);
    market.products[product] = { candles, fetchedAt: stamp, source: 'Coinbase public Exchange API' };
    refreshed.add(product);
    console.log(`${product}: ${candles.length} completed hourly candles.`);
  } catch (error) {
    market.errors.push({ product, message: error.message, time: stamp });
    console.error(`${product}: ${error.message} Keeping previous data.`);
  }
}

for (const product of paper.products) {
  if (!PRODUCTS.includes(product) || !refreshed.has(product)) continue;
  const candles = market.products[product].candles;
  const cursor = paper.account.lastProcessed?.[product];
  const pending = cursor == null ? [] : candles.filter(c => c.time > cursor);
  let previous = cursor;
  const gap = pending.some(c => { const missing = c.time !== previous + HOUR; previous = c.time; return missing; });
  if (gap) {
    market.errors.push({ product, message: 'A gap follows the paper account cursor. Automated fills are paused until complete history is restored.', time: stamp });
    continue;
  }
  processCandles(paper.account, product, candles, paper.config, { autoTrade: paper.autoTrade === true });
}

// Review once per UTC day after processing today's bars with the existing parameters.
// A candidate must clear the engine's training, later-holdout, minimum-trade and drawdown guards.
const date = stamp.slice(0, 10);
if (refreshed.has('BTC-USD') && !reviews.reviews.some(r => r.date === date && r.product === 'BTC-USD')) {
  const before = { ...paper.config };
  const review = reviewStrategy(market.products['BTC-USD'].candles, before);
  const promoted = review.status === 'candidate';
  if (promoted) paper.config = { ...review.config };
  reviews.reviews.unshift({
    date, time: stamp, product: 'BTC-USD',
    status: promoted ? 'promoted' : review.status,
    reason: promoted
      ? 'Training-selected parameters passed the later holdout and were adopted for future paper entries. Future performance is uncertain.'
      : review.reason,
    before, after: { ...paper.config }, baseline: review.baseline, candidate: review.candidate,
    training: review.training, holdout: review.holdout,
  });
  reviews.reviews = reviews.reviews.slice(0, 365);
  reviews.updatedAt = stamp;
}

market.updatedAt = refreshed.size ? stamp : market.updatedAt ?? null;
market.source = 'Coinbase public Exchange API';
market.granularity = HOUR;
paper.updatedAt = stamp;
paper.lastMarketAt = market.updatedAt;
paper.errors = market.errors;
await saveJSON('market.json', market);
await saveJSON('paper.json', paper);
await saveJSON('reviews.json', reviews);
if (!refreshed.size) {
  console.error('No markets refreshed. Retained prior candles/account and recorded visible errors.');
  // Persisting the errors allows the deployed UI to report failures instead of appearing fresh.
}
