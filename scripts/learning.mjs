/** Reproducible public-market logistic regression. Shadow research, never a win guarantee. */
import {normalizeCandles} from '../engine.js';
export function featuresAt(bars,i){
 if(i<24)return null;const p=bars[i].close,prev=bars[i-1],recent=bars.slice(i-23,i+1),range=recent.reduce((s,b)=>s+(b.high-b.low)/b.close,0)/24;
 return [1,(p/prev.close-1)*50,(p/bars[i-4].close-1)*25,(p/bars[i-12].close-1)*10,range*50,(bars[i].close-bars[i].open)/(bars[i].high-bars[i].low||1),((p/Math.min(...recent.map(b=>b.low)))-1)*10].map(v=>Math.max(-5,Math.min(5,v)));
}
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const predict=(w,x)=>sigmoid(w.reduce((s,v,i)=>s+v*x[i],0));
export function trainShadow(products,{feeRate=.006,horizon=4}={}){
 const datasets=Object.entries(products).map(([product,value])=>({product,bars:normalizeCandles(value.candles??value)}));
 const times=[...new Set(datasets.flatMap(v=>v.bars.map(b=>b.time)))].sort((a,b)=>a-b);
 if(times.length<240)return {status:'collecting-data',mode:'shadow',reason:'Need at least 240 distinct completed hourly timestamps.'};
 const split=times[Math.floor(times.length*.7)],train=[],holdout=[];
 for(const {product,bars}of datasets)for(let i=24;i+horizon<bars.length;i++){
  if(bars[i+horizon].time!==bars[i].time+horizon*3600)continue;
  const x=featuresAt(bars,i),sample={product,time:bars[i].time,labelTime:bars[i+horizon].time,x,y:bars[i+horizon].close/bars[i].close-1>2*feeRate+.001?1:0};
  if(sample.labelTime<split)train.push(sample);else if(sample.time>=split)holdout.push(sample);
 }
 if(train.length<100||holdout.length<50)return {status:'collecting-data',mode:'shadow',reason:'Insufficient training or holdout samples.'};
 if(new Set(train.map(s=>s.y)).size<2||new Set(holdout.map(s=>s.y)).size<2)return {status:'collecting-data',mode:'shadow',reason:'Both profitable and unprofitable labels are required in training and holdout.'};
 const weights=Array(7).fill(0);
 for(let epoch=0;epoch<160;epoch++){
  const gradient=Array(7).fill(0);
  for(const s of train){const err=predict(weights,s.x)-s.y;for(let j=0;j<7;j++)gradient[j]+=err*s.x[j];}
  for(let j=0;j<7;j++)weights[j]-=.08*(gradient[j]/train.length+(j?.02*weights[j]:0));
 }
 const base=train.reduce((s,v)=>s+v.y,0)/train.length;
 const brier=holdout.reduce((s,v)=>s+(predict(weights,v.x)-v.y)**2,0)/holdout.length;
 const baselineBrier=holdout.reduce((s,v)=>s+(base-v.y)**2,0)/holdout.length;
 const accuracy=holdout.filter(v=>(predict(weights,v.x)>=.5?1:0)===v.y).length/holdout.length;
 return {status:'trained-shadow',mode:'shadow',model:'regularized logistic regression',features:['bias','1h return','4h return','12h return','24h relative range','candle body fraction','distance from 24h low'],horizonHours:horizon,label:'Future four-hour close exceeds modeled round-trip taker costs plus 0.1% slippage buffer',feeRate,splitTime:split,trainSamples:train.length,holdoutSamples:holdout.length,latestTrainingLabel:Math.max(...train.map(s=>s.labelTime)),earliestHoldoutFeature:Math.min(...holdout.map(s=>s.time)),weights,holdout:{brier,baselineBrier,accuracy,beatsConstantBaseline:brier<baselineBrier},predictions:Object.fromEntries(datasets.filter(v=>v.bars.length>24).map(({product,bars})=>[product,{time:bars.at(-1).time,probability:predict(weights,featuresAt(bars,bars.length-1))}])),warning:'Historical candle labels, not real wins. Overlapping samples and market changes limit validity. Shadow-only; does not control trades or promise profits.'};
}
