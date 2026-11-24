import test from 'node:test';
import assert from 'node:assert/strict';
import {dipSignal,analyze,STRATEGIES} from '../engine.js';
import {seedChallengers,challengerConfig} from '../scripts/challengers.mjs';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';

const D=86400,S=21600,t0=1_700_006_400;
const bars=(n,step,f)=>Array.from({length:n},(_,i)=>{const c=f(i);return {time:t0+i*step,open:c,high:c*1.01,low:c*0.99,close:c,volume:1};});
const upDaily=bars(150,D,i=>100+i*0.5),downDaily=bars(150,D,i=>200-i*0.5);
const dipSix=bars(60,S,i=>i<50?170:170-(i-49)*4);

test('dip-6h buys a sharp 6h dip only inside a daily uptrend',()=>{
 assert.ok(STRATEGIES.includes('dip-6h'));
 const buy=dipSignal({sixHour:dipSix,daily:upDaily},{stopAtrMultiplier:2,rewardRisk:1,dipRsi:25});
 assert.equal(buy.signal,'BUY');assert.ok(buy.rsi6h<25);assert.ok(buy.stop<buy.price&&buy.target>buy.price);
 assert.equal(dipSignal({sixHour:dipSix,daily:downDaily},{dipRsi:25}).signal,'WAIT');
 assert.equal(dipSignal({sixHour:bars(60,S,()=>170),daily:upDaily},{dipRsi:25}).signal,'WAIT','no dip, no entry');
 assert.equal(dipSignal({sixHour:dipSix.slice(0,10),daily:upDaily}).signal,'WAIT','needs history');
 assert.throws(()=>analyze([],{strategy:'dip-6h',dipRsi:99}),/dip RSI/);
});

test('scout-dip6h is a researcher challenger at 1/4 risk on the dip-6h strategy',()=>{
 const state={config:{...DEFAULT_CONFIG,riskPct:0.02},account:createAccount(30000)};
 const ch=seedChallengers(state).find(c=>c.id==='scout-dip6h');assert.ok(ch);assert.equal(ch.source,'researcher');
 const c=challengerConfig(state,ch,'BTC-USD');assert.equal(c.strategy,'dip-6h');assert.equal(c.dipRsi,25);assert.equal(c.maxHoldHours,48);assert.ok(Math.abs(c.riskPct-0.005)<1e-12);
});

test('dip-6h capitulation bounce needs an oversold bar then a bullish reversal close',()=>{
 const drop=bars(60,S,i=>i<50?170:170-(i-49)*4),last=drop.at(-1);
 const bounce=[...drop.slice(0,-1),{...last,open:last.close*0.97,low:last.close*0.96,close:last.close*1.04,high:last.close*1.05}];
 assert.equal(dipSignal({sixHour:drop,daily:downDaily},{dipRsi:30,dipConfirm:true,dipTrend:false}).signal,'WAIT','no reversal close yet');
 const b=dipSignal({sixHour:bounce,daily:downDaily},{dipRsi:30,dipConfirm:true,dipTrend:false});
 assert.equal(b.signal,'BUY');assert.match(b.reason,/counter-trend/);assert.ok(b.stop<b.price&&b.target>b.price);
 assert.equal(dipSignal({sixHour:bounce,daily:downDaily},{dipRsi:30,dipConfirm:true}).signal,'WAIT','trend filter stays on by default');
});

test('dip-6h squeeze mode buys a 6h close above the upper band after a volatility contraction',()=>{
 const wave=i=>170+Math.sin(i/3)*6,flat=i=>170+Math.sin(i)*0.2;
 const six=bars(200,S,i=>i<150?wave(i):i<199?flat(i):176);
 const s=dipSignal({sixHour:six,daily:downDaily},{dipMode:'squeeze',dipTrend:false,stopAtrMultiplier:2,rewardRisk:2});
 assert.equal(s.signal,'BUY');assert.equal(s.setup,'6h-squeeze-breakout');assert.ok(s.squeezeRank<=0.2);assert.ok(s.stop<s.price&&s.target>s.price);
 assert.equal(dipSignal({sixHour:bars(200,S,wave),daily:downDaily},{dipMode:'squeeze',dipTrend:false}).signal,'WAIT','no contraction, no entry');
 assert.equal(dipSignal({sixHour:six,daily:downDaily},{dipMode:'squeeze'}).signal,'WAIT','daily trend filter on by default');
 assert.throws(()=>analyze([],{strategy:'dip-6h',dipMode:'pump'}),/dip-6h mode/);
});
