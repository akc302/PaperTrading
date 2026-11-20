/** Pure market analysis plus a virtual, long-only ledger. No account or order APIs. */
export const DEFAULT_CONFIG = Object.freeze({strategy:'horizontal',lookback:48,pivotWindow:3,proximity:0.006,stopBuffer:0.004,rewardRisk:2,riskPct:0.01,feeRate:0.006,slippage:0.0005,maxAllocation:0.25,trendLookback:180,maxHoldHours:48,maxDailyLoss:0.04,maxOpenPositions:4,maxTotalRisk:0.03,stopAtrMultiplier:1.25});

const finite = (n) => Number.isFinite(Number(n));
const positive = (n) => finite(n) && Number(n)>0;
const cfg = (c={}) => {
  const x={...DEFAULT_CONFIG,...c};
  if(!Number.isInteger(x.lookback)||x.lookback<12||x.lookback>300||!Number.isInteger(x.pivotWindow)||x.pivotWindow<1||x.pivotWindow>10) throw new Error('Invalid level window.');
  if(!positive(x.proximity)||x.proximity>0.1||!positive(x.stopBuffer)||x.stopBuffer>0.1||!positive(x.rewardRisk)||x.rewardRisk>10) throw new Error('Invalid strategy parameters.');
  if(!positive(x.riskPct)||x.riskPct>0.05||!positive(x.maxAllocation)||x.maxAllocation>1||!finite(x.feeRate)||x.feeRate<0||x.feeRate>0.05||!finite(x.slippage)||x.slippage<0||x.slippage>0.05) throw new Error('Invalid paper risk or execution settings.');
  if(!['horizontal','trendline','aggressive'].includes(x.strategy)||!Number.isInteger(x.trendLookback)||x.trendLookback<60||x.trendLookback>720)throw new Error('Invalid strategy or trendline window.');
  if(!finite(x.maxHoldHours)||x.maxHoldHours<0||x.maxHoldHours>720||!finite(x.maxDailyLoss)||x.maxDailyLoss<0||x.maxDailyLoss>0.5||!Number.isInteger(x.maxOpenPositions)||x.maxOpenPositions<1||x.maxOpenPositions>20||!positive(x.maxTotalRisk)||x.maxTotalRisk>0.2)throw new Error('Invalid portfolio risk limits.');
  if(!positive(x.stopAtrMultiplier)||x.stopAtrMultiplier<.5||x.stopAtrMultiplier>4)throw new Error('Invalid stop ATR multiplier.');
  return x;
};
/** Per-fill costs use a saved fee observation; this never claims an authenticated live check. */
export function feeForFill(notional,liquidity,config={},time=Date.now()/1000){
 const rate=liquidity==='maker'?(config.makerFeeRate??config.feeRate??DEFAULT_CONFIG.feeRate):(config.takerFeeRate??config.feeRate??DEFAULT_CONFIG.feeRate);
 if(!Number.isFinite(rate)||rate<0||rate>.05||!Number.isFinite(notional)||notional<0)throw new Error('Invalid modeled fill fee.');
 const gross=notional*rate,credit=config.rebateVerified===true&&gross*(config.rebateRate??0)>=.000001?gross*config.rebateRate:0,observedAt=config.feeObservedAt??null;
 const age=observedAt?Math.max(0,time-Date.parse(observedAt)/1000):null;
 return {liquidity,rate,gross,tier:config.feeTier??'Unverified estimate',observedAt,checkedAt:time,source:observedAt?'Coinbase MCP saved snapshot':'Configured estimate',liveTierChecked:false,snapshotAgeSeconds:age,stale:age==null||age>86400,rebatePending:config.rebateVerified?0:gross*(config.rebateRate??0),rebateCredited:credit,rebateStatus:config.rebateVerified?'Simulated USDC credit; Premium eligibility user-confirmed':config.rebateRate?'Pending eligibility/cap verification; excluded from cash and P&L':'Not modeled'};
}
function seconds(t){const n=Number(t);return Number.isFinite(n)?(n>1e12?n/1000:n):Date.parse(t)/1000;}
function executionAt(price,stop,target,c){
  const entry=price*(1+c.slippage),cost=entry*(1+c.feeRate);
  const risk=cost-stop*(1-c.slippage)*(1-c.feeRate);
  const reward=target*(1-c.slippage)*(1-c.feeRate)-cost;
  return {entry,risk,reward};
}
export function normalizeCandles(input){
  const rows=Array.isArray(input)?input:input?.candles;
  if(!Array.isArray(rows))return [];
  const map=new Map();
  for(const r of rows){
    if(!r||typeof r!=='object')continue;
    const c=Array.isArray(r)?{time:seconds(r[0]),low:+r[1],high:+r[2],open:+r[3],close:+r[4],volume:+r[5]}:{time:seconds(r.time??r.start),open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:+(r.volume??0)};
    if(!Number.isFinite(c.time)||c.time<0||![c.open,c.high,c.low,c.close].every(positive)||!Number.isFinite(c.volume)||c.volume<0||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close,c.high))continue;
    map.set(c.time,c);
  }
  return [...map.values()].sort((a,b)=>a.time-b.time);
}

export function analyze(input,config={}){
  const c=cfg(config);
  const result=c.strategy==='aggressive'?analyzeAggressive(input,c):c.strategy==='trendline'?analyzeTrendline(input,c):{...analyzeHorizontal(input,c),strategy:'horizontal',setup:'support-bounce',trend:'unconfirmed',trendlines:[]};
  const completed=normalizeCandles(input);result.pattern=patternConfirmation(completed,{asOf:(completed.at(-1)?.time??0)+3600});
  if(c.patternRequired===true&&result.signal==='BUY'&&!result.pattern.confirmed){result.signal='WAIT';result.reason='Research pattern filter: no completed-candle confirmation.';}
  return result;
}

