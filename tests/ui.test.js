import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_CONFIG,createAccount} from '../engine.js';

// Application event smoke checks, with only the DOM surface used by this app.
// These check behavior and account boundaries; they do not replace visual browser QA.
class Element {
  constructor(dataset={}){this.dataset=dataset;this.listeners={};this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.open=false;this.attributes={};const values=new Set();this.classList={add:x=>values.add(x),remove:x=>values.delete(x),toggle:(x,on)=>on?values.add(x):values.delete(x)};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];}
  showModal(){this.open=true;}
  close(){this.open=false;}
  async emit(type,event={}){for(const fn of this.listeners[type]??[])await fn({preventDefault(){},target:this,...event});}
}
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
let sequence=0;
async function harness({staleQuote=false,oldSchedule=false}={}){
  const names=['document','window','location','localStorage','fetch','setTimeout','clearTimeout','setInterval','confirm'];
  const saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const selectors=new Map(),element=s=>{if(!selectors.has(s))selectors.set(s,new Element());return selectors.get(s)};
  const nav=['overview','journal','strategy','updates','settings'].map(nav=>new Element({nav}));
  const modes=['shared','personal'].map(account=>new Element({account}));
  const doc=new Element();doc.querySelector=element;doc.querySelectorAll=s=>s==='[data-nav]'?nav:s==='[data-account]'?modes:[];doc.hidden=false;
  const win=new Element();win.scrollTo=()=>{};
  const store=new Map([['level-lab-account-v1',JSON.stringify(createAccount(5000))]]);
  const calls=[],hour=Math.floor(Date.now()/3600000)*3600;
  const bars=Array.from({length:96},(_,i)=>({time:hour-(96-i)*3600,open:100+Math.sin(i)*2,high:105,low:95,close:101+Math.sin(i)*2,volume:50}));
  const products=Object.fromEntries(['BTC-USD','ETH-USD','SOL-USD'].map(p=>[p,{candles:bars,source:'fixture',fetchedAt:new Date().toISOString()}]));
  const shared={account:createAccount(),config:{...DEFAULT_CONFIG},products:['BTC-USD'],updatedAt:new Date(Date.now()-(oldSchedule?3*86400000:0)).toISOString()};
  shared.account.lastProcessed['BTC-USD']=hour-3600-(oldSchedule?3*86400:0);
  const snapshots={market:{products,errors:[]},paper:shared,reviews:{reviews:[]}};
  Object.assign(globalThis,{
    document:doc,window:win,location:{hash:'#overview'},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,confirm:()=>false,
    fetch:async url=>{
      calls.push(String(url));let value;
      const snapshot=String(url).match(/\.\/data\/(\w+)\.json/);
      if(snapshot)value=snapshots[snapshot[1]];
      else if(String(url).includes('/candles'))value=bars.map(b=>[b.time,b.low,b.high,b.open,b.close,b.volume]);
      else if(String(url).includes('/ticker'))value={price:'102',time:new Date(Date.now()-(staleQuote?300000:0)).toISOString()};
      else throw new Error(`Unexpected request: ${url}`);
      return {ok:true,json:async()=>structuredClone(value)};
    }
  });
  const module=source.replace("from './engine.js'",`from '${new URL('../engine.js',import.meta.url).href}'`)+`\n// smoke instance ${sequence++}`;
  await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`);
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  const click=async (selector,dataset)=>doc.emit('click',{target:{closest:s=>s===selector?new Element(dataset):null}});
  return {
    element,store,calls,shared,
    route:async key=>{globalThis.location.hash='#'+key;await win.emit('hashchange')},
    click,
    dispose(){for(const key of names){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
  };
}

test('frontend routes render real empty accounts and keep manual practice isolated',async()=>{
  const h=await harness();
  try{
    assert.match(h.element('#view').innerHTML,/\$10,000\.00/);
    assert.match(h.element('#view').innerHTML,/No open paper positions/);
    assert.match(h.element('#view').innerHTML,/Waiting for the first closed trade/);
    for(const [route,content] of [['journal','A fresh page in your journal'],['strategy','Historical replay'],['updates','No reviews yet'],['settings','Practice risk settings']]){
      await h.route(route);assert.match(h.element('#view').innerHTML,new RegExp(content));
    }
    await h.route('overview');
    await h.click('[data-account]',{account:'personal'});
    assert.match(h.element('#view').innerHTML,/\$5,000\.00/);
    await h.click('[data-action]',{action:'trade'});
    assert.equal(h.element('#trade-dialog').open,true);
    h.element('#trade-stop').value='95';h.element('#trade-target').value='115';
    await h.element('#trade-form').emit('submit');
    assert.equal(h.element('#trade-dialog').open,false);
    const practice=JSON.parse(h.store.get('level-lab-account-v1'));
    assert.equal(practice.positions.length,1);assert.ok(practice.cash<5000);
    await h.click('[data-account]',{account:'shared'});
    assert.match(h.element('#view').innerHTML,/No open paper positions/);
    assert.match(h.element('#view').innerHTML,/\$10,000\.00/);
    assert.equal(h.shared.account.positions.length,0);
    for(const request of h.calls)assert.ok(request.startsWith('./data/')||/^https:\/\/api\.exchange\.coinbase\.com\/products\/(BTC|ETH|SOL)-USD\/(candles|ticker)\?/.test(request),request);
  }finally{h.dispose()}
});

test('stale Coinbase quotes cannot open a manual paper trade',async()=>{
  const h=await harness({staleQuote:true});
  try{
    await h.click('[data-action]',{action:'trade'});
    assert.equal(h.element('#trade-dialog').open,false);
    assert.match(h.element('#toast').textContent,/fresh Coinbase quote is required/);
    assert.equal(JSON.parse(h.store.get('level-lab-account-v1')).positions.length,0);
  }finally{h.dispose()}
});

test('fresh public prices do not conceal a stale scheduled account',async()=>{
  const h=await harness({oldSchedule:true});
  try{
    assert.equal(h.element('#notice').hidden,false);
    assert.match(h.element('#notice').textContent,/scheduled|paper account/i);
  }finally{h.dispose()}
});
