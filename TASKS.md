# PaperTrading task memory

Paper only. No real order calls. Never commit Coinbase credentials, unlock keys, or plaintext portfolio data. User goal: $85,000 simulated portfolio; no deadline/return guarantee. PIN is a cosmetic gate; private account remains encrypted.

## Verified implemented
- [x] Encrypted private portfolio snapshot, isolated public demo, browser practice account.
- [x] Five-minute scheduled checks; completed 1h/4h trendline signals; journal and daily quantitative reviews.
- [x] Shared risk/cash limits, stop/target/time exits, atomic multi-market updates, missing-feed pauses.
- [x] Current Coinbase fee tier read through MCP (stored only in encrypted private account).
- [x] Per-fill maker/taker records, fee observation timestamps, cached/live status, gross fees and pending rebate separately.
- [x] Market entries/stop exits modeled as taker; existing resting limit targets modeled as maker. Candle fills are approximate, not exchange queue reconstruction.
- [x] Automated fee-model tests; old trades keep their charged entry fees.

## Work requiring additional integration or evidence
- [ ] Authenticated LIVE Coinbase fee-tier refresh before every order. Chat MCP is unavailable inside GitHub Actions; cached tier is explicitly labeled. Requires a separately provisioned read-only runtime integration, never credentials committed in source.
- [ ] Confirm Coinbase One plan, cap, remaining allowance and billing period. Until verified, 25% is provisional and contributes ZERO spendable USDC/profit.
- [ ] Full pending limit-order book (post-only rejection, maker/taker partial fills, cancellation, time-in-force, size increments). Current strategy fills do not reproduce these exchange mechanics.
- [ ] Shadow ML classifier trained only after sufficient completed strategy trades, chronological validation, leakage checks, reproducible feature schema; no unvalidated automatic model promotion.
- [ ] Broad Tori video inventory with verified URLs, dates, available caption status; original source-linked summaries. No claim to have watched/transcribed the entire channel.
- [ ] Daily news ingestion, source/time provenance, market relevance and bounded shadow-only features. No claim unattended AI/web research is already active.
- [ ] Reliable always-on backend/monitoring if strict 24/7 execution or one-minute checks are required. GitHub Actions is best effort.

## Acceptance before marking complete
Every change: meaningful tests, private-data publication audit, successful deployment and private updater status, truthful UI. Do not label cached fees as live, pending rebates as cash, research candidates as validated models, or scheduled checks as guaranteed uptime.
