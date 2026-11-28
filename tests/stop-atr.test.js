import test from 'node:test';import assert from 'node:assert/strict';
import {analyze,DEFAULT_CONFIG,normalizeCandles} from '../engine.js';
test('stopAtr puts the horizontal stop at least k ATR below support',()=>{
 const bars=[];let t=1700000000;for(let i=0;i<120;i++){const base=100+5*Math.sin(i/6);bars.push({time:t+i*3600,open:base,high:base+1.5,low:base-1.5,close:base+0.2,volume:10});}
 const c={...DEFAULT_CONFIG,strategy:'horizontal',proximity:0.08,lookback:72,stopBuffer:0.001,rewardRisk:0.5,patternRequired:false,regimeFilter:false};
 const a=analyze(normalizeCandles(bars),c),b=analyze(normalizeCandles(bars),{...c,stopAtr:1});
 if(!a.support||!b.atr)return;
 assert.ok(b.stop<=a.stop);assert.ok(b.stop<=b.support-b.atr+1e-9);
 assert.throws(()=>analyze(normalizeCandles(bars),{...c,stopAtr:-1}));});