/** Aggregate already-completed, hourly bars. Incomplete or noncontiguous UTC groups are omitted. */
export function aggregateCandles(input,hours=4){
  if(!Number.isInteger(hours)||hours<1||hours>24)throw new Error('Aggregation hours must be an integer from 1 to 24.');
  const interval=hours*3600,groups=new Map();
  for(const b of normalizeCandles(input)){const start=Math.floor(b.time/interval)*interval;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(b);}
  const result=[];
  for(const [time,bars] of groups){
    if(bars.length!==hours||!bars.every((b,i)=>b.time===time+i*3600))continue;
    result.push({time,open:bars[0].open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1).close,volume:bars.reduce((sum,b)=>sum+b.volume,0)});
  }
  return result;
}

function pivots(bars,window){
  const lows=[],highs=[];
  for(let i=window;i<bars.length-window;i++){
    const around=bars.slice(i-window,i+window+1);
    if(around.every(b=>b.low>=bars[i].low)&&around.some(b=>b.low>bars[i].low))lows.push({index:i,time:bars[i].time,price:bars[i].low});
    if(around.every(b=>b.high<=bars[i].high)&&around.some(b=>b.high<bars[i].high))highs.push({index:i,time:bars[i].time,price:bars[i].high});
  }
  return {lows,highs};
}

function findTrendline(points,bars,type,c,atr){
  const recent=points.slice(-30),lastIndex=bars.length-1,tolerance=Math.max(bars.at(-1).close*c.proximity,atr*0.2);
  let best=null;
  for(let a=0;a<recent.length-1;a++)for(let z=a+1;z<recent.length;z++){
    const first=recent[a],end=recent[z];if(end.index-first.index<42)continue;
    const slope=(end.price-first.price)/(end.index-first.index);
    if(type==='support'?slope<=0:slope>=0)continue;
    const at=i=>first.price+slope*(i-first.index),touches=[];
    for(const p of recent){if(p.index<first.index||Math.abs(p.price-at(p.index))>tolerance)continue;if(!touches.length||p.index-touches.at(-1).index>=3)touches.push(p);}
    if(touches.length<3||touches.at(-1).index-touches[0].index<42)continue;
    // The latest closed 4h candle may break a resistance line. Older closes may not.
    const violated=bars.slice(first.index,-1).some((b,offset)=>type==='support'?b.close<at(first.index+offset)-2*tolerance:b.close>at(first.index+offset)+2*tolerance);
    if(violated)continue;
    const score=touches.length*100+(touches.at(-1).index-touches[0].index)+touches.at(-1).index/100;
    if(!best||score>best.score)best={type,direction:type==='support'?'rising':'descending',slope,originTime:first.time,originPrice:first.price,startTime:touches[0].time,endTime:bars.at(-1).time,startPrice:at(touches[0].index),endPrice:at(lastIndex),price:at(lastIndex),previousPrice:at(lastIndex-1),touches:touches.map(({time,price})=>({time,price})),spanBars:touches.at(-1).index-touches[0].index,score};
  }
  if(best)delete best.score;
  return best;
}

function analyzeTrendline(input,c){
  const hourly=normalizeCandles(input),last=hourly.at(-1);
  let four=aggregateCandles(hourly,4).slice(-c.trendLookback);
  for(let i=four.length-1;i>0;i--)if(four[i].time!==four[i-1].time+14400){four=four.slice(i);break;}
  const base={strategy:'trendline',setup:'none',trend:'unconfirmed',price:last?.close??null,support:null,resistance:null,atr:0,signal:'WAIT',reason:'Need confirmed 4h trendline touches spanning at least one week.',levels:[],trendlines:[],stop:null,target:null,confirmation:false,structure:false,estimatedRewardRisk:null};
  if(four.length<43+2*c.pivotWindow)return base;
  const latest=four.at(-1),previous=four.at(-2);
  if(last.time+3600-latest.time-14400>3*3600){base.reason='Waiting for a contiguous, completed 4h candle.';return base;}
  const ranges=four.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-four[i].close),Math.abs(b.low-four[i].close)));
  base.atr=ranges.slice(-14).reduce((s,v)=>s+v,0)/Math.min(14,ranges.length);
  const {lows,highs}=pivots(four,c.pivotWindow);
  const higherLows=lows.length>=2&&lows.at(-1).price>lows.at(-2).price;
  const higherHighs=highs.length>=2&&highs.at(-1).price>highs.at(-2).price;
  const lowerLows=lows.length>=2&&lows.at(-1).price<lows.at(-2).price;
  const lowerHighs=highs.length>=2&&highs.at(-1).price<highs.at(-2).price;
  base.trend=higherLows&&higherHighs?'bullish':lowerLows&&lowerHighs?'bearish':'mixed';
  base.levels=highs.map(p=>({price:p.price,type:'resistance',touches:1})).concat(lows.map(p=>({price:p.price,type:'support',touches:1}))).sort((a,b)=>a.price-b.price);
  base.resistance=base.levels.find(l=>l.type==='resistance'&&l.price>base.price)?.price??null;
  base.support=base.levels.filter(l=>l.type==='support'&&l.price<base.price).at(-1)?.price??null;
  const rising=findTrendline(lows,four,'support',c,base.atr),descending=findTrendline(highs,four,'resistance',c,base.atr);
  base.trendlines=[rising,descending].filter(Boolean);
  const bounce=rising&&latest.low<=rising.price*(1+c.proximity)&&latest.close>rising.price&&latest.close<=rising.price*(1+2*c.proximity)&&latest.close>latest.open&&latest.close>previous.close;
  const breakout=descending&&previous.close<=descending.previousPrice&&latest.close>descending.price*(1+c.proximity*0.25)&&latest.close>latest.open;
  const breakStructure=breakout&&higherLows&&highs.length&&latest.close>highs.at(-1).price;
  if(bounce){base.setup='rising-support-bounce';base.structure=higherLows&&higherHighs;base.support=rising.price;}
  else if(breakout){base.setup='descending-resistance-break';base.structure=Boolean(breakStructure);if(base.structure)base.trend='bullish';base.support=descending.price;}
  else {base.reason=base.trendlines.length?'Waiting for a closed 4h support bounce or descending resistance break.':'No valid trendline with three spaced touches over at least one week.';return base;}
  if(!base.structure){base.reason='The 4h setup lacks bullish price structure (higher lows and higher highs or a confirmed structure break).';return base;}
  base.confirmation=hourly.length>1&&last.close>last.open&&last.close>hourly.at(-2).close&&last.close>=latest.close*(1-c.proximity);
  if(!base.confirmation){base.reason='4h setup confirmed; waiting for a bullish closed 1h entry candle.';return base;}
  base.stop=Math.min(latest.low,base.support)*(1-c.stopBuffer);
  base.target=base.resistance;
  if(!base.target){base.reason='No confirmed horizontal resistance above price to define a conservative target.';return base;}
  const fill=executionAt(base.price,base.stop,base.target,c);base.estimatedRewardRisk=fill.reward/fill.risk;
  if(fill.risk<=0||base.estimatedRewardRisk<Math.max(2,c.rewardRisk)){base.reason='Nearest horizontal resistance offers less than 2:1 net reward/risk after fees and slippage.';return base;}
  base.signal='BUY';base.reason=`Algorithmic ${base.setup.replaceAll('-',' ')}: weekly 4h trendline, bullish structure, closed 1h confirmation and at least 2:1 net reward/risk.`;
  return base;
}

