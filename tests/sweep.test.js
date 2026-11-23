import test from 'node:test';import assert from 'node:assert/strict';
import {score,grid} from '../scripts/sweep.mjs';
test('sweep scores train/validation/unseen windows by entry time and the grid covers several strategies',()=>{
 const t=[{openedAt:1,pnl:10},{openedAt:2,pnl:-5},{openedAt:5,pnl:3},{openedAt:9,pnl:-1}];const s=score(t,3,8);
 assert.deepEqual([s.train.trades,s.train.net,s.validation.trades,s.unseen.net],[2,5,1,-1]);assert.equal(s.train.profitFactor,2);
 assert.ok(new Set(grid().map(c=>c.strategy)).size>=5);
});
