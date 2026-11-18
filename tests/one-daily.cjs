'use strict';

const assert=require('node:assert/strict');
const {choice,matches,groupIssues,createPoll}=require('../public/one/daily.js');
const {summarize}=require('../src/server/source-trend.cjs');

async function main(){
 assert.equal(choice('toString'),'all');
 assert.equal(matches({brand:'mind'},'mind'),true);
 assert.equal(matches({brand:'holdem'},'mind'),false);
 assert.equal(matches({},'common'),true);
 const posts=[
  {id:'a',account:'account',channel:'instagram',connection:true},
  {id:'b',account:'account',channel:'instagram',connection:true},
  {id:'c',account:'account',channel:'youtube',connection:true},
  {id:'d',account:'account',channel:'instagram',connection:false},
 ];
 assert.deepEqual(groupIssues(posts).map(g=>g.items.map(p=>p.id)),[['a','b'],['c'],['d']]);

 let epoch=1,blocked=false,release,applied=null;
 const poll=createPoll({capture:()=>epoch,blocked:()=>blocked,read:()=>new Promise(resolve=>{release=resolve;}),apply:v=>{applied=v;}});
 const first=poll();
 assert.equal(await poll(),false);
 epoch++;
 release({observedAt:1});
 assert.equal(await first,false);
 assert.equal(applied,null);
 const second=poll();
 blocked=true;
 release({observedAt:2});
 assert.equal(await second,false);
 blocked=false;
 const third=poll();
 release({observedAt:3});
 assert.equal(await third,true);
 assert.deepEqual(applied,{observedAt:3});

 const previous={day:'2026-11-18',observedAt:'2026-11-18T14:58:00.000Z',users:100};
 const current={day:'2026-11-19',observedAt:'2026-11-18T15:02:00.000Z',users:94};
 const timestamp=Date.parse(current.observedAt);
 assert.deepEqual(summarize([previous,current],timestamp).daily,{state:'significant',previous,current,delta:-6,threshold:5});
 assert.equal(summarize([current],timestamp).daily.state,'insufficient');
 assert.equal(summarize([previous,{...current,users:101}],timestamp).daily.state,'quiet');
 assert.equal(summarize([previous,{...current,users:null}],timestamp).daily.state,'insufficient');
 console.log('Daily dashboard: late read rejection, brand and account grouping, and KST snapshot changes passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
