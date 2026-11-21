import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,DEFAULT_CONFIG,createAccount} from '../engine.js';
import {diagnose,runLab,adopt,FROZEN} from '../scripts/strategy-lab.mjs';

const series=(n,f)=>Array.from({length:n},(_,i)=>{const c=f(i),o=f(i-1)||c;return {time:1.7e9+i*3600,open:o,high:Math.max(o,c)*1.003,low:Math.min(o,c)*.997,close:c,volume:100+(i%7)*10};});

test('indicator strategies return a cost-aware bracket and only BUY with a stop below price',()=>{
 const bars=series(200,i=>100+i*.2+Math.sin(i/3)*1.5);
 for(const strategy of ['ema-trend','donchian','rsi-reversion']){
  const a=analyze(bars,{...DEFAULT_CONFIG,strategy});
  assert.equal(a.strategy,strategy);assert.ok(['BUY','WAIT'].includes(a.signal));
  assert.ok(a.stop<a.price&&a.target>a.price,strategy);
 }
 assert.equal(analyze(bars.slice(0,50),{...DEFAULT_CONFIG,strategy:'donchian'}).signal,'WAIT');
});

test('ML filter blocks entries below its probability threshold',()=>{
 const bars=series(200,i=>100+i*.3);
 const open={...DEFAULT_CONFIG,strategy:'aggressive'};
 assert.equal(analyze(bars,open).signal,'BUY');
 const blocked=analyze(bars,{...open,mlWeights:[-30,0,0,0,0,0,0],mlThreshold:.5});
 assert.equal(blocked.signal,'WAIT');assert.match(blocked.reason,/ML entry filter/);
 assert.throws(()=>analyze(bars,{...open,mlWeights:[1,2],mlThreshold:.5}),/ML/);
});

test('diagnosis attributes losses to costs, time exits and clustered entries',()=>{
 const account=createAccount();const t0=1.7e9;
 account.trades=['A','B','C'].map(product=>({product,entry:100,exit:99.5,target:106,stop:98,quantity:10,fees:12,pnl:-17,reason:'time-exit',openedAt:t0,closedAt:t0+7200,maxHoldHours:2,feeRate:.006,slippage:.0005,source:'aggressive-exploration'}));
 const market={products:Object.fromEntries(['A','B','C'].map(p=>[p,{candles:series(5,()=>100).map((b,i)=>({...b,time:t0+i*3600-3600}))}]))};
 const d=diagnose(account,market);
 assert.equal(d.wins,0);assert.equal(d.byReason['time-exit'].trades,3);
 assert.ok(d.findings.some(f=>/Fees/.test(f)));assert.ok(d.findings.some(f=>/time exit/.test(f)));assert.ok(d.findings.some(f=>/together/.test(f)));
 assert.equal(d.targetReachedDuringHold,0);
});

test('lab retains rules in a steadily falling market and adoption never changes risk caps',()=>{
 const falling=series(520,i=>200*Math.pow(.9993,i)+Math.sin(i/2));
 const market={products:Object.fromEntries(['X-USD','Y-USD','Z-USD'].map(p=>[p,{candles:falling}]))};
 const report=runLab(market,{...DEFAULT_CONFIG,strategy:'aggressive',maxHoldHours:2},{now:falling.at(-1).time+3601});
 assert.equal(report.status,'retain');assert.ok(report.finalists.length>=5);assert.ok(report.failedExperiments>0);
 const state={config:{...DEFAULT_CONFIG,strategy:'aggressive'},productConfigs:{'X-USD':{strategy:'trendline',riskPct:.01}}};
 const caps=FROZEN.map(k=>state.config[k]);
 assert.equal(adopt(state,report),false);
 assert.equal(adopt(state,{status:'adopt',winner:{config:{strategy:'ema-trend',rewardRisk:2.5}}}),true);
 assert.equal(state.config.strategy,'ema-trend');assert.deepEqual(FROZEN.map(k=>state.config[k]),caps);
 assert.equal(state.productConfigs['X-USD'].strategy,undefined);assert.equal(state.productConfigs['X-USD'].riskPct,.01);
 assert.throws(()=>adopt(state,{status:'adopt',winner:{config:{riskPct:.05}}}),/Risk cap/);
});
