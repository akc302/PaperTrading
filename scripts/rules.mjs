/** Daily-review rule management for the public demo and the encrypted account (same code path for both).
 * Step 1: make trend-follow the main rules once; the previous rules are archived in rulesHistory. Never touches risk caps. */
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {TREND_DEFAULTS} from '../engine.js';
import {decryptState,encryptState} from './private-state.mjs';
import {ensureChallengers,retireLosers,RULE_KEYS} from './challengers.mjs';
import {reviewChallengers} from './promotion.mjs';
import {loadHistory} from './history.mjs';
/** Daily review for one account: migrate once, seed challengers, then evaluate promotion. */
export function dailyRules(state,{market,history,now}){
 const migrated=migrateToTrend(state,now),ownerSwitch=ownerSwitchToHourly(state,now)||ownerSwitchToDip2h(state,now),seeded=ensureChallengers(state,now),retired=retireLosers(state,now),review=reviewChallengers(state,{market,history,now});
 return {migrated,ownerSwitch,seeded,retired,promoted:review?.promoted??null,reviewed:!!review};
}
export const RULES_VERSION='trend-v1';
export const MAIN_TREND=Object.freeze({strategy:'trend-follow',...TREND_DEFAULTS,maxHoldHours:0,patternRequired:false,entryOrder:'limit',limitOffset:0.0005,limitChecks:3});
const CAPS=['riskPct','maxTotalRisk','maxAllocation','maxOpenPositions','maxDailyLoss'];
export const OWNER_HOURLY_VERSION='owner-hourly-v1';
/** Owner request (23 Nov 2026): the main PAPER account trades the hourly-legacy challenger's rules every day.
 * Copies only entry/exit rules (limit entries kept for maker fees); risk caps are unchanged and checked. The challenger
 * keeps its own ledger, the trend rules stay alive in the trend challengers, and the strategy lab tunes the main rules per market from here on. */
