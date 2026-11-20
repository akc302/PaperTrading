# PaperTrading task memory

Paper only. No real order calls. Never commit Coinbase credentials, unlock keys, or plaintext portfolio data. User goal: $85,000 simulated portfolio; no deadline/return guarantee. PIN is a cosmetic gate; private account remains encrypted.

## Verified implemented
- [x] Encrypted private portfolio snapshot, isolated public demo, browser practice account.
- [x] Five-minute checks configured; actual timer delivery is UNVERIFIED (see November 20 audit). Completed 1h/4h signals, journal and daily quantitative reviews implemented.
- [x] Shared risk/cash limits, stop/target/time exits, atomic multi-market updates, missing-feed pauses.
- [x] Current Coinbase fee tier read through MCP (stored only in encrypted private account).
- [x] Per-fill maker/taker records, fee observation timestamps, cached/live status, gross fees and pending rebate separately.
- [x] Market entries/stop exits modeled as taker; existing resting limit targets modeled as maker. Candle fills are approximate, not exchange queue reconstruction.
- [x] Automated fee-model tests; old trades keep their charged entry fees.

## Work requiring additional integration or evidence
- [ ] Authenticated LIVE Coinbase fee-tier refresh before every order. Chat MCP is unavailable inside GitHub Actions; cached tier is explicitly labeled. Requires a separately provisioned read-only runtime integration, never credentials committed in source.
- [x] User confirmed Premium/unlimited rebates. Future modeled fills credit virtual USDC at 25% of eligible gross fees; source is user confirmation, not API verification. No retroactive rewriting of historical costs.
- [ ] Full pending limit-order book (post-only rejection, maker/taker partial fills, cancellation, time-in-force, size increments). Current strategy fills do not reproduce these exchange mechanics.
- [x] Historical-market shadow logistic model added with chronological validation, embargo and reproducible feature schema; never promoted automatically. A model trained on executed strategy trades still requires sufficient outcomes.
- [ ] Broad Tori video inventory with verified URLs, dates, available caption status; original source-linked summaries. No claim to have watched/transcribed the entire channel.
- [ ] Daily news ingestion, source/time provenance, market relevance and bounded shadow-only features. No claim unattended AI/web research is already active.
- [ ] Reliable always-on backend/monitoring if strict 24/7 execution or one-minute checks are required. GitHub Actions is best effort.

## Acceptance before marking complete
Every change: meaningful tests, private-data publication audit, successful deployment and private updater status, truthful UI. Do not label cached fees as live, pending rebates as cash, research candidates as validated models, or scheduled checks as guaranteed uptime.

## Monitoring
- [x] Hourly independent health workflow checks published state/freshness/automation flags and feed errors without decrypting financial data.
- [x] An unhealthy result dispatches the existing updater once, waits, and verifies recovery; persistent failures fail the monitor and remain visible in Actions.
- [ ] Human-level unattended debugging and arbitrary code repairs are not implemented. GitHub scheduling has no guaranteed hourly SLA. Configure repository Actions notifications to receive failures.

## 2026-11-20 operational audit and active experiment
- [x] Actual run-history audit found ZERO schedule-event runs despite configured cron. Earlier manual successes did not prove unattended timers. Simplified/re-enabled GitHub schedules; actual timer evidence is recorded in public operations.json. At 03:10 UTC one successful scheduled run appeared. That proves a timer can fire, but does not establish a five-minute cadence.
- [x] Found Pages artifact visibility race; deployment now waits for the uploaded artifact to appear through the API with actions:read permission before deploying.
- [x] Independent hourly ChatGPT health/recovery task created as fallback, enabled. It is not a five-minute timer and has no guaranteed uptime.
- [x] Current-quote execution mode introduced: entries/exits timestamp when fresh quotes are actually observed, no backdated fills. Atomic complete-universe quote validation and five-minute idempotency buckets; 30-minute re-entry cooldown.
- [x] User-requested aggressive PAPER experiment: 2% planned risk per entry, 8% aggregate, four slots, 25% allocation per slot, two-hour holding cap, 12% daily entry pause. Fixed risk caps remain; no real order integration. Existing ledgers retained.
- [x] Fitted regularized logistic regression introduced in SHADOW mode. Public and encrypted private models use their own fee hurdle, earlier training and later holdout, four-hour embargo, Brier loss vs constant baseline, and explicit as-of times. Daily model fitting does not autonomously rewrite code or promise improvement.
- [x] WebSocket display ticks with REST fallback; display streaming does NOT advance or prove the server trader is running. Confirmed swing labels and reference trendlines are visible.
- [x] WAIT/SYNC explicitly labeled decision records, not pending orders; executed paper positions and closed fills remain separate.
- [ ] Regular GitHub five-minute and hourly delivery still require a sustained sequence of actual successful schedule-event runs. A continuously provisioned backend or independent external dispatcher is needed if strict timing is essential.
