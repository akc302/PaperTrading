import test from 'node:test';import assert from 'node:assert/strict';
import {ownerSwitchToSR,OWNER_SR_VERSION} from '../scripts/challengers.mjs';
test('main switches once to owner-sr rules with risk caps unchanged',()=>{
 const s={rulesVersion:'research-dip6h-v2',config:{strategy:'dip-6h',dipRsi:25,riskPct:0.01,maxTotalRisk:0.03,maxAllocation:0.25,maxOpenPositions:4,maxDailyLoss:0.04},productConfigs:{'BTC-USD':{dipRsi:20}}};
 assert.equal(ownerSwitchToSR(s,0),true);assert.equal(s.rulesVersion,OWNER_SR_VERSION);
 assert.equal(s.config.strategy,'horizontal');assert.equal(s.config.proximity,0.025);assert.equal(s.config.dipRsi,undefined);
 assert.equal(s.config.maxAllocation,0.25);assert.equal(s.config.riskPct,0.01);assert.deepEqual(s.productConfigs['BTC-USD'],{});
 assert.equal(ownerSwitchToSR(s,1),false);assert.equal(ownerSwitchToSR({config:{}},0),false);});