function analyzeHorizontal(input,config={}){
  const c=cfg(config),bars=normalizeCandles(input).slice(-c.lookback),last=bars.at(-1),price=last?.close??null;
  const base={price,support:null,resistance:null,atr:0,signal:'WAIT',reason:'Collecting completed candles to confirm levels.',levels:[],stop:null,target:null};
  if(bars.length<Math.max(12,c.pivotWindow*2+3))return base;
  const ranges=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close)));
  base.atr=ranges.slice(-14).reduce((a,b)=>a+b,0)/Math.min(14,ranges.length);
  const raw=[];
  for(let i=c.pivotWindow;i<bars.length-c.pivotWindow;i++){
    const around=bars.slice(i-c.pivotWindow,i+c.pivotWindow+1);
    if(around.every((b)=>b.low>=bars[i].low)&&around.some(b=>b.low>bars[i].low))raw.push({price:bars[i].low,type:'support'});
    if(around.every((b)=>b.high<=bars[i].high)&&around.some(b=>b.high<bars[i].high))raw.push({price:bars[i].high,type:'resistance'});
  }
  const clusters=[];
  for(const p of raw){const existing=clusters.find(l=>l.type===p.type&&Math.abs(l.price-p.price)<=Math.max(price*c.proximity*0.5,base.atr*0.25));if(existing){existing.price=(existing.price*existing.touches+p.price)/(existing.touches+1);existing.touches++;}else clusters.push({...p,touches:1});}
  base.levels=clusters.sort((a,b)=>a.price-b.price);
  base.support=base.levels.filter(l=>l.price<price).at(-1)?.price??null;
  base.resistance=base.levels.find(l=>l.price>price)?.price??null;
  if(!base.support||!base.resistance){base.reason='Waiting for confirmed support below price and resistance above it.';return base;}
  base.stop=base.support*(1-c.stopBuffer);
  const {entry,risk}=executionAt(price,base.stop,price,c);
  // Target compensates for estimated round-trip costs before the requested reward/risk.
  base.target=(entry*(1+c.feeRate)+risk*c.rewardRisk)/((1-c.slippage)*(1-c.feeRate));
  if(last.low>base.support*(1+c.proximity)||price>base.support*(1+2*c.proximity)){base.reason='Price is away from the support entry zone.';return base;}
  if(last.close<=last.open||last.close<=bars.at(-2).close){base.reason='Support is nearby; waiting for a bullish candle confirmation.';return base;}
  if(base.target>base.resistance){base.reason='Resistance leaves too little reward after estimated fees and slippage.';return base;}
  base.signal='BUY';base.reason='Confirmed support bounce with room to resistance after estimated trading costs.';return base;
}

export function createAccount(initial=10000){
  if(!positive(initial))throw new Error('Starting paper cash must be positive.');
  return {initial:+initial,cash:+initial,positions:[],trades:[],equityHistory:[],lastProcessed:{},marks:{},nextId:1,decisions:[],dailyRisk:{}};
}

function dayRisk(account,time,c){
  account.dailyRisk??={};
  const day=new Date(time*1000).toISOString().slice(0,10),equity=markToMarket(account).equity;
  const state=account.dailyRisk[day]??={openingEquity:equity,blocked:false};
  if(c.maxDailyLoss>0&&equity<=state.openingEquity*(1-c.maxDailyLoss))state.blocked=true;
  const days=Object.keys(account.dailyRisk).sort();for(const old of days.slice(0,-90))delete account.dailyRisk[old];
  return state;
}

function reservedRisk(account){
  return account.positions.reduce((sum,p)=>sum+Math.max(0,p.entry*p.quantity+p.entryFee-p.stop*(1-p.slippage)*(1-p.feeRate)*p.quantity),0);
}

function journal(account,product,time,signal,config,reason,action='WAIT'){
  account.decisions??=[];
  account.decisions.push({time,product,signal:action.startsWith('BUY')?'BUY':'WAIT',observedSignal:signal.signal??'WAIT',action,reason:reason??signal.reason,setup:signal.setup??'support-bounce',strategy:config.strategy,pattern:signal.pattern??null,support:signal.support??null,resistance:signal.resistance??null,stop:signal.stop??null,target:signal.target??null,price:signal.price??null,trend:signal.trend??'unconfirmed',config:{...config}});
  if(account.decisions.length>5000)account.decisions.splice(0,account.decisions.length-5000);
}

