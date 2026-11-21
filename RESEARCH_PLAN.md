# Cost-aware paper strategy research

## Objective and boundaries
Improve net expectancy and drawdown on unseen data. Winning every trade is not an achievable validation requirement. No-trade (zero trading P&L) and the existing strategy are baselines. Research never executes orders, changes positions or raises risk caps. Real funds are never involved. Private outcomes and reports remain inside the AES-GCM envelope; public reports describe only the synthetic demo.

## Current experiment: cost-aware-v1
- [x] Diagnose all eligible completed journal trades: wins/losses, net P&L, fees, credited rebates, cost-flipped losses, markets, setups, patterns and exit reasons. Exclude snapshot rebalances.
- [x] Seven predefined approaches: current rules, required pattern confirmation, horizontal support, trendlines, four-hour hold, 1.5 ATR stop and 2:1 reward/risk. Other settings, risk limits and costs remain identical.
- [x] At least 600 contiguous completed hourly candles. Rank approaches on two chronological development windows (30–50% and 50–75% of history); require five closes in each. Rank worst-window return minus drawdown, not win rate.
- [x] Test only that selection and the incumbent on the last 25%; require ten closes each, positive selected net return, better return and no worse drawdown. Stress selected approach with no rebates and double slippage. Initial backtests use available history, not years of data.
- [x] Freeze development results, selection and final test. Persist their boundaries. New runs extend only the forward comparison; gaps preserve the checkpoint rather than restarting a search.
- [x] Four outcome model baselines: constant probability, regularized logistic regression, nine nearest neighbors and Gaussian naive Bayes. Actual closed paper trades only; entry-time features must predate entry by a completed hour. Require 100 eligible closes, 40/20/20 train/validation/test rows, both classes each, and purge trades whose outcomes cross a split. Select on validation Brier loss; evaluate that choice once on final test. A constant model can win.
- [x] Report selected-trade net outcomes alongside prediction error. This diagnostic is not a portfolio backtest, and does not control entries. A trained model's test stays frozen; no fitting every collection.
- [x] Same-input checkpoint prevents redundant research. Dashboard exposes private results only after unlocking.

## Repeating work
The separate Codex research automation runs every five hours. It dispatches `learning.yml` with `phase=research`, verifies the result, inspects new evidence and resumes this checklist. The existing trading, hourly collection, daily review and hourly recovery schedules are preserved. Research is manual-dispatch only in GitHub; it does not add a competing GitHub cron. Codex usage/reset time cannot be inspected or guaranteed. Failed or unavailable runs resume at a later opportunity.

Run from repository root using the private key injected into the environment (never put its value in a command, file in this repo, log or workflow source): `node scripts/strategy-lab.mjs`. GitHub obtains it from its existing Actions secret.

## Forward validation and adoption checkpoint
- [ ] Observe at least 72 new contiguous hourly candles from the frozen forward start, with 30 closes per comparison arm. Selected net return must be positive, beat current rules and have no higher drawdown.
- [ ] Resolve incomplete execution coverage. Hourly replay assumes checks happened and cannot reproduce actual missed five-minute checks, tick order, liquidity or historical order-book fills.
- [ ] Verify current fee assumptions; cached Coinbase tier and user-confirmed rebate eligibility are not live per-trade verification. Continue stress tests without rebates.
- [ ] Demonstrate adequate actual journal evidence and portfolio-wide performance under shared capital limits. Single-market replay does not prove portfolio performance.
- [ ] Only after sufficient independent forward evidence, implement/test a narrowly scoped daily-review promotion gate for the selected approach. Existing daily guards require complete coverage, a fresh heartbeat and sufficient outcomes. Any new promotion changes future entries only, never risk caps or existing positions. **The new lab cannot currently adopt its candidates.**
- [ ] Freeze a model's predictor and evaluate fresh future trades before considering an entry filter. Model-selected historical trade P&L alone is insufficient.
- [ ] If research justifies another experiment, register its hypothesis and candidate budget before new unseen data arrives, archive this report and preserve every failed version. Never reuse inspected final tests to pick a new winner.

## Known limits
No fitting algorithm can repair missing market observations. Small samples, correlated crypto markets, overlapping trades and nonstationarity limit confidence. Backtests use saved fee assumptions, simulated taker entries/stop/time exits, maker resting targets, adverse slippage and conservative intrabar stop priority; exact exchange mechanics are not reproduced. Do not claim all algorithms were tried, a best strategy was found, or profit is guaranteed. The $85,000 paper goal does not override evidence guards.
