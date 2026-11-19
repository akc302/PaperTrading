/** Pure market analysis plus a virtual, long-only ledger. No account or order APIs. */
export const DEFAULT_CONFIG = Object.freeze({lookback:48,pivotWindow:3,proximity:0.006,stopBuffer:0.004,rewardRisk:2,riskPct:0.01,feeRate:0.006,slippage:0.0005,maxAllocation:0.25});

const finite = (n) => Number.isFinite(Number(n));
const positive = (n) => finite(n) && Number(n)>0;
const cfg = (c={}) => {
  const x={...DEFAULT_CONFIG,...c};
  if(!Number.isInteger(x.lookback)||x.lookback<12||x.lookback>300||!Number.isInteger(x.pivotWindow)||x.pivotWindow<1||x.pivotWindow>10) throw new Error('Invalid level window.');
  if(!positive(x.proximity)||x.proximity>0.1||!positive(x.stopBuffer)||x.stopBuffer>0.1||!positive(x.rewardRisk)||x.rewardRisk>10) throw new Error('Invalid strategy parameters.');
  if(!positive(x.riskPct)||x.riskPct>0.05||!positive(x.maxAllocation)||x.maxAllocation>1||!finite(x.feeRate)||x.feeRate<0||x.feeRate>0.05||!finite(x.slippage)||x.slippage<0||x.slippage>0.05) throw new Error('Invalid paper risk or execution settings.');
  return x;
};
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
  return {initial:+initial,cash:+initial,positions:[],trades:[],equityHistory:[],lastProcessed:{},marks:{},nextId:1};
}

export function markToMarket(account,prices={}){
  const marks={...account.marks,...prices};
  const equity=account.cash+account.positions.reduce((s,p)=>s+p.quantity*(positive(marks[p.product])?+marks[p.product]:p.entry),0);
  const unrealized=account.positions.reduce((s,p)=>s+p.quantity*((positive(marks[p.product])?+marks[p.product]:p.entry)-p.entry)-p.entryFee,0);
  const realized=account.trades.reduce((s,t)=>s+t.pnl,0);
  let peak=account.initial,drawdown=0;
  for(const point of [...account.equityHistory,{equity}]){peak=Math.max(peak,point.equity);drawdown=Math.max(drawdown,(peak-point.equity)/peak);}
  return {equity,unrealized,realized,winRate:account.trades.length?account.trades.filter(t=>t.pnl>0).length/account.trades.length:0,closedTrades:account.trades.length,totalFees:account.trades.reduce((s,t)=>s+t.fees,0)+account.positions.reduce((s,p)=>s+p.entryFee,0),drawdown};
}

/** Mutates account, returns it. Fills are modeled with adverse slippage and fees. */
export function openPaperTrade(account,{product,price,stop,target,time=Date.now()/1000,source='manual'},config={}){
  const c=cfg(config);
  if(typeof product!=='string'||!product||![price,stop,target].every(positive)||!finite(time))throw new Error('Invalid paper trade.');
  if(account.positions.some(p=>p.product===product))throw new Error('A paper position is already open for this market.');
  const {entry,risk:lossPerUnit,reward}=executionAt(+price,+stop,+target,c);
  if(+stop>=entry||+target<=entry)throw new Error('Stop must be below entry; target must be above entry.');
  const equity=markToMarket(account).equity;
  const quantity=Math.min(equity*c.riskPct/lossPerUnit,equity*c.maxAllocation/(entry*(1+c.feeRate)),account.cash/(entry*(1+c.feeRate)));
  if(!positive(quantity)||quantity*entry<0.01)throw new Error('Insufficient virtual cash.');
  const entryFee=entry*quantity*c.feeRate;
  account.cash-=entry*quantity+entryFee;
  account.positions.push({id:`paper-${account.nextId++}`,product,entry,quantity,stop:+stop,target:+target,openedAt:+time,entryFee,source,riskBudget:equity*c.riskPct,estimatedRewardRisk:reward/lossPerUnit,feeRate:c.feeRate,slippage:c.slippage});
  account.marks[product]=+price;
  return account;
}

export function closePaperTrade(account,id,price,time=Date.now()/1000,reason='manual',config={}){
  cfg(config);
  if(!positive(price)||!finite(time))throw new Error('Invalid closing price or time.');
  const index=account.positions.findIndex(p=>p.id===id);
  if(index<0)throw new Error('Paper position not found.');
  const p=account.positions[index],exit=+price*(1-p.slippage),exitFee=exit*p.quantity*p.feeRate;
  account.cash+=exit*p.quantity-exitFee;
  account.trades.push({...p,exit,closedAt:+time,exitFee,fees:p.entryFee+exitFee,pnl:(exit-p.entry)*p.quantity-p.entryFee-exitFee,reason});
  account.positions.splice(index,1);account.marks[p.product]=+price;
  return account;
}