export function markToMarket(account,prices={}){
  const marks={...account.marks,...prices};
  const equity=account.cash+account.positions.reduce((s,p)=>s+p.quantity*(positive(marks[p.product])?+marks[p.product]:p.entry),0);
  const unrealized=account.positions.reduce((s,p)=>s+p.quantity*((positive(marks[p.product])?+marks[p.product]:p.entry)-p.entry)-p.entryFee+(p.entryFeeDetail?.rebateCredited??0),0);
  const realized=account.trades.reduce((s,t)=>s+t.pnl,0);
  let peak=account.initial,drawdown=0;
  for(const point of [...account.equityHistory,{equity}]){peak=Math.max(peak,point.equity);drawdown=Math.max(drawdown,(peak-point.equity)/peak);}
  return {equity,unrealized,realized,winRate:account.trades.length?account.trades.filter(t=>t.pnl>0).length/account.trades.length:0,closedTrades:account.trades.length,totalFees:account.trades.reduce((s,t)=>s+t.fees,0)+account.positions.reduce((s,p)=>s+p.entryFee,0),drawdown};
}

/** Mutates account, returns it. Fills are modeled with adverse slippage and fees. */
export function openPaperTrade(account,{product,price,stop,target,time=Date.now()/1000,source='manual',pattern=null},config={}){
  const c=cfg(config);
  if(typeof product!=='string'||!product||![price,stop,target].every(positive)||!finite(time))throw new Error('Invalid paper trade.');
  if(account.positions.some(p=>p.product===product))throw new Error('A paper position is already open for this market.');
  if(account.positions.length>=c.maxOpenPositions)throw new Error('Maximum shared paper positions reached.');
  if(dayRisk(account,+time,c).blocked)throw new Error('UTC daily loss circuit is active; new paper entries are paused for this day.');
  const {entry,risk:lossPerUnit,reward}=executionAt(+price,+stop,+target,c);
  if(+stop>=entry||+target<=entry)throw new Error('Stop must be below entry; target must be above entry.');
  const equity=markToMarket(account).equity;
  const remainingRisk=Math.max(0,equity*c.maxTotalRisk-reservedRisk(account));
  if(remainingRisk<=1e-8)throw new Error('Maximum shared paper stop risk reached.');
  const quantity=Math.min(equity*c.riskPct/lossPerUnit,remainingRisk/lossPerUnit,equity*c.maxAllocation/(entry*(1+c.feeRate)),account.cash/(entry*(1+c.feeRate)));
  if(!positive(quantity)||quantity*entry<0.01)throw new Error('Insufficient virtual cash.');
  const entryFeeDetail=feeForFill(entry*quantity,'taker',c,+time),entryFee=entryFeeDetail.gross;
  account.cash-=entry*quantity+entryFee-entryFeeDetail.rebateCredited;
  account.rebatesUSDC=(account.rebatesUSDC??0)+entryFeeDetail.rebateCredited;
  account.positions.push({id:`paper-${account.nextId++}`,product,entry,quantity,stop:+stop,target:+target,openedAt:+time,entryFee,entryFeeDetail,entryOrderType:'market',feeProfile:{makerFeeRate:c.makerFeeRate,takerFeeRate:c.takerFeeRate,feeTier:c.feeTier,feeObservedAt:c.feeObservedAt,rebateRate:c.rebateRate,rebateVerified:c.rebateVerified},source,pattern,riskBudget:Math.min(equity*c.riskPct,remainingRisk),estimatedRewardRisk:reward/lossPerUnit,feeRate:c.feeRate,slippage:c.slippage,maxHoldHours:c.maxHoldHours});
  account.marks[product]=+price;
  return account;
}

export function closePaperTrade(account,id,price,time=Date.now()/1000,reason='manual',config={}){
  cfg(config);
  if(!positive(price)||!finite(time))throw new Error('Invalid closing price or time.');
  const index=account.positions.findIndex(p=>p.id===id);
  if(index<0)throw new Error('Paper position not found.');
  const p=account.positions[index],restingTarget=reason==='target'&&p.feeProfile?.makerFeeRate!=null;
  const exit=restingTarget?+price:+price*(1-p.slippage);
  const exitFeeDetail=feeForFill(exit*p.quantity,restingTarget?'maker':'taker',{feeRate:p.feeRate,...p.feeProfile,...config},+time),exitFee=exitFeeDetail.gross;
  account.cash+=exit*p.quantity-exitFee+exitFeeDetail.rebateCredited;
  account.rebatesUSDC=(account.rebatesUSDC??0)+exitFeeDetail.rebateCredited;
  account.trades.push({...p,exit,closedAt:+time,exitFee,exitFeeDetail,exitOrderType:restingTarget?'resting-limit (simulated)':'market (simulated)',rebatePending:(p.entryFeeDetail?.rebatePending??0)+exitFeeDetail.rebatePending,rebateCredited:(p.entryFeeDetail?.rebateCredited??0)+exitFeeDetail.rebateCredited,fees:p.entryFee+exitFee,pnl:(exit-p.entry)*p.quantity-p.entryFee-exitFee+(p.entryFeeDetail?.rebateCredited??0)+exitFeeDetail.rebateCredited,reason});
  account.positions.splice(index,1);account.marks[p.product]=+price;
  return account;
}

