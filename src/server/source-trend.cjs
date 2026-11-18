'use strict';

const dayMs=86400000;
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const shift=(day,days)=>new Date(Date.parse(day+'T00:00:00Z')+days*dayMs).toISOString().slice(0,10);
const validUsers=value=>Number.isSafeInteger(value)&&value>=0;

function update(previous, snapshot) {
 const observed=Date.parse(snapshot?.observedAt);
 if(!Number.isFinite(observed)||!validUsers(snapshot?.users))return previous||[];
 const day=kst.format(observed);
 const points=new Map((previous||[]).map(point=>[point.day,point]));
 if(!points.has(day)||observed>=Date.parse(points.get(day).observedAt)){
  points.set(day,{day,users:snapshot.users,observedAt:snapshot.observedAt});
 }
 return [...points.values()].filter(point=>point.day>=shift(day,-30)).sort((a,b)=>a.day.localeCompare(b.day)).slice(-31);
}

function summarize(history, timestamp=Date.now()) {
 const day=kst.format(timestamp);
 const byDay=new Map((history||[]).map(point=>[point.day,point]));
 const points=Array.from({length:30},(_,index)=>{
  const date=shift(day,index-29);
  return {day:date,users:byDay.get(date)?.users??null};
 });
 const current=byDay.get(day),past=byDay.get(shift(day,-7));
 return {points,change:current&&past?current.users-past.users:null};
}

module.exports={update,summarize};
