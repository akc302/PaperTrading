import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,normalizeCandles,analyze,createAccount,openPaperTrade,closePaperTrade,processCandles,markToMarket,backtest,reviewStrategy} from '../engine.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const bar=(time,open,high,low,close)=>({time,open,high,low,close,volume:10});
const config={...DEFAULT_CONFIG,pivotWindow:1,lookback:24,feeRate:0,slippage:0,rewardRisk:1};
const supportPattern=()=>[
  ...Array.from({length:12},(_,i)=>bar(i*3600,100,103+i%2,98-i%2,100)),
  bar(12*3600,100,101,95,99),bar(13*3600,99,110,98,105),bar(14*3600,105,106,96,96),
  bar(15*3600,96,97,95.1,95.2),bar(16*3600,95.2,96,95.15,95.5)
];

test('normalizes both Coinbase candle formats, deduplicates and rejects malformed OHLC',()=>{
  const input=[[7200,9,12,10,11,3],[0,1,4,2,3,2],[0,1,5,2,4,2],[3600,20,12,10,11,3]];
  const out=normalizeCandles(input);assert.equal(out.length,2);assert.equal(out[0].close,4);assert.equal(out[1].time,7200);
  assert.deepEqual(normalizeCandles({candles:[{start:'1',open:'2',high:'4',low:'1',close:'3',volume:'2'}]}),[bar(1,2,4,1,3)].map(x=>({...x,volume:2})));
});

test('cash ledger includes adverse entry/exit slippage and both fees',()=>{
  const a=createAccount();openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120,time:1});
  const p=a.positions[0];near(p.entry,100.05);assert.ok(a.cash>=0);assert.ok(p.quantity*p.entry+p.entryFee<=2500+1e-8);
  near(a.cash,10000-p.entry*p.quantity-p.entryFee);
  closePaperTrade(a,p.id,110,2,'manual');
  const t=a.trades[0];near(t.exit,109.945);near(a.cash,10000+t.pnl);near(t.fees,t.entryFee+t.exitFee);assert.ok(t.fees>0);
  near(markToMarket(a).realized,t.pnl);near(markToMarket(a).equity,a.cash);
});

test('planned stop loss including fees respects risk budget',()=>{
  const a=createAccount();openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120,time:1});
  const p=a.positions[0];closePaperTrade(a,p.id,90,2,'stop');near(a.trades[0].pnl,-100);
});

test('allocation cap includes buy fee and a second market cannot overdraw virtual cash',()=>{
  const a=createAccount(1000);const c={...config,maxAllocation:1};
  openPaperTrade(a,{product:'A-USD',price:100,stop:99.999,target:110,time:1},c);near(a.cash,0);
  assert.throws(()=>openPaperTrade(a,{product:'B-USD',price:100,stop:90,target:110,time:1},c),/Insufficient/);
});

test('rejects invalid brackets, duplicate positions, unsafe risk settings',()=>{
  const a=createAccount();assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:101,target:120}),/Stop/);
  assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120},{riskPct:1}),/risk/);
  openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120});
  assert.throws(()=>openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120}),/already/);
});

test('initial live synchronization never invents historical trades',()=>{
  const a=createAccount();processCandles(a,'BTC-USD',supportPattern(),config);
  assert.equal(a.positions.length,0);assert.equal(a.trades.length,0);assert.equal(a.lastProcessed['BTC-USD'],16*3600);
});

test('support signal waits for next open; current signal candle is never its fill',()=>{
  const bars=supportPattern();assert.equal(analyze(bars,config).signal,'BUY');
  const a=createAccount();processCandles(a,'BTC-USD',bars,config);
  assert.equal(a.positions.length,0);
  const next=bar(17*3600,95.5,95.9,95.3,95.7);
  processCandles(a,'BTC-USD',[...bars,next],config);
  assert.equal(a.positions.length,1);near(a.positions[0].entry,95.5);assert.equal(a.positions[0].openedAt,next.time);
  const before=JSON.stringify(a);processCandles(a,'BTC-USD',[...bars,next],config);assert.equal(JSON.stringify(a),before);
});

test('stops win ambiguous candles and a gap fills below the stop',()=>{
  const a=createAccount();processCandles(a,'BTC-USD',[bar(0,100,101,99,100)],config);
  openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:110,time:1},config);
  processCandles(a,'BTC-USD',[bar(0,100,101,99,100),bar(3600,80,120,70,100)],config,{autoTrade:false});
  assert.equal(a.trades[0].reason,'stop');near(a.trades[0].exit,80);assert.equal(a.positions.length,0);
});

test('incremental replay agrees with a full replay and cannot use future candles',()=>{
  const bars=[...supportPattern(),bar(17*3600,95.5,95.9,95.3,95.7),bar(18*3600,95.7,99,95.2,98),bar(19*3600,98,99,94,95)];
  const a=createAccount(),b=createAccount();processCandles(a,'BTC-USD',bars.slice(0,18),config,{replay:true});
  const firstEntry=a.positions[0]?.entry??a.trades[0]?.entry;near(firstEntry,95.5);
  processCandles(a,'BTC-USD',bars,config,{replay:true});processCandles(b,'BTC-USD',bars,config,{replay:true});
  assert.deepEqual(a,b);assert.ok(a.trades.length>0);
});

test('backtest costs reduce results and daily review retains parameters without evidence',()=>{
  const bars=[...supportPattern(),bar(17*3600,95.5,95.9,95.3,95.7),bar(18*3600,95.7,99,95.2,98)];
  const result=backtest(bars,config);assert.ok(result.closedTrades>=1);assert.ok(result.returnPct>0);
  assert.equal(reviewStrategy(bars,config).status,'insufficient-data');
  const flat=Array.from({length:300},(_,i)=>bar(i*3600,100,101,99,100));const review=reviewStrategy(flat,config);
  assert.equal(review.status,'retained');assert.match(review.reason,/fewer than five/);assert.equal(review.training.candles,210);assert.equal(review.holdout.candles,90);
});

test('next-open gaps cannot lower automated reward/risk below the configured net minimum',()=>{
  const bars=supportPattern().map((b,i)=>i<12?{...b,low:98}:b),c={...config,feeRate:0.001,slippage:0.0005,rewardRisk:2};
  const signal=analyze(bars,c);assert.equal(signal.signal,'BUY');
  const nextTime=17*3600;
  const gapOpen=95.6;
  assert.ok(signal.stop<gapOpen&&signal.target>gapOpen*(1+c.slippage),'old bracket-only check would allow this trade');
  const skipped=createAccount();processCandles(skipped,'BTC-USD',bars,c);
  processCandles(skipped,'BTC-USD',[...bars,bar(nextTime,gapOpen,95.9,95.3,95.7)],c);
  assert.equal(skipped.positions.length,0);assert.equal(skipped.trades.length,0);near(skipped.cash,10000);
  const accepted=createAccount();processCandles(accepted,'BTC-USD',bars,c);
  processCandles(accepted,'BTC-USD',[...bars,bar(nextTime,95.5,95.9,95.3,95.7)],c);
  assert.equal(accepted.positions.length,1);
  assert.ok(accepted.positions[0].estimatedRewardRisk>=2-1e-10);
  // A favorable gap preserves the same bracket and increases the net ratio.
  const favorable=createAccount();processCandles(favorable,'BTC-USD',bars,c);
  processCandles(favorable,'BTC-USD',[...bars,bar(nextTime,95.4,95.9,95.3,95.7)],c);
  assert.equal(favorable.positions.length,1);assert.ok(favorable.positions[0].estimatedRewardRisk>2);
});