/** Pass completed candles only. Initial sync starts now; replay=true is for backtests. */
export function processCandles(account,product,input,config={},options={}){
  const c=cfg(config),bars=normalizeCandles(input),{autoTrade=true,replay=false}=options;
  if(!bars.length)return account;
  account.lastProcessed??={};account.marks??={};account.decisions??=[];account.dailyRisk??={};
  if(account.lastProcessed[product]==null&&!replay){
    account.lastProcessed[product]=bars.at(-1).time;account.marks[product]=bars.at(-1).close;
    journal(account,product,bars.at(-1).time,analyze(bars,c),c,'Initial synchronization: monitoring starts here; historical signals were not traded.','SYNC');
    return account;
  }
  for(let i=0;i<bars.length;i++){
    const bar=bars[i];if(bar.time<=(account.lastProcessed[product]??-1))continue;
    dayRisk(account,bar.time,c);account.marks[product]=bar.open;
    let reason,action='WAIT';
    const existing=account.positions.find(p=>p.product===product);
    if(existing&&bar.time>=existing.openedAt){
      if(bar.open<=existing.stop){closePaperTrade(account,existing.id,bar.open,bar.time,'stop',c);reason='Existing paper position closed at a stop gap.';action='EXIT';}
      else if(bar.open>=existing.target){closePaperTrade(account,existing.id,existing.target,bar.time,'target',c);reason='Existing paper position reached its target at the open.';action='EXIT';}
      else if((existing.maxHoldHours??c.maxHoldHours)>0&&bar.time>=existing.openedAt+(existing.maxHoldHours??c.maxHoldHours)*3600){closePaperTrade(account,existing.id,bar.open,bar.time,'time-exit',c);reason='Maximum paper holding period reached; exited at the next eligible open.';action='EXIT';}
    }
    // A signal can use only bars that ended before this bar began. Never its future high/low.
    const signal=analyze(bars.slice(0,i),c),daily=dayRisk(account,bar.time,c);
    if(!existing&&autoTrade&&!daily.blocked){
      const fill=executionAt(bar.open,signal.stop,signal.target,c);
      // Recheck at the executable next open: an upward gap can erase the signal's
      // advertised reward/risk even when the original stop and target bracket it.
      const requiredReward=fill.risk*(c.strategy==='trendline'?Math.max(2,c.rewardRisk):c.rewardRisk);
      const meetsRewardRisk=fill.risk>0&&fill.reward+Math.max(1,Math.abs(requiredReward))*1e-10>=requiredReward;
      if(signal.signal==='BUY'&&signal.stop<bar.open&&signal.target>fill.entry&&meetsRewardRisk){
        try{openPaperTrade(account,{product,price:bar.open,stop:signal.stop,target:signal.target,time:bar.time,source:signal.setup??'support-bounce',pattern:signal.pattern},c);action='BUY';reason=signal.reason;}
        catch(error){reason=error.message;}
      }else if(signal.signal==='BUY')reason='Next-open gap fails the stop/target bracket or minimum net reward/risk; entry skipped.';
    }else if(!existing){reason=daily.blocked?'UTC daily loss circuit is active; new entries paused while exits remain active.':'Automatic paper entries are paused.';}
    else if(action!=='EXIT'){reason='Existing paper position is being monitored; no additional position opened.';action='HOLD';}
    const p=account.positions.find(p=>p.product===product);
    if(p&&bar.time>=p.openedAt){
      // If both exits were touched, choose stop first. Stop gaps fill at the worse open.
      if(bar.low<=p.stop){closePaperTrade(account,p.id,Math.min(bar.open,p.stop),bar.time,'stop',c);reason='Paper stop triggered; stop takes priority when both exits are touched.';action=action==='BUY'?'BUY_EXIT':'EXIT';}
      else if(bar.high>=p.target){closePaperTrade(account,p.id,p.target,bar.time,'target',c);reason='Paper take-profit target reached.';action=action==='BUY'?'BUY_EXIT':'EXIT';}
    }
    account.marks[product]=bar.close;account.lastProcessed[product]=bar.time;
    dayRisk(account,bar.time,c);journal(account,product,bar.time,signal,c,reason,action);
    const point={time:bar.time,equity:markToMarket(account).equity};
    account.equityHistory.push(point);
    if(account.equityHistory.length>5000)account.equityHistory.splice(0,account.equityHistory.length-5000);
  }
  return account;
}

/**
 * Advance a shared account by one completed hour across multiple markets.
 * Every event's bars must end at the same timestamp. Earlier bars are context.
 * Entry priority is alphabetical product ID, independent of input order. All
 * entries use simultaneous opening marks and cash; intrabar profits are applied
 * only after every entry decision. Callers preflight missing history first.
 */
