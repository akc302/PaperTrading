/** Manager agent: scores the trading team against the paper goal and lists the jobs to re-run. No trades, no config changes. */
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {markToMarket} from '../engine.js';
import {decryptState,encryptState} from './private-state.mjs';
export const GOAL=85000;
const HOUR=3600;

/** Ledger arithmetic: cash must equal start + closed P&L - cost of open positions (fees net of rebates). */
export function integrity(a){
 const problems=[],num=v=>Number.isFinite(v);
 if(!num(a.cash)||a.cash<-0.01)problems.push('Cash is negative or not a number.');
 for(const p of a.positions??[])if(!(p.quantity>0)||!(p.entry>0)||!(p.stop<p.entry)||!(p.target>p.entry))problems.push(`${p.product} position has invalid quantity, entry, stop or target.`);
 for(const t of a.trades??[])if(![t.pnl,t.fees,t.entry,t.exit,t.quantity].every(num))problems.push(`${t.product} trade ${t.id} has a non-numeric value.`);
 const expected=a.initial+(a.trades??[]).reduce((s,t)=>s+t.pnl,0)-(a.positions??[]).reduce((s,p)=>s+p.entry*p.quantity+(p.entryFee??0)-(p.entryFeeDetail?.rebateCredited??0),0);
 const diff=a.cash-expected;if(!(Math.abs(diff)<=0.01))problems.push(`Cash reconciliation off by $${num(diff)?diff.toFixed(2):'NaN'}: P&L, fees or rebates are miscounted.`);
 return {ok:!problems.length,cashDifference:diff,problems:problems.slice(0,10)};
}
/** Evidence the owner asked for before even considering a real account. All must pass; any failure = not ready. */
export function readiness(state,now=Date.now()/1000){
 const a=state.account,window=28*86400,trades=(a.trades??[]).filter(t=>!String(t.reason).includes('rebalance')&&t.closedAt>=now-window);
 const net=trades.reduce((s,t)=>s+t.pnl,0),gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0),gl=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0);
 const weeks=[0,1,2,3].map(w=>trades.filter(t=>t.closedAt>=now-(w+1)*7*86400&&t.closedAt<now-w*7*86400).reduce((s,t)=>s+t.pnl,0));
 const first=Date.parse(state.strategyLabHistory?.at(-1)?.at??'')/1000,hours=(state.evidence?.hourly??[]).filter(h=>Date.parse(h.periodEnd)/1000>=now-7*86400);
 const coverage=hours.length?hours.filter(h=>h.evidenceComplete).length/168:0,decisions=Object.values(state.strategyLab?.products??{}).map(p=>p.decision);
 let peak=-Infinity,dd=0;for(const p of (a.equityHistory??[]).filter(p=>p.time>=now-window)){peak=Math.max(peak,p.equity);dd=Math.max(dd,(peak-p.equity)/peak);}
 const ledger=integrity(a),wins=trades.filter(t=>t.pnl>0).length,check=(id,label,pass,value)=>({id,label,pass:!!pass,value});
 const checks=[
  check('history','28+ days of forward paper trading with the research team',Number.isFinite(first)&&now-first>=window,Number.isFinite(first)?`${((now-first)/86400).toFixed(1)} days`:'0 days'),
  check('sample','150+ closed trades in the last 28 days',trades.length>=150,`${trades.length} trades`),
  check('winrate','Win rate 60%+ after fees',trades.length&&wins/trades.length>=.6,trades.length?`${(wins/trades.length*100).toFixed(1)}%`:'—'),
  check('profit','Net profit after fees and rebates, profit factor 1.3+',net>0&&gl>0&&gw/gl>=1.3,`$${net.toFixed(2)}, PF ${gl>0?(gw/gl).toFixed(2):'—'}`),
  check('weekly','Profitable in each of the last 4 weeks',weeks.every(v=>v>0),weeks.map(v=>'$'+v.toFixed(0)).join(' / ')),
  check('drawdown','Max drawdown 10% or less over 28 days',(a.equityHistory??[]).length&&dd<=.10,`${(dd*100).toFixed(1)}%`),
  check('validated','Research validated (profitable on unseen data) for most markets',decisions.filter(d=>d==='adopt-validated').length>decisions.length/2,`${decisions.filter(d=>d==='adopt-validated').length}/${decisions.length} markets`),
  check('uptime','Trader ran in 95%+ of hours over the last 7 days',coverage>=.95,`${(coverage*100).toFixed(0)}%`),
  check('integrity','No calculation errors in the ledger',ledger.ok,ledger.ok?'balanced':'errors'),
 ];
 const passed=checks.filter(c=>c.pass).length;
 return {ready:passed===checks.length,passed,total:checks.length,checks,message:passed===checks.length?'All evidence checks passed. Review the journal before deciding anything about a real account.':`Not ready: ${passed}/${checks.length} evidence checks passed. Keep paper trading.`};
}
export function teamReport(state,market,now=Date.now()/1000,{operations={}}={}){
 const a=state.account,prices=Object.fromEntries(Object.entries(market.products??{}).map(([p,v])=>[p,v.quote?.price??v.candles?.at(-1)?.close])),m=markToMarket(a,prices);
 const trades=(a.trades??[]).filter(t=>!String(t.reason).includes('rebalance')),day=trades.filter(t=>t.closedAt>=now-24*HOUR);
 let streak=0;for(const t of [...trades].reverse()){if(t.pnl>0)break;streak++;}
 const stat=list=>({closedTrades:list.length,wins:list.filter(t=>t.pnl>0).length,winRate:list.length?list.filter(t=>t.pnl>0).length/list.length:null,netPnl:list.reduce((s,t)=>s+t.pnl,0),grossFees:list.reduce((s,t)=>s+(t.fees??0),0),rebatesCredited:list.reduce((s,t)=>s+(t.rebateCredited??0),0)});
 const age=stamp=>{const t=Date.parse(stamp??'');return Number.isFinite(t)?now-t/1000:Infinity;};
 const trader=age(state.updatedAt),research=age(state.strategyLab?.updatedAt),lastEntry=Math.max(0,...(a.positions??[]).map(p=>p.openedAt),...trades.map(t=>t.openedAt));
 const issues=[],dispatch=[];
 if(trader>20*60){issues.push(`Trader (agent 1) last updated ${Math.round(trader/60)} min ago; expected every 5 min.`);dispatch.push('update.yml');}
 if(research>6*HOUR){issues.push(`Researcher (agent 2) last ran ${Number.isFinite(research)?Math.round(research/HOUR)+'h':'never'} ago; expected every 5h.`);dispatch.push('learning.yml:research');}
 if(state.autoTrade===false)issues.push('Automatic entries are switched off.');
 if((state.errors??[]).length)issues.push(`${state.errors.length} trader error(s): ${state.errors.map(e=>e.message).join(' ')}`);
 if(operations.scheduleEventCount===0)issues.push('GitHub has not delivered any scheduled trader runs; only manual runs are trading.');
 if(lastEntry&&now-lastEntry>24*HOUR)issues.push(`No new paper entry for ${Math.round((now-lastEntry)/HOUR)}h; current rules may be too strict for this market.`);
 const ledger=integrity(a);if(!ledger.ok)issues.push(...ledger.problems.map(p=>'Calculation error: '+p));
 if(streak>=10)issues.push(`${streak} losing trades in a row; researcher must replace the rules at its next run.`);
 const rules=Object.fromEntries((state.products??[]).map(p=>[p,{strategy:{...state.config,...state.productConfigs?.[p]}.strategy,approach:state.strategyLab?.products?.[p]?.selected??'current',decision:state.strategyLab?.products?.[p]?.decision??'none'}]));
 return {version:1,generatedAt:new Date(now*1000).toISOString(),goal:GOAL,equity:m.equity,startingEquity:a.initial,progressToGoal:(m.equity-a.initial)/(GOAL-a.initial),returnPct:(m.equity-a.initial)/a.initial,drawdown:m.drawdown,openPositions:(a.positions??[]).length,last24h:stat(day),allTime:stat(trades),losingStreak:streak,rulesInUse:rules,
  agents:{trader:{role:'5-minute paper trader',lastRunMinutesAgo:Math.round(trader/60),healthy:trader<=20*60},researcher:{role:'5-hour backtest and rule adoption',lastRunHoursAgo:Number.isFinite(research)?+(research/HOUR).toFixed(1):null,healthy:research<=6*HOUR},verifier:{role:'hourly health check and one retry',workflow:'health.yml'},manager:{role:'this hourly goal report',workflow:'learning.yml collect'},supervisor:{role:'Claude session every 3 hours: verifies, researches, repairs'}},
  integrity:ledger,readiness:readiness(state,now),
  verdict:issues.length?'needs-attention':'on-track',issues,dispatch:[...new Set(dispatch)]};
}

export async function run(){
 const read=async p=>JSON.parse(await readFile(p,'utf8')),now=Date.now()/1000,market=await read('data/market.json'),paper=await read('data/paper.json');
 let operations={};try{operations=await read('data/operations.json');}catch{}
 const report=teamReport(paper,market,now,{operations});await writeFile('data/team-report.json',JSON.stringify(report,null,2)+'\n');
 const key=process.env.PAPER_STATE_KEY?.trim();let privateDispatch=[];
 if(key){try{const state=await decryptState(await read('data/portfolio.enc.json'),key);state.teamReport=teamReport(state,market,now,{operations});privateDispatch=state.teamReport.dispatch;const tmp='data/.team.enc.tmp';try{await writeFile(tmp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}}catch{console.error('Private team report failed; ciphertext unchanged.');}}
 const all=[...new Set([...report.dispatch,...privateDispatch])];
 console.log(`Team verdict: ${report.verdict}. ${report.issues.join(' ')}`);
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`dispatch=${all.join(' ')}\n`,{flag:'a'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
