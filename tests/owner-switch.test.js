import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';
import {ownerSwitchToHourly,migrateToTrend,OWNER_HOURLY_VERSION} from '../scripts/rules.mjs';
test('owner switch puts the hourly-legacy rules on the main paper account once, keeping caps, limit entries and ledgers',()=>{
 const pc={'BTC-USD':{patternRequired:true,maxHoldHours:24}};
 const state={rulesVersion:'trend-v1',config:{...DEFAULT_CONFIG,strategy:'trend-follow',trailAtrMultiplier:3,riskPct:0.02,maxAllocation:0.25,entryOrder:'limit'},productConfigs:{},account:createAccount(30000),
  challengers:[{id:'hourly-legacy',rules:{strategy:'aggressive',rewardRisk:1.5,maxHoldHours:2},productConfigs:pc,account:{...createAccount(30000),cash:30334}}]};
 const cash=state.account.cash;assert.equal(ownerSwitchToHourly(state,1.8e9),true);
 assert.equal(state.config.strategy,'aggressive');assert.equal(state.config.entryOrder,'limit');assert.equal(state.config.trailAtrMultiplier,undefined);
 assert.equal(state.config.riskPct,0.02);assert.equal(state.config.maxAllocation,0.25);assert.deepEqual(state.productConfigs,pc);
 assert.equal(state.account.cash,cash);assert.equal(state.challengers[0].account.cash,30334,'challenger ledger kept');
 assert.equal(state.rulesVersion,OWNER_HOURLY_VERSION);assert.equal(state.rulesHistory[0].previous.config.strategy,'trend-follow');
 assert.equal(ownerSwitchToHourly(state,1.8e9+60),false,'runs once');assert.equal(migrateToTrend(state,1.8e9+60),false,'never reverts to trend');
});

test('owner switch moves the main paper account to the dip-6h rules once, keeping caps and never reverting',async()=>{
 const {ownerSwitchToDip,OWNER_DIP_VERSION}=await import('../scripts/rules.mjs');
 const state={rulesVersion:OWNER_HOURLY_VERSION,config:{...DEFAULT_CONFIG,strategy:'aggressive',riskPct:0.02,maxAllocation:0.25,entryOrder:'limit'},productConfigs:{'BTC-USD':{patternRequired:true}},account:createAccount(30000),
  challengers:[{id:'scout-dip6h',riskScale:0.25,rules:{strategy:'dip-6h',dipRsi:25,stopAtrMultiplier:2,rewardRisk:1,maxHoldHours:48,patternRequired:false},account:createAccount(30000)},{id:'hourly-legacy',rules:{strategy:'aggressive'},account:createAccount(30000)}]};
 assert.equal(ownerSwitchToDip(state,1.9e9),true);
 assert.equal(state.config.strategy,'dip-6h');assert.equal(state.config.dipRsi,25);assert.equal(state.config.riskPct,0.02,'main caps kept, not the scout 1/4 scale');assert.equal(state.config.maxAllocation,0.25);
 assert.deepEqual(state.productConfigs,{});assert.equal(state.rulesVersion,OWNER_DIP_VERSION);
 assert.equal(ownerSwitchToDip(state,1.9e9+60),false);assert.equal(ownerSwitchToHourly(state,1.9e9+60),false,'never reverts to hourly');
});

test('dip2h switch sets 2h dip bars on the main paper account once, caps unchanged',async()=>{
 const {ownerSwitchToDip2h,OWNER_DIP_VERSION,OWNER_DIP2_VERSION}=await import('../scripts/rules.mjs');
 const state={rulesVersion:OWNER_DIP_VERSION,config:{...DEFAULT_CONFIG,strategy:'dip-6h',dipRsi:25,riskPct:0.02,maxAllocation:0.25},productConfigs:{},account:createAccount(30000),challengers:[]};
 assert.equal(ownerSwitchToDip2h(state,1.9e9),true);assert.equal(state.config.dipBarHours,2);assert.equal(state.config.riskPct,0.02);assert.equal(state.rulesVersion,OWNER_DIP2_VERSION);
 assert.equal(ownerSwitchToDip2h(state,1.9e9+1),false);assert.equal(ownerSwitchToHourly(state,1.9e9+1),false);
 const {dipSignal,analyze}=await import('../engine.js');assert.throws(()=>analyze([],{strategy:'dip-6h',dipBarHours:3}),/dip bar size/);
 const S=7200,t0=1_700_006_400,bars=(n,step,f)=>Array.from({length:n},(_,i)=>{const c=f(i);return {time:t0+i*step,open:c,high:c*1.01,low:c*0.99,close:c,volume:1};});
 const up=bars(150,86400,i=>100+i*0.5),two=bars(60,S,i=>i<50?170:170-(i-49)*4);
 assert.equal(dipSignal({twoHour:two,sixHour:[],daily:up},{dipRsi:25,dipBarHours:2,stopAtrMultiplier:2,rewardRisk:1}).signal,'BUY');
});

test('researcher moves the main paper account back to 6h dip bars once',async()=>{
 const m=await import('../scripts/rules.mjs');
 const state={rulesVersion:m.OWNER_DIP2_VERSION,config:{...DEFAULT_CONFIG,strategy:'dip-6h',dipRsi:25,dipBarHours:2,riskPct:0.02,maxAllocation:0.25},productConfigs:{},account:createAccount(30000),challengers:[]};
 assert.equal(m.backToDip6h(state,1.9e9),true);assert.equal(state.config.dipBarHours,undefined);assert.equal(state.config.riskPct,0.02);assert.equal(state.rulesVersion,m.DIP6_BACK_VERSION);
 assert.equal(m.backToDip6h(state,1.9e9+1),false);assert.equal(m.ownerSwitchToDip2h(state,1.9e9+1),false);assert.equal(m.ownerSwitchToDip(state,1.9e9+1),false);assert.equal(ownerSwitchToHourly(state,1.9e9+1),false);
});