export function processBarBatch(account,events,options={}){
  if(!Array.isArray(events))throw new Error('Paper bar batch must be an array.');
  const prepared=events.map(event=>({product:event.product,bars:normalizeCandles(event.bars),config:cfg(event.config),autoTrade:event.autoTrade??options.autoTrade??true})).filter(event=>event.bars.length);
  if(!prepared.length)return account;
  const time=prepared[0].bars.at(-1).time;
  if(new Set(prepared.map(event=>event.product)).size!==prepared.length)throw new Error('Paper bar batch has duplicate products.');
  if(prepared.some(event=>typeof event.product!=='string'||!event.product||event.bars.at(-1).time!==time))throw new Error('Paper bar batch must contain distinct products ending at the same candle time.');
  account.lastProcessed??={};account.marks??={};account.decisions??=[];account.dailyRisk??={};
  const active=prepared.filter(event=>time>(account.lastProcessed[event.product]??-1)).sort((a,b)=>a.product.localeCompare(b.product));
  if(!active.length)return account;
  // Register the day's baseline before replacing the previous closing marks.
  for(const event of active)dayRisk(account,time,event.config);
  for(const event of active){
    event.bar=event.bars.at(-1);event.sync=account.lastProcessed[event.product]==null&&!options.replay;
    event.existing=account.positions.find(position=>position.product===event.product);
    event.action='WAIT';event.reason=undefined;
    account.marks[event.product]=event.bar.open;
  }
  // These exits are already determined at the open. Their proceeds may fund an
  // opening entry. The later high/low and close are never read in this phase.
  for(const event of active){
    const p=event.existing,{bar,config:c}=event;
    if(event.sync||!p||time<p.openedAt)continue;
    if(bar.open<=p.stop){closePaperTrade(account,p.id,bar.open,time,'stop',c);event.reason='Existing paper position closed at a stop gap.';event.action='EXIT';}
    else if(bar.open>=p.target){closePaperTrade(account,p.id,p.target,time,'target',c);event.reason='Existing paper position reached its target at the open.';event.action='EXIT';}
    else if((p.maxHoldHours??c.maxHoldHours)>0&&time>=p.openedAt+(p.maxHoldHours??c.maxHoldHours)*3600){closePaperTrade(account,p.id,bar.open,time,'time-exit',c);event.reason='Maximum paper holding period reached; exited at the next eligible open.';event.action='EXIT';}
  }
  // Every analytic signal uses only history strictly before this hour's open.
  for(const event of active)event.analysis=analyze(event.sync?event.bars:event.bars.slice(0,-1),event.config);
  // Opening cash and simultaneous opening valuations are the only funding and
  // sizing inputs. No event has realized an intrabar exit or marked its close.
  for(const event of active){
    const {bar,config:c,analysis:signal}=event;
    if(event.sync){event.action='SYNC';event.reason='Initial synchronization: monitoring starts here; historical signals were not traded.';continue;}
    const daily=dayRisk(account,time,c);
    if(event.existing){if(event.action!=='EXIT'){event.action='HOLD';event.reason='Existing paper position is being monitored; no additional position opened.';}continue;}
    if(!event.autoTrade||daily.blocked){event.reason=daily.blocked?'UTC daily loss circuit is active; new entries paused while exits remain active.':'Automatic paper entries are paused.';continue;}
    if(signal.signal!=='BUY')continue;
    const fill=executionAt(bar.open,signal.stop,signal.target,c),requiredReward=fill.risk*(c.strategy==='trendline'?Math.max(2,c.rewardRisk):c.rewardRisk);
    const eligible=signal.stop<bar.open&&signal.target>fill.entry&&fill.risk>0&&fill.reward+Math.max(1,Math.abs(requiredReward))*1e-10>=requiredReward;
    if(!eligible){event.reason='Next-open gap fails the stop/target bracket or minimum net reward/risk; entry skipped.';continue;}
    try{openPaperTrade(account,{product:event.product,price:bar.open,stop:signal.stop,target:signal.target,time,source:signal.setup??'support-bounce',pattern:signal.pattern},c);event.action='BUY';event.reason=signal.reason;}
    catch(error){event.reason=error.message;}
  }
  // Intrabar information becomes available only after every opening entry has
  // been sized. Its proceeds cannot travel backward into another opening fill.
  for(const event of active){
    if(event.sync)continue;
    const p=account.positions.find(position=>position.product===event.product),{bar,config:c}=event;
    if(!p||time<p.openedAt)continue;
    if(bar.low<=p.stop){closePaperTrade(account,p.id,Math.min(bar.open,p.stop),time,'stop',c);event.reason='Paper stop triggered; stop takes priority when both exits are touched.';event.action=event.action==='BUY'?'BUY_EXIT':'EXIT';}
    else if(bar.high>=p.target){closePaperTrade(account,p.id,p.target,time,'target',c);event.reason='Paper take-profit target reached.';event.action=event.action==='BUY'?'BUY_EXIT':'EXIT';}
  }
  // Mark all closes together before recording shared equity and daily loss.
  for(const event of active){account.marks[event.product]=event.bar.close;account.lastProcessed[event.product]=time;}
  for(const event of active){dayRisk(account,time,event.config);journal(account,event.product,time,event.analysis,event.config,event.reason,event.action);}
  account.equityHistory.push({time,equity:markToMarket(account).equity});
  if(account.equityHistory.length>5000)account.equityHistory.splice(0,account.equityHistory.length-5000);
  return account;
}

export function backtest(input,config={},options={}){
  const bars=normalizeCandles(input),account=createAccount();
  if(finite(options.startTime)){
    const before=bars.filter(b=>b.time<+options.startTime).at(-1);
    if(before){account.lastProcessed.BACKTEST=before.time;account.marks.BACKTEST=before.close;}
  }
  processCandles(account,'BACKTEST',bars,config,{autoTrade:true,replay:true});
  if(account.positions.length&&bars.length)closePaperTrade(account,account.positions[0].id,bars.at(-1).close,bars.at(-1).time,'end-of-test',config);
  const stats=markToMarket(account);
  return {account,...stats,returnPct:(stats.equity-account.initial)/account.initial,candles:finite(options.startTime)?bars.filter(b=>b.time>=+options.startTime).length:bars.length};
}

/** Offline research only. Never adopts a candidate or promises future gains. */
export function reviewStrategy(input,config={}){
  const c=cfg(config),bars=normalizeCandles(input);
  const required=c.strategy==='trendline'?480:240;
  if(bars.length<required)return {status:'insufficient-data',config:c,reason:`Need at least ${required} completed hourly candles for separate training and holdout samples.`,baseline:null,candidate:null,training:null,holdout:null};
  const cut=Math.floor(bars.length*0.7),train=bars.slice(0,cut),hold=bars.slice(cut);
  // Training candles may warm up indicators, but holdout account/fills start only
  // at the split. The training-selected candidate never sees future holdout data.
  const baseline=backtest(bars,c,{startTime:hold[0].time}),trainBase=backtest(train,c);
  const variants=c.strategy==='aggressive'?[{...c,rewardRisk:1.2},{...c,rewardRisk:2},{...c,maxHoldHours:1},{...c,stopAtrMultiplier:1.5}]:c.strategy==='trendline'?[{...c,trendLookback:120},{...c,trendLookback:240},{...c,proximity:0.004},{...c,proximity:0.008}]:[{...c,lookback:24},{...c,lookback:72},{...c,proximity:0.004},{...c,proximity:0.008}];
  const candidates=variants.map(config=>({config,result:backtest(train,config)}));
  candidates.sort((a,b)=>(b.result.returnPct-b.result.drawdown)-(a.result.returnPct-a.result.drawdown));
  const best=candidates[0],candidate=backtest(bars,best.config,{startTime:hold[0].time});
  const enough=[trainBase,best.result,baseline,candidate].every(r=>r.closedTrades>=5);
  const wins=enough&&best.result.returnPct>trainBase.returnPct&&candidate.returnPct>baseline.returnPct&&candidate.drawdown<=baseline.drawdown;
  const compact=r=>({returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,totalFees:r.totalFees});
  return {status:wins?'candidate':'retained',config:wins?best.config:c,reason:!enough?'Retained current parameters: fewer than five closed trades in a comparison sample.':wins?'A training-selected candidate also beat the baseline on the later holdout with no higher drawdown. Review before adoption; future gains are uncertain.':'Retained current parameters: the training-selected candidate did not pass the later holdout.',baseline:compact(baseline),candidate:compact(candidate),training:{candles:train.length,baseline:compact(trainBase),candidate:compact(best.result)},holdout:{candles:hold.length,start:hold[0].time,end:hold.at(-1).time}};
}

