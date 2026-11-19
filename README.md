# Level Lab

A responsive, paper-only crypto trading dashboard for GitHub Pages. Uses support and resistance to test a long-only bounce strategy, records every virtual fill, and reviews parameters each UTC day.

**All capital and execution are simulated. The app contains no real-order, balance, transfer, or payment integrations.** No API keys are needed.

## What is included

- BTC-USD, ETH-USD, and SOL-USD candlesticks with confirmed support/resistance levels.
- A shared scheduled paper account, starting with **$10,000 virtual cash**, automatically trading BTC-USD on qualifying signals.
- A separate browser-local practice account for manual trades, stops, targets, risk settings, and CSV/JSON exports.
- Estimated fees of 0.60% and adverse slippage of 0.05% on each side by default. These are modeling assumptions, not your Coinbase account's fee tier.
- Historical replays and dated daily reviews with exact parameter changes and train/holdout metrics.
- Source, paper-account state, and reviews versioned in GitHub.

## Coinbase MCP and ongoing data

The connected Coinbase MCP was used to collect actual BTC, ETH, and SOL market-candle snapshots, preserved in `data/mcp-seed.json`. The app can use this snapshot as a fallback if its primary market snapshot cannot load. No account information was requested.

An authenticated ChatGPT MCP connection is **not transferable into a static GitHub Pages site**. Accordingly, ongoing browser quotes and hourly scheduled candles come from Coinbase's unauthenticated public Exchange API (`https://api.exchange.coinbase.com`). The app never claims to have a live authenticated MCP connection. It refuses manual entries without a fresh public quote. No tokens or credentials are embedded in source.

## Deploy to GitHub Pages

Repository: [akc302/PaperTrading](https://github.com/akc302/PaperTrading). Public source includes only public market data and simulated results.

The application is configured for GitHub Pages using GitHub Actions. In the repository, choose **Settings → Pages → Source → GitHub Actions**. Pushes to `main` run **Publish dashboard**; **Update paper account** runs hourly and can be started manually from Actions.

The project-page address is `https://akc302.github.io/PaperTrading/`. Deployment status is available in the repository's Actions and Pages settings.

The hourly workflow is scheduled at minute 17. It commits updated public candles, paper state, and review history, then deploys Pages directly. This avoids relying on a second workflow being triggered by a `GITHUB_TOKEN` commit. GitHub can delay scheduled runs, and public-repository schedules may disable after 60 days of repository inactivity. Check the dated account freshness warning and Actions history.

## Run checks and build

Requires Node.js 22+; no package installation or build dependencies.

```sh
npm test
npm run build
```

`dist/` contains the deployable static site. Serve it with any static web server when local preview is available. ES modules and `fetch` require HTTP(S), rather than opening `index.html` as a local file.

To manually update the saved market and shared paper account:

```sh
npm run update
```

On proxy-managed Node 24 environments, use `node --use-env-proxy scripts/update-market.mjs`. GitHub Actions uses normal outbound HTTPS and requires no Coinbase secret.

## Strategy and execution model

Confirmed pivots use three completed candles on either side. The current lookback is 48 hourly candles. Nearby pivots cluster into levels; the signal requires support below price, resistance above price, a support-zone revisit, and bullish confirmation. Its target must offer the configured reward/risk **after modeled fees and slippage**, with room below resistance.

Signals use only candles available before the execution candle. Scheduled positions fill at the next candle open after a qualifying signal, subject to a second economics check. Sizing uses the smaller of a 1% equity stop-risk budget, a 25% allocation cap, and available virtual cash. A stop gap may exceed the planned risk budget. No leverage or short selling is modeled.

If both stop and target are touched inside an hourly candle, the engine conservatively chooses the stop. Downward stop gaps fill at the worse open. Target fills are modeled at the target with adverse slippage. This is a candle-based approximation, not a reconstruction of intrabar execution or a real fill guarantee.

Initial synchronization advances the account cursor to the latest completed candle without inventing historical trades. Subsequent runs process each closed candle once. Missing history after the cursor pauses automatic processing, instead of silently skipping unknown price action.

The browser practice account uses fresh public quotes for manual entries and closes. It processes completed candles and observed quote exits when the app refreshes. It does not execute while the browser is closed, does not sync between devices, and cannot reconstruct every intrahour movement during an absence. It is separate from the scheduled account.

## Daily review and learning limits

Once each UTC day, the hourly workflow evaluates a fixed set of lookbacks and support-entry zones. It selects on an earlier 70% training window and compares on a later 30% holdout. All baseline/candidate training/holdout comparisons need at least five closed trades. A promotion needs improved training and holdout net return, with no higher holdout drawdown. Changes apply to future entries; existing positions retain their original fee/slippage assumptions.

The initial 30-day sample may produce very few or zero trades after costs. A retained configuration is a valid result. The daily review uses overlapping rolling samples, so the holdout is a research check, not an untouched ongoing out-of-sample guarantee. Repeated testing can overfit. This app improves the visibility and discipline of the testing process; it cannot guarantee daily improvement or trading profits.

## Files

| File | Purpose |
| --- | --- |
| `app.js`, `index.html`, `styles.css` | Static responsive frontend |
| `engine.js` | Pure analysis, accounting, paper execution and review logic |
| `data/market.json` | Saved public hourly candles |
| `data/mcp-seed.json` | Initial read-only Coinbase MCP snapshot |
| `data/paper.json` | Scheduled virtual account and current configuration |
| `data/reviews.json` | Dated strategy-review and parameter-change history |
| `scripts/update-market.mjs` | Hourly public-data fetch and paper simulation |
| `.github/workflows/update.yml` | Scheduled update, commit and deploy |
| `.github/workflows/pages.yml` | Deploy on main-branch source changes |

Fonts are loaded from Google Fonts with local sans-serif fallbacks. Application state and market functions do not require the fonts service. Public Pages provides no private login; do not add credentials or sensitive portfolio information to this repository.