/** Pass completed candles only. Initial sync starts now; replay=true is for backtests. */
export function processCandles(account,product,input,config={},options={}){
  const c=cfg(config),bars=normalizeCandles(input),{autoTrade=true,replay=false}=options;
  if(!bars.length)return account;
  account.lastProcessed??={};account.marks??={};
  if(account.lastProcessed[product]==null&&!replay){account.lastProcessed[product]=bars.at(-1).time;account.marks[product]=bars.at(-1).close;return account;}
  for(let i=0;i<bars.length;i++){
    const bar=bars[i];if(bar.time<=(account.lastProcessed[product]??-1))continue;
    // A signal can use only bars that ended before this bar began. Never its future high/low.
    if(autoTrade&&!account.positions.some(p=>p.product===product)&&i>=Math.max(12,c.pivotWindow*2+3)){
      const signal=analyze(bars.slice(0,i),c);
      const fill=executionAt(bar.open,signal.stop,signal.target,c);
      // Recheck at the executable next open: an upward gap can erase the signal's
      // advertised reward/risk even when the original stop and target bracket it.
      const requiredReward=fill.risk*c.rewardRisk;
      const meetsRewardRisk=fill.risk>0&&fill.reward+Math.max(1,Math.abs(requiredReward))*1e-10>=requiredReward;
      if(signal.signal==='BUY'&&signal.stop<bar.open&&signal.target>fill.entry&&meetsRewardRisk){
        openPaperTrade(account,{product,price:bar.open,stop:signal.stop,target:signal.target,time:bar.time,source:'support-bounce'},c);
      }
    }
    const p=account.positions.find(p=>p.product===product);
    if(p&&bar.time>=p.openedAt){
      // If both exits were touched, choose stop first. Stop gaps fill at the worse open.
      if(bar.low<=p.stop)closePaperTrade(account,p.id,Math.min(bar.open,p.stop),bar.time,'stop',c);
      else if(bar.high>=p.target)closePaperTrade(account,p.id,p.target,bar.time,'target',c);
    }
    account.marks[product]=bar.close;account.lastProcessed[product]=bar.time;
    const point={time:bar.time,equity:markToMarket(account).equity};
    account.equityHistory.push(point);
    if(account.equityHistory.length>5000)account.equityHistory.splice(0,account.equityHistory.length-5000);
  }
  return account;
}

export function backtest(input,config={}){
  const bars=normalizeCandles(input),account=createAccount();
  processCandles(account,'BACKTEST',bars,config,{autoTrade:true,replay:true});
  if(account.positions.length&&bars.length)closePaperTrade(account,account.positions[0].id,bars.at(-1).close,bars.at(-1).time,'end-of-test',config);
  const stats=markToMarket(account);
  return {account,...stats,returnPct:(stats.equity-account.initial)/account.initial,candles:bars.length};
}

/** Offline research only. Never adopts a candidate or promises future gains. */
export function reviewStrategy(input,config={}){
  const c=cfg(config),bars=normalizeCandles(input);
  if(bars.length<240)return {status:'insufficient-data',config:c,reason:'Need at least 240 completed hourly candles for separate training and holdout samples.',baseline:null,candidate:null,training:null,holdout:null};
  const cut=Math.floor(bars.length*0.7),train=bars.slice(0,cut),hold=bars.slice(cut);
  const baseline=backtest(hold,c),trainBase=backtest(train,c);
  const candidates=[{...c,lookback:24},{...c,lookback:72},{...c,proximity:0.004},{...c,proximity:0.008}].map(config=>({config,result:backtest(train,config)}));
  candidates.sort((a,b)=>(b.result.returnPct-b.result.drawdown)-(a.result.returnPct-a.result.drawdown));
  const best=candidates[0],candidate=backtest(hold,best.config);
  const enough=[trainBase,best.result,baseline,candidate].every(r=>r.closedTrades>=5);
  const wins=enough&&best.result.returnPct>trainBase.returnPct&&candidate.returnPct>baseline.returnPct&&candidate.drawdown<=baseline.drawdown;
  const compact=r=>({returnPct:r.returnPct,drawdown:r.drawdown,closedTrades:r.closedTrades,winRate:r.winRate,totalFees:r.totalFees});
  return {status:wins?'candidate':'retained',config:wins?best.config:c,reason:!enough?'Retained current parameters: fewer than five closed trades in a comparison sample.':wins?'A training-selected candidate also beat the baseline on the later holdout with no higher drawdown. Review before adoption; future gains are uncertain.':'Retained current parameters: the training-selected candidate did not pass the later holdout.',baseline:compact(baseline),candidate:compact(candidate),training:{candles:train.length,baseline:compact(trainBase),candidate:compact(best.result)},holdout:{candles:hold.length,start:hold[0].time,end:hold.at(-1).time}};
}
