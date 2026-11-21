/** Fixed-budget research. No orders, account mutations, risk changes, or strategy adoption. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {backtest,normalizeCandles,DEFAULT_CONFIG} from '../engine.js';
import {eligibleTrades,summarize} from './evidence.mjs';
import {decryptState,encryptState} from './private-state.mjs';
export const EXPERIMENT='cost-aware-v1';
export const CANDIDATES=Object.freeze([
 {id:'current',changes:{}},
 {id:'pattern-confirmation',changes:{patternRequired:true}},
 {id:'horizontal-support',changes:{strategy:'horizontal'}},
 {id:'trendline',changes:{strategy:'trendline'}},
 {id:'longer-hold',changes:{maxHoldHours:4}},
 {id:'wider-stop',changes:{stopAtrMultiplier:1.5}},
 {id:'higher-reward',changes:{rewardRisk:2}},
]);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const avg=xs=>xs.reduce((s,v)=>s+v,0)/xs.length;
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function modelRows(trades){return trades.filter(t=>Number.isFinite(t.pnl)&&Number.isFinite(t.openedAt)&&Number.isFinite(t.closedAt)&&t.closedAt>=t.openedAt&&Number.isFinite(t.learningContext?.featureTime)&&t.learningContext.featureTime+3600<=t.openedAt&&t.learningContext.features?.length===7&&t.learningContext.features.every(Number.isFinite)).map(t=>({x:t.learningContext.features,y:+(t.pnl>0),pnl:t.pnl,openedAt:t.openedAt,closedAt:t.closedAt})).sort((a,b)=>a.openedAt-b.openedAt);}
export function chronologicalSplit(rows){const a=rows[Math.floor(rows.length*.5)]?.openedAt,b=rows[Math.floor(rows.length*.75)]?.openedAt;return {train:rows.filter(t=>t.closedAt<a),validation:rows.filter(t=>t.openedAt>=a&&t.closedAt<b),test:rows.filter(t=>t.openedAt>=b)};}
function fit(kind,rows){
 const prior=(rows.filter(r=>r.y).length+1)/(rows.length+2);
 if(kind==='constant')return ()=>prior;
 if(kind==='logistic'){
  const w=Array(7).fill(0);
  for(let e=0;e<160;e++){const g=Array(7).fill(0);for(const r of rows){const err=sigmoid(dot(w,r.x))-r.y;g.forEach((_,j)=>g[j]+=err*r.x[j]);}w.forEach((_,j)=>w[j]-=.08*(g[j]/rows.length+(j?.02*w[j]:0)));}
  return x=>sigmoid(dot(w,x));
 }
 if(kind==='nearest-neighbors')return x=>{const near=rows.map(r=>({r,d:r.x.reduce((s,v,j)=>s+(v-x[j])**2,0)})).sort((a,b)=>a.d-b.d).slice(0,9);return (near.reduce((s,v)=>s+v.r.y,0)+1)/(near.length+2);};
 if(kind==='gaussian-naive-bayes'){
  const stats=[0,1].map(y=>{const rs=rows.filter(r=>r.y===y);return Array.from({length:7},(_,j)=>{const mean=avg(rs.map(r=>r.x[j]));return {mean,variance:Math.max(.01,avg(rs.map(r=>(r.x[j]-mean)**2)))};});});
  return x=>{const log=[Math.log(1-prior),Math.log(prior)];for(let y=0;y<2;y++)for(let j=1;j<7;j++){const {mean,variance}=stats[y][j];log[y]-=.5*(Math.log(variance)+(x[j]-mean)**2/variance);}return sigmoid(log[1]-log[0]);};
 }
 throw Error('Unknown fixed model');
}
const score=(predict,rows)=>({brier:avg(rows.map(r=>(predict(r.x)-r.y)**2)),samples:rows.length,selectedTrades:rows.filter(r=>predict(r.x)>=.5).length,selectedNetPnl:rows.filter(r=>predict(r.x)>=.5).reduce((s,r)=>s+r.pnl,0),allNetPnl:rows.reduce((s,r)=>s+r.pnl,0)});
export function compareModels(trades){
 const rows=modelRows(trades),base={mode:'shadow',eligible:rows.length,minimum:100};
 if(rows.length<100)return {...base,status:'collecting-data',reason:'Need 100 closed trades with entry-time features; no invented or reconstructed labels.'};
 const {train,validation,test}=chronologicalSplit(rows);
 if(train.length<40||validation.length<20||test.length<20||[train,validation,test].some(rs=>new Set(rs.map(r=>r.y)).size<2))return {...base,status:'collecting-data',reason:'Need 40 training, 20 validation and 20 final-test rows, both classes in each; trades crossing boundaries are purged.'};
 const kinds=['constant','logistic','nearest-neighbors','gaussian-naive-bayes'];
 const ranking=kinds.map(id=>({id,...score(fit(id,train),validation)})).sort((a,b)=>a.brier-b.brier||a.id.localeCompare(b.id));
 const selected=ranking[0].id,predict=fit(selected,train),result=score(predict,test),baseline=score(fit('constant',train),test);
 return {...base,status:'evaluated-shadow',selected,validation:ranking,finalTest:result,baseline,trainSamples:train.length,latestTrainingOutcome:Math.max(...train.map(t=>t.closedAt)),firstValidationEntry:Math.min(...validation.map(t=>t.openedAt)),latestValidationOutcome:Math.max(...validation.map(t=>t.closedAt)),firstTestEntry:Math.min(...test.map(t=>t.openedAt)),passed:selected!=='constant'&&result.brier<baseline.brier&&result.selectedTrades>=10&&result.selectedNetPnl>0,reason:'Validation chooses one model; the final test cannot choose a replacement. Predictive accuracy alone is not profitability; selected-trade P&L is descriptive, not a portfolio replay.'};
}
function metrics(bars,config,startTime){
 const r=backtest(bars,config,{startTime}),trades=r.account.trades;
 return {returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,netPnl:r.realized,grossFees:r.totalFees,rebatesCredited:trades.reduce((s,t)=>s+(t.rebateCredited??0),0),expectancy:trades.length?r.realized/trades.length:null};
}
function segment(bars,config,start,end){return metrics(bars.slice(Math.max(0,start-240),end),config,bars[start].time);}
function researchProduct(input,config,previous,now){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=now);
 const contiguous=bars.every((b,i)=>!i||b.time===bars[i-1].time+3600);
 if(bars.length<600||!contiguous)return previous?.experiment===EXPERIMENT?{...structuredClone(previous),status:'forward-data-gap',forwardReason:'Missing history; frozen tests retained. No forward evaluation.'}:{status:'collecting-data',reason:'Need 600 contiguous completed hourly bars; gaps are not filled with invented prices.'};
 // Historical winner and test remain frozen; new candles extend a forward shadow comparison only.
 if(previous?.experiment===EXPERIMENT){
  const out=structuredClone(previous),start=bars.findIndex(b=>b.time>=out.forwardStart);
  if(start<0||bars.at(0).time>out.forwardStart||bars.length-start<72)return {...out,status:out.status==='forward-shadow'?'forward-gap':out.status,forwardReason:'Need at least 72 new contiguous hourly bars with full forward-window coverage.'};
  const c=out.frozenConfig,chosen=CANDIDATES.find(v=>v.id===out.selected),n=segment(bars,{...c,...chosen.changes},start,bars.length),baseline=segment(bars,c,start,bars.length);
  return {...out,status:'forward-shadow',forward:{candidate:n,baseline,through:bars.at(-1).time,passed:n.closedTrades>=30&&baseline.closedTrades>=30&&n.returnPct>0&&n.returnPct>baseline.returnPct&&n.drawdown<=baseline.drawdown},forwardReason:'Forward shadow replay is not approval to change live paper entries; execution coverage and daily-review guards still apply.'};
 }
 const cut=Math.floor(bars.length*.75),middle=Math.floor(bars.length*.5),start=Math.floor(bars.length*.3);
 const ranking=CANDIDATES.map(({id,changes})=>{const c={...config,...changes},folds=[segment(bars,c,start,middle),segment(bars,c,middle,cut)];return {id,folds,score:Math.min(...folds.map(f=>f.returnPct-f.drawdown)),eligible:folds.every(f=>f.closedTrades>=5)};}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.id.localeCompare(b.id));
 const selected=ranking.find(r=>r.eligible)?.id??'current',chosen=CANDIDATES.find(c=>c.id===selected),candidateConfig={...config,...chosen.changes};
 const finalTest={candidate:segment(bars,candidateConfig,cut,bars.length),baseline:segment(bars,config,cut,bars.length)};
 const stress=segment(bars,{...candidateConfig,rebateVerified:false,rebateRate:0,slippage:config.slippage*2},cut,bars.length);
 const c=finalTest.candidate,b=finalTest.baseline,passed=selected!=='current'&&c.closedTrades>=10&&b.closedTrades>=10&&c.returnPct>0&&c.returnPct>b.returnPct&&c.drawdown<=b.drawdown&&stress.returnPct>0;
 return {experiment:EXPERIMENT,status:passed?'awaiting-forward-evidence':'no-validated-edge',selected,frozenConfig:config,development:ranking,finalTest,stress,passed,selectionEnd:bars[cut].time,historyStart:bars[0].time,forwardStart:Math.max(bars.at(-1).time+3600,Math.ceil(now/3600)*3600),registeredAt:new Date(now*1000).toISOString(),reason:'Seven predefined approaches ranked on two earlier chronological windows; only the selected approach and baseline use the final test. No retry against the test after a loss. Stress removes rebates and doubles slippage.'};
}
export function runLab(state,market,now=Date.now()/1000){
 const trades=eligibleTrades(state.account,now),old=state.strategyLab;
 const inputHash=hash({experiment:EXPERIMENT,trades,products:state.products.map(p=>[p,normalizeCandles(market.products[p]?.candles??[]).filter(b=>b.time+3600<=now)]),config:state.config,productConfigs:state.productConfigs,fees:state.feeProfile});
 if(old?.inputHash===inputHash)return old;
 const outcomes=summarize(state.account,0,now),models=old?.models?.status==='evaluated-shadow'?old.models:compareModels(trades);
 const products=Object.fromEntries(state.products.map(p=>[p,researchProduct(market.products[p]?.candles??[],{...DEFAULT_CONFIG,...state.config,...state.productConfigs?.[p],...state.feeProfile},old?.products?.[p],now)]));
 return {version:1,experiment:EXPERIMENT,inputHash,updatedAt:new Date(now*1000).toISOString(),mode:'shadow',outcomes,costDiagnosis:{netFees:outcomes.grossFees-outcomes.rebatesCredited,costFlippedLosses:trades.filter(t=>t.pnl<0&&t.pnl+(t.fees??0)-(t.rebateCredited??0)>0).length},models,products,limitations:['Hourly replay cannot reproduce missed five-minute checks, order-book liquidity or exact historical fills.','Fees use the saved tier, modeled rebates and adverse slippage; this is not a live tier verification.','One-market simulations do not prove portfolio-wide returns under shared capital.','No automatic adoption from this report. Frozen historical tests, new forward data and daily coverage/sample guards are required.','All wins is not a stopping rule. No-trade and the current strategy remain valid baselines.']};
}
export async function run(){
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)throw Error('Private research key required; nothing changed.');
 const market=JSON.parse(await readFile('data/market.json','utf8')),paper=JSON.parse(await readFile('data/paper.json','utf8'));let state;
 try{state=await decryptState(JSON.parse(await readFile('data/portfolio.enc.json','utf8')),key);}catch{throw Error('Private research unlock failed; nothing changed.');}
 const now=Date.now()/1000;paper.strategyLab=runLab(paper,market,now);state.strategyLab=runLab(state,market,now);
 const cipher=await encryptState(state,key),tmp='data/.strategy-lab.enc.tmp';
 try{await writeFile(tmp,JSON.stringify(cipher,null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}
 await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');console.log('Research completed; private results encrypted; execution and configuration unchanged.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
