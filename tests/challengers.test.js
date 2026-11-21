import test from 'node:test';import assert from 'node:assert/strict';
import {createAccount,DEFAULT_CONFIG,openPaperTrade} from '../engine.js';
import {ensureChallengers,challengerConfig,runChallengers,CAP_KEYS,setChallengerRules} from '../scripts/challengers.mjs';
import {deflatedSharpe,reviewChallengers,evaluateChallenger,normInv,normCdf} from '../scripts/promotion.mjs';
import {migrateToTrend} from '../scripts/rules.mjs';
import {applyLab} from '../scripts/strategy-lab.mjs';
const T=Date.parse('2026-11-20T12:02:00Z')/1000;
const base=()=>{const s={config:{...DEFAULT_CONFIG,strategy:'aggressive',riskPct:.02,maxTotalRisk:.08,maxAllocation:.25,maxDailyLoss:.12,maxHoldHours:2},productConfigs:{'BTC-USD':{strategy:'aggressive',patternRequired:true,maxHoldHours:24}},products:['BTC-USD','ETH-USD'],account:createAccount(30000),feeProfile:{feeRate:.003,makerFeeRate:.0015,takerFeeRate:.003}};migrateToTrend(s,T);ensureChallengers(s,T);return s;};
const bars=now=>{const out=[];for(let t=Math.floor(now/3600)*3600-30*3600;t+3600<=now;t+=3600)out.push({time:t,open:100,high:101,low:99,close:100.5,volume:1});return out;};
test('3-5 challengers seed with fresh accounts and inherit the main risk caps and fees',()=>{
 const s=base();assert.ok(s.challengers.length>=3&&s.challengers.length<=5);assert.ok(s.challengers.every(c=>c.account.initial===30000&&c.account.compactJournal));
 for(const ch of s.challengers)for(const p of s.products){const c=challengerConfig(s,ch,p);for(const k of CAP_KEYS)assert.equal(c[k],s.config[k]);assert.equal(c.takerFeeRate,.003);}
 const legacy=s.challengers.find(c=>c.id==='hourly-legacy');assert.equal(challengerConfig(s,legacy,'BTC-USD').strategy,'aggressive');assert.equal(challengerConfig(s,legacy,'BTC-USD').patternRequired,true);
 assert.equal(challengerConfig(s,legacy,'BTC-USD').trailAtrMultiplier,undefined);assert.equal(ensureChallengers(s,T),false);
});
test('challengers trade the same quote events in separate ledgers; one failure never touches the others',()=>{
 const s=base(),events=s.products.map(p=>({product:p,quote:{price:'100.5',time:new Date(T*1000).toISOString()},bars:bars(T)}));
 s.challengers[0].account=null;runChallengers(s,events,T);
 assert.ok(s.challengers[0].lastError);const legacy=s.challengers.find(c=>c.id==='hourly-legacy');assert.equal(legacy.lastError,null);assert.ok(legacy.account.decisions.length>0);assert.equal(s.account.decisions.length,0);
});
test('multiple-testing threshold rises with the number of candidates tried',()=>{
 assert.ok(Math.abs(normInv(.975)-1.95996)<1e-4&&Math.abs(normCdf(1.96)-.975)<1e-3);
 const r=Array.from({length:200},(_,i)=>.002+.01*Math.sin(i*1.7));const a=deflatedSharpe(r,2),b=deflatedSharpe(r,50),c=deflatedSharpe(r,500);
 assert.ok(a.threshold<b.threshold&&b.threshold<c.threshold);assert.ok(a.psr>=b.psr&&b.psr>=c.psr);assert.equal(deflatedSharpe(r.slice(0,5),5).pass,false);
});
test('promotion needs 7 days, 20 trades, higher net, PF 1.2 and no worse drawdown; every decision is logged once a day',()=>{
 const s=base(),ch=s.challengers[0],r=evaluateChallenger(s,ch,{market:{products:{}},history:{},now:T+86400});
 assert.equal(r.decision,'rejected');assert.ok(r.failed.includes('liveDays')&&r.failed.includes('liveTrades'));assert.ok(Number.isFinite(r.deflatedSharpe.trials));
 const out=reviewChallengers(s,{market:{products:{}},history:{},now:T+86400});assert.equal(out.promoted,null);assert.equal(s.promotionHistory.length,s.challengers.length);
 assert.equal(reviewChallengers(s,{market:{products:{}},history:{},now:T+86400+60}),null);
});
test('a challenger that clears every gate becomes the main rules; caps stay fixed and the old rules become a challenger',()=>{
 const s=base(),caps=CAP_KEYS.map(k=>s.config[k]),winner=s.challengers.find(c=>c.id==='trend-k4');
 const evaluate=(st,ch)=>({challenger:ch.id,decision:ch.id==='trend-k4'?'eligible':'rejected',gates:{},failed:[],live:{challenger:{netPnl:ch.id==='trend-k4'?500:0}}});
 const out=reviewChallengers(s,{market:{products:{}},history:{},now:T+8*86400,evaluate});
 assert.equal(out.promoted,'trend-k4');assert.equal(s.config.trailAtrMultiplier,4);assert.deepEqual(CAP_KEYS.map(k=>s.config[k]),caps);
 assert.equal(winner.rules.trailAtrMultiplier,3);assert.equal(winner.source,'demoted main rules');assert.equal(s.rulesHistory[0].event,'promoted-challenger');
 assert.ok(s.promotionHistory.some(h=>h.decision==='promoted')&&s.promotionHistory.some(h=>h.decision==='rejected'));
});
test('lab research feeds challengers instead of replacing the trend-follow main rules',()=>{
 const s=base(),before=structuredClone(s.productConfigs),lab=s.challengers.find(c=>c.id==='lab-hourly'),since=lab.rulesSince;
 const report={updatedAt:new Date((T+3600)*1000).toISOString(),inputHash:'x',products:{'BTC-USD':{decision:'shadow',shadowOf:'adopt-improvement',selected:'donchian-breakout',changes:{strategy:'donchian',maxHoldHours:24}}},trend:{status:'validated-on-2y',selected:'trend-k2-top3',changes:{strategy:'trend-follow',trailAtrMultiplier:2,trendTopN:3}}};
 applyLab(s,report);assert.deepEqual(s.productConfigs,before);assert.equal(lab.productConfigs['BTC-USD'].strategy,'donchian');assert.notEqual(lab.rulesSince,since);
 assert.equal(s.challengers.find(c=>c.id==='lab-trend').rules.trailAtrMultiplier,2);assert.equal(s.strategyLab.fedChallengers.length,2);
 assert.equal(setChallengerRules(lab,{productConfigs:lab.productConfigs},T),false);
});