export function ownerSwitchToHourly(state,now=Date.now()/1000){
 if(state.rulesVersion===OWNER_HOURLY_VERSION||state.rulesVersion===OWNER_DIP_VERSION||state.rulesVersion===OWNER_DIP2_VERSION)return false;
 const src=(state.challengers??[]).find(c=>c.id==='hourly-legacy');if(!src)return false;
 const at=new Date(now*1000).toISOString(),before=CAPS.map(k=>state.config?.[k]);
 state.rulesHistory=[{at,event:'owner-switch-to-hourly',reason:'Owner asked the main paper account to trade the hourly-legacy rules daily.',previous:{config:{...state.config},productConfigs:structuredClone(state.productConfigs??{})}},...(state.rulesHistory??[])].slice(0,200);
 const next={...state.config};for(const k of RULE_KEYS)delete next[k];Object.assign(next,structuredClone(src.rules),{entryOrder:'limit'});
 for(const k of RULE_KEYS)if(next[k]===undefined)delete next[k];
 if(JSON.stringify(CAPS.map(k=>next[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
 state.config=next;state.productConfigs=structuredClone(src.productConfigs??{});state.rulesVersion=OWNER_HOURLY_VERSION;
 return true;
}
export const OWNER_DIP_VERSION='owner-dip6h-v1';
/** Owner request (25 Nov 2026): change the main PAPER strategy. Researcher evidence: dip-6h RSI<25 is the only rule positive in
 * both years of 2y history; the hourly rules lost in every regime. Rules copied from scout-dip6h at the main account's own risk caps
 * (unchanged and checked); the hourly rules keep trading daily in the hourly-legacy/lab-hourly challengers for continuous learning. */
export function ownerSwitchToDip(state,now=Date.now()/1000){
 if(state.rulesVersion===OWNER_DIP_VERSION||state.rulesVersion===OWNER_DIP2_VERSION)return false;
 const src=(state.challengers??[]).find(c=>c.id==='scout-dip6h');if(!src)return false;
 const at=new Date(now*1000).toISOString(),before=CAPS.map(k=>state.config?.[k]);
 state.rulesHistory=[{at,event:'owner-switch-to-dip6h',reason:'Owner asked for a new main strategy; dip-6h RSI<25 is the only rule positive in both years.',previous:{config:{...state.config},productConfigs:structuredClone(state.productConfigs??{})}},...(state.rulesHistory??[])].slice(0,200);
 const next={...state.config};for(const k of RULE_KEYS)delete next[k];Object.assign(next,structuredClone(src.rules),{entryOrder:'limit'});
 for(const k of RULE_KEYS)if(next[k]===undefined)delete next[k];
 if(JSON.stringify(CAPS.map(k=>next[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
 state.config=next;state.productConfigs={};state.rulesVersion=OWNER_DIP_VERSION;
 return true;
}
export const OWNER_DIP2_VERSION='owner-dip2h-v1';
/** Owner request (25 Nov 2026): more trades. Same dip rule on 2h bars (RSI<25, daily EMA100 uptrend): 24-28 trades/yr in the
 * 1y hourly test (+.3k, PF 1.55) vs about 7 on 6h bars. Risk caps unchanged. */
export function ownerSwitchToDip2h(state,now=Date.now()/1000){
 if(state.rulesVersion===OWNER_DIP2_VERSION)return false;
 if(state.rulesVersion!==OWNER_DIP_VERSION)ownerSwitchToDip(state,now);
 if(state.rulesVersion!==OWNER_DIP_VERSION)return false;
 const before=CAPS.map(k=>state.config?.[k]);state.config={...state.config,dipBarHours:2};
 if(JSON.stringify(CAPS.map(k=>state.config[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
 state.rulesHistory=[{at:new Date(now*1000).toISOString(),event:'owner-switch-to-dip2h',reason:'Owner asked for more daily trades; dip rule moved to 2h bars.'},...(state.rulesHistory??[])].slice(0,200);
 state.rulesVersion=OWNER_DIP2_VERSION;return true;
}
export function migrateToTrend(state,now=Date.now()/1000){
 if(state.rulesVersion)return false; // any later version means this one-time migration already happened
 const at=new Date(now*1000).toISOString(),before=CAPS.map(k=>state.config?.[k]);
 state.rulesHistory=[{at,event:'archived-main-rules',reason:'Trend following became the main strategy; previous hourly rules kept as challengers.',config:{...state.config},productConfigs:structuredClone(state.productConfigs??{})},...(state.rulesHistory??[])].slice(0,200);
 state.legacyRules={config:{...state.config},productConfigs:structuredClone(state.productConfigs??{}),archivedAt:at};
 state.config={...state.config,...MAIN_TREND};state.productConfigs={};state.rulesVersion=RULES_VERSION;
 if(JSON.stringify(CAPS.map(k=>state.config[k]))!==JSON.stringify(before))throw Error('Risk cap mutation refused');
 return true;
}
export async function run(){
 const now=Date.now()/1000,paper=JSON.parse(await readFile('data/paper.json','utf8')),market=JSON.parse(await readFile('data/market.json','utf8')),history=await loadHistory();
 const r=dailyRules(paper,{market,history,now});console.log(`Public demo rules: ${JSON.stringify(r)}.`);
 await writeFile('data/paper.json',JSON.stringify(paper,null,2)+'\n');
 const key=process.env.PAPER_STATE_KEY?.trim();if(!key)return;
 try{const state=await decryptState(JSON.parse(await readFile('data/portfolio.enc.json','utf8')),key);
  dailyRules(state,{market,history,now});console.log('Private account: daily rule review done (details encrypted).');
  const tmp='data/.rules.enc.tmp';try{await writeFile(tmp,JSON.stringify(await encryptState(state,key),null,2)+'\n',{mode:0o600});await rename(tmp,'data/portfolio.enc.json');}finally{await rm(tmp,{force:true});}
 }catch{console.error('Private rule update failed; ciphertext unchanged.');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
