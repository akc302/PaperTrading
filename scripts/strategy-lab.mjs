/** Five-hour research: diagnose losing paper trades, walk-forward test strategies and ML filters, gate adoption. Never places real orders. */
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DEFAULT_CONFIG,normalizeCandles,backtest,featuresAt,mlProbability} from '../engine.js';
import {decryptState,encryptState} from './private-state.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),DATA=ROOT+'/data';
const read=async(name,fallback)=>{try{return JSON.parse(await readFile(DATA+'/'+name,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
const save=(name,value)=>writeFile(DATA+'/'+name,JSON.stringify(value,null,2)+'\n');
// Only entry/exit logic may change. Position sizing and loss limits stay as the owner set them.
export const TUNABLE=['strategy','rewardRisk','stopAtrMultiplier','maxHoldHours','proximity','lookback','trendLookback','mlWeights','mlThreshold'];
export const FROZEN=['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss','feeRate','slippage'];
export const GATE={minTrainTrades:20,minHoldoutTrades:15,minProfitFactor:1.1,maxHoldoutDrawdown:.15};

/** Explains where realized losses came from, using candles to measure what was reachable. */
export function diagnose(account,market){
 const trades=(account?.trades??[]).filter(t=>!String(t.reason).includes('rebalance'));
 if(!trades.length)return {closedTrades:0,findings:['No closed trades yet.']};
 const sum=f=>trades.reduce((s,t)=>s+f(t),0),wins=trades.filter(t=>t.pnl>0);
 const net=sum(t=>t.pnl),fees=sum(t=>t.fees-(t.rebateCredited??0)),gross=net+fees;
 const byReason={},byProduct={},bySource={};
 for(const t of trades)for(const [map,key] of [[byReason,t.reason],[byProduct,t.product],[bySource,t.source??'unknown']]){map[key]??={trades:0,wins:0,netPnl:0};map[key].trades++;map[key].netPnl+=t.pnl;if(t.pnl>0)map[key].wins++;}
 let reachable=0,measured=0,mfeSum=0;
 for(const t of trades){const bars=normalizeCandles(market.products?.[t.product]?.candles??[]).filter(b=>b.time+3600>t.openedAt&&b.time<t.closedAt);if(!bars.length)continue;measured++;const mfe=Math.max(...bars.map(b=>b.high))/t.entry-1;mfeSum+=mfe;if(Math.max(...bars.map(b=>b.high))>=t.target)reachable++;}
 const entryTimes=trades.map(t=>Math.floor(t.openedAt/300));const clustered=entryTimes.filter(v=>entryTimes.filter(w=>w===v).length>=3).length;
 const avg=f=>sum(f)/trades.length,breakeven=2*(trades[0].feeRate??.006)+2*(trades[0].slippage??.0005);
 const findings=[];
 if(fees>0&&net<0)findings.push(`Fees and slippage cost $${fees.toFixed(2)} (${(fees/Math.abs(net)*100).toFixed(0)}% of the net loss). A trade must gain ~${(breakeven*100).toFixed(2)}% just to break even.`);
 if(gross<0)findings.push(`Even before fees, price moved against entries by $${(-gross).toFixed(2)}: entry timing itself has no edge.`);
 const te=byReason['time-exit'];if(te&&te.trades/trades.length>.4)findings.push(`${te.trades}/${trades.length} trades hit the ${trades[0].maxHoldHours}h time exit before target or stop: holding period too short for the target distance.`);
 if(measured)findings.push(`Target was touched during the hold on ${reachable}/${measured} trades; average best move after entry was ${(mfeSum/measured*100).toFixed(2)}% vs average target distance ${(avg(t=>t.target/t.entry-1)*100).toFixed(2)}%.`);
 if(clustered/trades.length>.5)findings.push(`${clustered}/${trades.length} entries were opened together with 2+ other markets in the same 5-minute check: correlated crypto positions lose together.`);
 return {closedTrades:trades.length,wins:wins.length,losses:trades.filter(t=>t.pnl<0).length,winRate:wins.length/trades.length,netPnl:net,netCosts:fees,grossBeforeCosts:gross,avgHoldHours:avg(t=>(t.closedAt-t.openedAt)/3600),avgTargetPct:avg(t=>t.target/t.entry-1),avgStopPct:avg(t=>1-t.stop/t.entry),breakevenMovePct:breakeven,targetReachedDuringHold:measured?reachable/measured:null,byReason,byProduct,bySource,findings};
}

/** Pooled per-market replay; each market uses its own $10,000 virtual book so one config is judged across the universe. */
export function evaluate(datasets,config,startTime){
 let net=0,trades=0,wins=0,grossWin=0,grossLoss=0,fees=0,drawdown=0;const byProduct={};
 for(const {product,bars} of datasets){
  const r=backtest(bars,config,startTime!=null?{startTime}:{});const pnl=r.equity-r.account.initial;
  net+=pnl;trades+=r.closedTrades;fees+=r.totalFees;drawdown=Math.max(drawdown,r.drawdown);
  for(const t of r.account.trades){if(t.pnl>0){wins++;grossWin+=t.pnl}else grossLoss-=t.pnl;}
  byProduct[product]={netPnl:pnl,trades:r.closedTrades};
 }
 return {netPnl:net,trades,wins,winRate:trades?wins/trades:0,profitFactor:grossLoss>0?grossWin/grossLoss:grossWin>0?99:0,expectancy:trades?net/trades:0,fees,maxDrawdown:drawdown,byProduct};
}

export function candidateGrid(base){
 const grid=[];
 for(const strategy of ['ema-trend','donchian','rsi-reversion','aggressive'])for(const rewardRisk of [1.5,2.5])for(const stopAtrMultiplier of [1.5,2.5])for(const maxHoldHours of [6,24])grid.push({...base,strategy,rewardRisk,stopAtrMultiplier,maxHoldHours});
 for(const maxHoldHours of [24,48])grid.push({...base,strategy:'trendline',rewardRisk:2,maxHoldHours},{...base,strategy:'horizontal',rewardRisk:2,maxHoldHours});
 return grid;
}

/** Logistic regression trained only on bars before the split; threshold = 70th percentile of training scores. */
export function trainFilter(datasets,split,feeRate,horizon=4){
 const rows=[];
 for(const {bars} of datasets)for(let i=24;i+horizon<bars.length;i++){if(bars[i+horizon].time>=split)break;if(bars[i+horizon].time!==bars[i].time+horizon*3600)continue;rows.push({x:featuresAt(bars,i),y:bars[i+horizon].close/bars[i].close-1>2*feeRate+.001?1:0});}
 if(rows.length<200||new Set(rows.map(r=>r.y)).size<2)return null;
 const w=Array(7).fill(0);
 for(let epoch=0;epoch<200;epoch++){const g=Array(7).fill(0);for(const r of rows){const e=mlProbability(w,r.x)-r.y;for(let j=0;j<7;j++)g[j]+=e*r.x[j];}for(let j=0;j<7;j++)w[j]-=.1*(g[j]/rows.length+(j?.02*w[j]:0));}
 const scores=rows.map(r=>mlProbability(w,r.x)).sort((a,b)=>a-b);
 return {weights:w,threshold:scores[Math.floor(scores.length*.7)],samples:rows.length,positiveRate:rows.filter(r=>r.y).length/rows.length};
}

const passes=(train,hold)=>train.trades>=GATE.minTrainTrades&&train.profitFactor>=GATE.minProfitFactor&&train.netPnl>0&&hold.trades>=GATE.minHoldoutTrades&&hold.netPnl>0&&hold.profitFactor>=GATE.minProfitFactor&&hold.maxDrawdown<=GATE.maxHoldoutDrawdown;
const pick=c=>Object.fromEntries(TUNABLE.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
const label=c=>`${c.strategy} rr=${c.rewardRisk} stop=${c.stopAtrMultiplier}xATR hold=${c.maxHoldHours}h${c.mlWeights?' +ML':''}`;

/** Selection uses training data only; the later 30% holdout is looked at once per finalist. */
export function runLab(market,current,{now=Date.now()/1000,products}={}){
 const datasets=(products??Object.keys(market.products??{})).map(product=>({product,bars:normalizeCandles(market.products[product]?.candles??[]).filter(b=>b.time+3600<=now)})).filter(d=>d.bars.length>=480);
 if(datasets.length<3)return {status:'insufficient-data',reason:'Need at least 480 completed hourly candles for three markets.'};
 const times=datasets[0].bars.map(b=>b.time),split=times[Math.floor(times.length*.7)];
 const training=datasets.map(d=>({...d,bars:d.bars.filter(b=>b.time<split)}));
 const baseline={...DEFAULT_CONFIG,...current};
 const experiments=candidateGrid(baseline).map(config=>({config,train:evaluate(training,config)}));
 experiments.sort((a,b)=>b.train.netPnl-a.train.netPnl);
 const finalists=[];
 for(const strategy of new Set(experiments.map(e=>e.config.strategy)))finalists.push(experiments.find(e=>e.config.strategy===strategy));
 const filter=trainFilter(training,split,baseline.feeRate);
 if(filter){const best=finalists[0].config,ml={...best,mlWeights:filter.weights,mlThreshold:filter.threshold};finalists.push({config:ml,train:evaluate(training,ml)});}
 for(const f of finalists)f.holdout=evaluate(datasets,f.config,split);
 const currentResult={config:baseline,train:evaluate(training,baseline),holdout:evaluate(datasets,baseline,split)};
 // The winner is the best TRAINING performer that also clears every out-of-sample gate; holdout never ranks candidates.
 const ranked=[...finalists].sort((a,b)=>b.train.netPnl-a.train.netPnl);
 const winner=ranked.find(f=>passes(f.train,f.holdout)&&f.holdout.netPnl>currentResult.holdout.netPnl);
 const summary=f=>({label:label(f.config),config:pick(f.config),train:f.train,holdout:f.holdout,passedGate:passes(f.train,f.holdout)});
 return {status:winner?'adopt':'retain',version:1,ranAt:new Date(now*1000).toISOString(),splitTime:split,markets:datasets.map(d=>d.product),candles:times.length,gate:GATE,
  current:summary(currentResult),finalists:finalists.map(summary),winner:winner?summary(winner):null,
  mlFilter:filter?{samples:filter.samples,positiveRate:filter.positiveRate,threshold:filter.threshold}:{status:'insufficient-data'},
  failedExperiments:experiments.filter(e=>e.train.netPnl<=0).length,totalExperiments:experiments.length+(filter?1:0),
  topTraining:experiments.slice(0,8).map(e=>({label:label(e.config),train:e.train})),
  reason:winner?`Adopting ${label(winner.config)}: profitable after costs on training and on the unseen later holdout, profit factor ≥ ${GATE.minProfitFactor}, beats the current config.`:'No candidate was profitable after costs on both training and the unseen holdout while beating the current config. Current entry rules kept; the losing experiments are recorded.'};
}

/** Applies only tunable entry/exit keys. Refuses to touch sizing or loss limits. */
export function adopt(state,report){
 if(report.status!=='adopt')return false;
 const before=JSON.stringify(FROZEN.map(k=>state.config[k]));
 for(const k of ['mlWeights','mlThreshold'])delete state.config[k];
 Object.assign(state.config,report.winner.config);
 for(const pc of Object.values(state.productConfigs??{}))for(const k of TUNABLE)delete pc[k];
 if(JSON.stringify(FROZEN.map(k=>state.config[k]))!==before)throw new Error('Risk cap mutation refused');
 return true;
}

function record(state,report,diagnosis){
 const entry={...report,diagnosis,adopted:adopt(state,report)};
 state.strategyLab=entry;
 state.strategyLabHistory=[{ranAt:entry.ranAt,status:entry.status,adopted:entry.adopted,current:entry.current.label,winner:entry.winner?.label??null,currentHoldoutNet:entry.current.holdout.netPnl,winnerHoldoutNet:entry.winner?.holdout.netPnl??null,closedTrades:diagnosis.closedTrades,netPnl:diagnosis.netPnl??0},...(state.strategyLabHistory??[])].slice(0,300);
 return entry;
}

async function run(){
 const now=Date.now()/1000,market=await read('market.json',{products:{}}),paper=await read('paper.json',null);
 if(!paper?.account)throw new Error('Public ledger missing');
 const report=runLab(market,paper.config,{now,products:paper.products});
 if(report.status==='insufficient-data'){console.log(report.reason);return;}
 const entry=record(paper,report,diagnose(paper.account,market));
 await save('paper.json',paper);
 await save('strategy-lab.json',{...entry,history:paper.strategyLabHistory});
 console.log(`Public lab: ${entry.status}${entry.adopted?' (adopted '+entry.winner.label+')':''}. ${entry.diagnosis.findings.join(' ')}`);
 const envelope=await read('portfolio.enc.json',null),key=process.env.PAPER_STATE_KEY?.trim();
 if(!envelope)return;
 if(!key){console.error('Private lab skipped: encryption key missing. Ciphertext unchanged.');return;}
 try{
  const state=await decryptState(envelope,key),cfg={...state.config,...(state.feeProfile??{})};
  // Re-run with the private account's own fee profile so its costs are judged honestly.
  const own=runLab(market,cfg,{now,products:state.products});
  if(own.status!=="insufficient-data")record(state,own,diagnose(state.account,market));
  const temp=DATA+'/.lab.enc.tmp';try{await writeFile(temp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(temp,DATA+'/portfolio.enc.json');}finally{await rm(temp,{force:true})}
  console.log('Private lab completed inside the encrypted envelope.');
 }catch{console.error('Private lab failed; previous encrypted state retained.');process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
