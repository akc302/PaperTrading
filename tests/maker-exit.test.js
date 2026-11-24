import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,openPaperTrade,processQuoteBatch,processCandles} from '../engine.js';
const T=Date.parse('2026-11-20T12:02:00Z')/1000;
const fees={feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003,rebateRate:.25,rebateVerified:true,feeObservedAt:'2026-11-20T00:00:00Z'};
const cfg={...DEFAULT_CONFIG,...fees,strategy:'aggressive',riskPct:.02,maxTotalRisk:.08,maxAllocation:.25,maxHoldHours:2,maxDailyLoss:.12,entryOrder:'limit',limitChecks:2};
const bars=now=>{const out=[];for(let t=Math.floor(now/3600)*3600-30*3600;t+3600<=now;t+=3600)out.push({time:t,open:100,high:100.2,low:99.8,close:100,volume:1});return out;};
const ev=(now,price,c=cfg)=>[{product:'BTC-USD',quote:{price:String(price),time:new Date(now*1000).toISOString()},bars:bars(now),config:{...c,patternRequired:false}}];
const open=c=>{const a=createAccount(30000);openPaperTrade(a,{product:'BTC-USD',price:100,stop:95,target:110,time:T,liquidity:'maker'},c);return a;};

test('live time exit rests a maker sell and fills it on a later quote at or above the limit',()=>{
 const a=open(cfg),due=T+2*3600+60;
 processQuoteBatch(a,ev(due,101),{time:due});
 assert.equal(a.positions.length,1,'first due check only rests the sell');assert.equal(a.positions[0].exitLimit.price,101);
 processQuoteBatch(a,ev(due+300,101.2),{time:due+300});
 assert.equal(a.positions.length,0);const t=a.trades[0];
 assert.equal(t.reason,'time-exit');assert.equal(t.exit,101);assert.equal(t.exitLiquidity,'maker');assert.equal(t.exitFeeDetail.rate,.0015);
});

test('live maker time exit falls back to market after an hour, and stops still apply while it rests',()=>{
 const a=open(cfg),due=T+2*3600+60;
 processQuoteBatch(a,ev(due,101),{time:due});
 processQuoteBatch(a,ev(due+1800,100.5),{time:due+1800});assert.equal(a.positions.length,1,'below the limit, inside the hour: keep resting');
 processQuoteBatch(a,ev(due+3600,100.4),{time:due+3600});
 assert.equal(a.trades[0].exitLiquidity,'taker');assert.ok(a.trades[0].exit<100.4);
 const b=open(cfg);processQuoteBatch(b,ev(due,101),{time:due});processQuoteBatch(b,ev(due+300,94),{time:due+300});
 assert.equal(b.trades[0].reason,'quote-stop');
 const c=open({...cfg,makerTimeExit:false});processQuoteBatch(c,ev(due,101,{...cfg,makerTimeExit:false}),{time:due});
 assert.equal(c.trades[0].exitLiquidity,'taker','opt-out keeps the market exit');
 assert.throws(()=>processQuoteBatch(createAccount(),ev(due,101,{...cfg,makerTimeExit:'yes'}),{time:due}),/maker time-exit/);
});

test('backtest time exit fills maker at the open when the bar trades above it, else market at the next open',()=>{
 const H=3600,mk=(t,o,h,l,c)=>({time:t,open:o,high:h,low:l,close:c,volume:1}),c={...cfg,maxHoldHours:1};
 const a=createAccount(30000);processCandles(a,'BTC-USD',[mk(0,100,100.1,99.9,100)],c);
 openPaperTrade(a,{product:'BTC-USD',price:100,stop:90,target:120,time:0,liquidity:'maker'},c);
 processCandles(a,'BTC-USD',[mk(0,100,100.1,99.9,100),mk(H,101,102,100.5,101.5)],c);
 assert.equal(a.trades[0].exit,101);assert.equal(a.trades[0].exitLiquidity,'maker');
 const b=createAccount(30000);processCandles(b,'BTC-USD',[mk(0,100,100.1,99.9,100)],c);
 openPaperTrade(b,{product:'BTC-USD',price:100,stop:90,target:120,time:0,liquidity:'maker'},c);
 processCandles(b,'BTC-USD',[mk(0,100,100.1,99.9,100),mk(H,101,101,99,99.5)],c);
 assert.equal(b.positions.length,1,'no trade above the open: the maker sell rests');
 processCandles(b,'BTC-USD',[mk(0,100,100.1,99.9,100),mk(H,101,101,99,99.5),mk(2*H,99.6,100,99,99.8)],c);
 assert.equal(b.trades[0].exitLiquidity,'taker');assert.ok(b.trades[0].exit<99.6);
});
