import test from 'node:test';import assert from 'node:assert/strict';
import {teamReport,GOAL} from '../scripts/team-report.mjs';import {createAccount} from '../engine.js';
const now=1.8e9;
test('manager scores goal progress and flags stalled agents for restart',()=>{
 const a=createAccount(10000);a.cash=9000;a.trades=Array.from({length:12},(_,i)=>({product:'BTC-USD',pnl:-10,fees:2,rebateCredited:.5,openedAt:now-90000+i,closedAt:now-1000,reason:'stop'}));
 const r=teamReport({account:a,products:['BTC-USD'],config:{strategy:'aggressive'},productConfigs:{'BTC-USD':{patternRequired:true}},updatedAt:new Date((now-3600)*1000).toISOString(),autoTrade:true},{products:{}},now);
 assert.equal(r.goal,GOAL);assert.equal(r.equity,9000);assert.ok(r.progressToGoal<0);assert.equal(r.losingStreak,12);assert.equal(r.last24h.closedTrades,12);assert.equal(r.allTime.rebatesCredited,6);
 assert.deepEqual(r.dispatch,['update.yml','learning.yml:research']);assert.equal(r.verdict,'needs-attention');assert.ok(r.issues.some(i=>/losing trades in a row/.test(i)));
 const ok=teamReport({account:createAccount(),products:[],config:{},updatedAt:new Date(now*1000).toISOString(),strategyLab:{updatedAt:new Date(now*1000).toISOString()}},{products:{}},now);
 assert.equal(ok.verdict,'on-track');assert.deepEqual(ok.dispatch,[]);
});
