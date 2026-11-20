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

### 2026-11-20 04:18 UTC fallback check
One successful GitHub schedule event remains visible (03:10 UTC); no sustained five-minute sequence. Published state was about 55 minutes old, so the independent monitor dispatched update.yml once. The standalone health script still used a 90-minute freshness window, inconsistent with this monitor's 15-minute requirement; corrected it to 15 minutes and added a regression test. No trading/risk rules changed. The GitHub timer issue remains unresolved; a manual recovery is not proof of timer health.

## Execution / evidence / review separation — 2026-11-20
- [x] update.yml and the normal updater now run trade-only. They do not retrain or retune at each five-minute check. Explicit PAPER_JOB_MODE=all remains only for legacy integration fixtures.
- [x] learning.yml collect phase: hourly at :23 UTC, summarizes completed hourly windows; deduplicated, catch-up capable, no trade execution. Public dummy evidence is public; private evidence remains encrypted.
- [x] learning.yml review phase: daily at 00:37 UTC, evaluates the previous UTC day; one review per day, no repeated tuning on every collection. Does not advance the trading heartbeat.
- [x] Counts wins, losses, flat results, realized net P&L, gross fees, credited/pending rebates, expectancy, profit factor, drawdown, market/setup/exit groups and sampling coverage. Snapshot rebalance records excluded from strategy evidence.
- [x] A distinct executed-trade-outcome logistic model uses frozen entry features and completed net outcomes, with at least 100 eligible closed trades, chronological holdout and exclusion of trades whose outcomes cross the split. It remains shadow-only.
- [x] Daily parameter adoption requires complete execution sampling for the prior day, a fresh execution heartbeat, at least 100 completed trades overall, 30 in the market including five wins/five losses, and existing train/holdout guards. Only target ratio, stop-ATR multiplier or future holding duration can change; risk caps and existing positions cannot.
- [x] Insufficient evidence retains the current strategy. Up to 90 daily reviews retained in state; Git history preserves prior versions.
- [ ] Reliable five-minute execution delivery remains unresolved. Learning schedules also depend on GitHub delivery; the independent hourly task supplies bounded recovery/collection/daily-review dispatch fallback.

Collection/review validation compared pre/post account, configuration and trading-heartbeat hashes and confirmed they were unchanged. Private financial evidence is never written to this public memory file.

Deployment validation: all 63 tests and the publication build passed. Daily review workflow 44675291550 and collect-only workflow 44675385076 both completed successfully via workflow_dispatch; published evidence freshness and encrypted private reports were verified. These manual checks validate execution, not scheduled timer delivery. The initial pending collection dispatch was superseded by the daily dispatch in the shared Pages concurrency queue; collection was subsequently dispatched and verified separately.

### 2026-11-20 05:19 UTC fallback recovery
No new schedule-event run appeared after the previously observed 03:10 run. Trading was approximately 44 minutes stale; evidence lacked the completed hour ending 05:00. Dispatched update.yml once (44680285972): simulation and state commit succeeded, but Pages deployment failed when deploy-pages found zero artifacts immediately after the visibility probe succeeded. Dispatched collect once (44680379132): succeeded, published the refreshed 05:20 trading state and completed hourly evidence. Private collection invariants confirmed unchanged account, configuration, product parameters and execution heartbeat. Today's daily review already existed; no retraining or tuning was repeated.

Bounded deployment mitigation: all three workflows now share a visibility helper requiring three consecutive successful artifact probes, resetting readiness after missing results or API errors, with a bounded 18-probe failure. Two regressions cover transient disappearance and persistent absence/errors. All 65 tests and the static publication audit/build pass. Consecutive observations reduce the observed race but cannot guarantee subsequent GitHub API consistency. Reliable five-minute timer delivery remains unresolved; manual recovery is not timer evidence. No risk/trading rules changed; no private financial metrics were added to this public log.