/** Explicitly experimental; this intentionally does not claim a confirmed Tori setup. */
function analyzeAggressive(input,c){
 const bars=normalizeCandles(input),last=bars.at(-1),base={strategy:'aggressive',setup:'aggressive-exploration',trend:'experimental',price:last?.close??null,support:null,resistance:null,atr:0,levels:[],trendlines:[],signal:'WAIT',reason:'Need 24 completed hourly bars.',stop:null,target:null};
 if(bars.length<24)return base;
 base.trendlines=analyzeTrendline(bars,{...c,strategy:'trendline'}).trendlines;
 const recent=bars.slice(-24);base.support=Math.min(...recent.map(b=>b.low));base.resistance=Math.max(...recent.map(b=>b.high));base.atr=recent.slice(-14).reduce((s,b)=>s+b.high-b.low,0)/14;
 base.stop=base.price-Math.max(base.price*.015,base.atr*c.stopAtrMultiplier);
 const fill=executionAt(base.price,base.stop,base.price,c);
 base.target=(fill.entry*(1+c.feeRate)+fill.risk*c.rewardRisk)/((1-c.slippage)*(1-c.feeRate));
 const bullish=last.close>last.open,nearSupport=last.close<=base.support*1.03,pullback=last.close/bars.at(-4).close-1<-.01;
 if(bullish||nearSupport||pullback){base.signal='BUY';base.reason='Aggressive PAPER exploration: bullish candle, widened support zone or countertrend pullback. Not a confirmed trendline entry; fixed cost-aware target and time exit.';}
 else base.reason='Aggressive experiment waits for a bullish candle, support-zone revisit, or pullback.';
 return base;
}

/** Current-quote execution never backdates fills into already-observed hourly candles. */
export function processQuoteBatch(account,events,{time=Date.now()/1000}={}){
 if(!Array.isArray(events)||!events.length||new Set(events.map(e=>e.product)).size!==events.length)throw new Error('Invalid quote batch');
 const prepared=events.map(e=>({...e,config:cfg(e.config),bars:normalizeCandles(e.bars)}));
 for(const e of prepared){const stamp=Date.parse(e.quote.time)/1000;if(!positive(e.quote.price)||!Number.isFinite(stamp)||time-stamp>120||stamp-time>30||e.bars.length<24||e.bars.some(b=>b.time+3600>time)||e.bars.slice(-24).some((b,i,a)=>i>0&&b.time!==a[i-1].time+3600)||time-(e.bars.at(-1).time+3600)>3600)throw new Error('Fresh quotes and completed history required for all markets.');}
 const bucket=Math.floor(time/300);if((account.lastQuoteBucket??-1)>=bucket)return account;
 account.decisions??=[];account.lastEntries??={};
 for(const e of prepared)dayRisk(account,time,e.config);
 for(const e of prepared)account.marks[e.product]=+e.quote.price;
 const exited=new Set();
 for(const e of prepared){const p=account.positions.find(p=>p.product===e.product);if(!p)continue;const price=+e.quote.price;
  const reason=price<=p.stop?'quote-stop':price>=p.target?'target':(p.maxHoldHours??e.config.maxHoldHours)>0&&time>=p.openedAt+(p.maxHoldHours??e.config.maxHoldHours)*3600?'time-exit':null;
  if(reason){closePaperTrade(account,p.id,reason==='target'?p.target:price,time,reason,e.config);exited.add(e.product);}
 }
 const priority=['XRP-USD','SOL-USD','ETH-USD','BTC-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD'];
 for(const e of prepared.sort((a,b)=>(priority.indexOf(a.product)<0?99:priority.indexOf(a.product))-(priority.indexOf(b.product)<0?99:priority.indexOf(b.product))||a.product.localeCompare(b.product))){const signal=analyze(e.bars,e.config);if(e.config.strategy==='aggressive'&&signal.signal==='BUY'){const price=+e.quote.price;signal.price=price;signal.stop=price-Math.max(price*.015,signal.atr*e.config.stopAtrMultiplier);const fill=executionAt(price,signal.stop,price,e.config);signal.target=(fill.entry*(1+e.config.feeRate)+fill.risk*e.config.rewardRisk)/((1-e.config.slippage)*(1-e.config.feeRate));}let action='WAIT',reason=signal.reason;
  if(account.positions.some(p=>p.product===e.product)){action='HOLD';reason='Open virtual position monitored at fresh quote.';}
  else if(exited.has(e.product)){action='EXIT';reason='Virtual exit executed at this check; no immediate same-check re-entry.';}
  else if(time-(account.lastEntries[e.product]??0)<1800)reason='30-minute exploration re-entry cooldown.';
  else if(signal.signal==='BUY')try{openPaperTrade(account,{product:e.product,price:+e.quote.price,stop:signal.stop,target:signal.target,time,source:signal.setup,pattern:signal.pattern},e.config);action='BUY';account.lastEntries[e.product]=time;}catch(error){reason=error.message;}
  journal(account,e.product,time,signal,e.config,reason,action);
 }
 account.lastQuoteBucket=bucket;account.equityHistory.push({time,equity:markToMarket(account).equity});if(account.equityHistory.length>5000)account.equityHistory.shift();return account;
}

/** Adapted research rules from day-trader-skill (see THIRD_PARTY.md); hourly crypto, not NYSE sessions. */
export function patternConfirmation(input,{asOf=Date.now()/1000}={}){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=asOf),last=bars.at(-1);
 const result={version:1,timeframe:'1h',asOf:last?last.time+3600:null,mode:'observe',confirmed:false,matches:[],context:[],status:'insufficient-data',volumeRatio:null,reason:'Need 31 contiguous completed hourly candles.'};
 const recent=bars.slice(-31);
 if(recent.length<31||recent.some((b,i)=>i&&b.time!==recent[i-1].time+3600))return result;
 if(asOf-last.time-3600>7200)return {...result,status:'stale-data',reason:'Completed hourly candle is over two hours old.'};
 const c=recent.map(b=>b.close),prior=c.slice(-21,-1),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 const high20=Math.max(...prior),ma=mean(c.slice(-20)),prevMa=mean(prior);
 const wilder=values=>{let gain=0,loss=0;for(let i=1;i<=14;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d)/14;loss+=Math.max(0,-d)/14;}for(let i=15;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*13+Math.max(0,d))/14;loss=(loss*13+Math.max(0,-d))/14;}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);};
 const rsi=wilder(recent.map(b=>b.close)),previousRsi=wilder(recent.slice(0,-1).map(b=>b.close));
 if(last.close>high20)result.matches.push('closing-high-breakout-20h');
 if(c.at(-2)<prevMa&&last.close>ma)result.matches.push('ma20-reclaim');
 if(previousRsi<30&&last.close>c.at(-2))result.matches.push('oversold-bounce');
 const run=c.at(-6)/c.at(-16)-1,range=(Math.max(...c.slice(-5))-Math.min(...c.slice(-5)))/last.close;
 if(run>.10&&range<.05)result.context.push('bull-flag-consolidation');
 if(rsi<30)result.context.push('oversold-alone-is-not-entry');
 // A consolidation is context only; a close above a frozen prior range is the entry confirmation.
 const flagPrior=c.slice(-6,-1),flagRun=c.at(-7)/c.at(-17)-1;
 if(flagRun>.10&&(Math.max(...flagPrior)-Math.min(...flagPrior))/c.at(-2)<.05&&last.close>Math.max(...recent.slice(-6,-1).map(b=>b.high)))result.matches.push('bull-flag-breakout');
 const volume=mean(recent.slice(-21,-1).map(b=>b.volume));result.volumeRatio=volume>0?last.volume/volume:null;
 return {...result,status:'evaluated',confirmed:result.matches.length>0,levels:{closingHigh20:high20,ma20:ma},rsi,previousRsi,reason:result.matches.length?'Completed hourly candle matches an explicit entry rule.':'No completed-candle entry confirmation; context alone is insufficient.'};
}

/** Fixed comparison, not a parameter search or permission to alter live paper entries. */
export function researchPatterns(input,config={},asOf=Date.now()/1000){
 const bars=normalizeCandles(input).filter(b=>b.time+3600<=asOf),base={version:1,mode:'shadow',timeframe:'1h',asOf:bars.at(-1)?.time+3600??null,candles:bars.length,confirmation:patternConfirmation(bars,{asOf}),status:'insufficient-data',recommendation:'Observe only; keep the current entry rules.',warning:'Hourly candle replay is an approximation of five-minute quote execution, not a forecast. No NYSE opening-range rule is applied to 24/7 crypto.'};
 if(bars.length<480)return {...base,reason:'Need 480 completed hourly candles for separated training and holdout.'};
 if(bars.some((b,i)=>i&&b.time!==bars[i-1].time+3600))return {...base,status:'data-gaps',reason:'Contiguous candles required; no results across missing intervals.'};
 const cut=Math.floor(bars.length*.7),train=bars.slice(0,cut),split=bars[cut].time;
 const compact=r=>({returnPct:r.returnPct,netPnl:r.equity-r.account.initial,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,totalFees:r.totalFees});
 const baseline={...config,patternRequired:false},filtered={...config,patternRequired:true};
 const training={baseline:compact(backtest(train,baseline)),filtered:compact(backtest(train,filtered))};
 const holdout={start:split,end:bars.at(-1).time+3600,baseline:compact(backtest(bars,baseline,{startTime:split})),filtered:compact(backtest(bars,filtered,{startTime:split}))};
 const enough=[training.baseline,training.filtered,holdout.baseline,holdout.filtered].every(r=>r.closedTrades>=5);
 const beats=(a,b)=>b.returnPct>a.returnPct&&b.drawdown<=a.drawdown;
 const passed=enough&&beats(training.baseline,training.filtered)&&beats(holdout.baseline,holdout.filtered)&&holdout.filtered.netPnl>0;
 return {...base,training,holdout,status:!enough?'insufficient-trades':passed?'promising-shadow':'no-demonstrated-edge',reason:!enough?'Fewer than five closes in at least one comparison sample.':passed?'Fixed filter improved training and later holdout net returns with no higher drawdown; still requires forward paper evidence.':'The fixed pattern filter did not improve both training and holdout with positive holdout profit and no higher drawdown.',assumptions:{execution:'next hourly open, adverse slippage; stop first if ambiguous',costs:'existing account fee, rebate and slippage configuration',risk:'identical risk caps and targets in both arms'},splitTime:split};
}
