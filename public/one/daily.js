'use strict';

const oneDaily = (() => {
 const labels = {all:'모든 브랜드',mind:'누리마인드',holdem:'누리홀덤',common:'브랜드 미지정'};
 const choice = value => Object.hasOwn(labels,value) ? value : 'all';
 const matches = (post, brand) => brand==='all'||(brand==='common'?!['mind','holdem'].includes(post?.brand):post?.brand===brand);
 function groupIssues(issues) {
  const groups=new Map();
  for (const issue of issues) {
   const key=issue.connection&&issue.account?JSON.stringify([issue.channel,issue.account]):issue.id;
   if (!groups.has(key)) groups.set(key,{...issue,items:[]});
   groups.get(key).items.push(issue);
  }
  return Array.from(groups.values());
 }
 function createPoll({capture,blocked,read,apply}) {
  let active=false;
  return async function poll() {
   if(active||blocked())return false;
   const origin=capture();
   active=true;
   try {
    const next=await read();
    if(origin!==capture()||blocked())return false;
    apply(next);
    return true;
   }catch{return false;}
   finally{active=false;}
  };
 }
 function crossedTimeBoundary(posts,previous,next){
  const from=Date.parse(previous),to=Date.parse(next);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return false;
  if(Math.floor((from+32400000)/86400000)!==Math.floor((to+32400000)/86400000))return true;
  const crossed=date=>date>=from&&date<to;
  return posts.some(p=>{
   const at=Date.parse(p.scheduledAt);
   return p.status==='scheduled'&&(crossed(at)||crossed(at+300000));
  });
 }
 return {labels,choice,matches,groupIssues,createPoll,crossedTimeBoundary};
})();

if(typeof module==='object')module.exports=oneDaily;
if(typeof window!=='undefined')window.NuriDaily=oneDaily;

if(typeof window!=='undefined')Object.assign(oneDaily,{
 brand:'all',
 target:null,
 matchesBrand(post){return this.matches(post,this.brand);},
 reveals(id){return this.target===id;},
 brandKey(){return 'one-brand:'+String(session?.email||'sample');},
 restoreBrand(){
  try{this.brand=this.choice(sessionStorage.getItem(this.brandKey()));}catch{}
 },
 selectBrand(value){
  const brand=this.choice(value);
  if(brand!==this.brand&&window.NuriStudio?.prepareBrandChange&&!window.NuriStudio.prepareBrandChange()){
   const control=document.querySelector('[name="daily-brand"]');
   if(control)control.value=this.brand;
   return;
  }
  this.brand=brand;
  this.target=null;
  try{sessionStorage.setItem(this.brandKey(),this.brand);}catch{}
  if(state.page==='approval'){
   NuriOperator.resetFilters();
   history.replaceState(null,'','#approval/tistory');
  }
  render();
  document.querySelector('[name="daily-brand"]')?.focus({preventScroll:true});
 },
 brandBar(){
  if(!['studio','approval','calendar','growth'].includes(state.page))return '';
  const target=this.target&&data.contents.find(post=>post.id===this.target);
  return '<div class="daily-brand">'+selectField('브랜드','daily-brand',Object.entries(this.labels),this.brand)+
   (target?'<p class="caption">선택한 게시물을 확인하고 있습니다.</p><button type="button" class="btn" data-daily-return>브랜드 목록으로</button>':'')+'</div>';
 },
 queue(){
  const posts=data.contents.filter(p=>snsPost(p)&&requiresApproval(p)&&!platformExcluded(p)&&!p.manual&&!p.externalId);
  const issues=posts.filter(p=>p.status==='review'||p.status==='scheduled'&&p.attempt?.code!=='processing'&&NuriOperator.diagnostics(p))
   .map(p=>({id:p.id,title:p.title,channel:p.channel,account:p.account,
    connection:p.attempt?.code==='connection',reason:NuriOperator.diagnostics(p)||'채널 게시 결과를 확인하세요.'}));
  const review=posts.filter(p=>['draft','approved'].includes(p.status)&&!NuriOperator.diagnostics(p));
  const deadline=data.tasks.filter(t=>t.status!=='done'&&t.due&&t.due<=today()).sort((a,b)=>a.due.localeCompare(b.due));
  const openPost=(p,label)=>'<button type="button" class="btn" data-page="approval" data-approval-id="'+esc(p.id)+'">'+label+'</button>';
  const row=(title,reason,action)=>'<div class="daily-row"><div><strong>'+esc(title)+'</strong><p class="caption">'+esc(reason)+'</p></div>'+action+'</div>';
  const groups=this.groupIssues(issues);
  const limit=5;
  const rows=[
   ...groups.slice(0,limit).map(group=>{
    if(group.items.length===1)return row(group.title,(labels[group.channel]||group.channel)+' · '+group.reason,openPost(group,'예약 확인'));
    const account=data.accounts.find(a=>a.id===group.account);
    return '<details class="daily-group"><summary><strong>'+esc(account?.label||labels[group.channel])+' · 계정 연결 확인</strong> <span class="caption">예약 '+money(group.items.length)+'건</span></summary>'+
     '<ul>'+group.items.map(p=>'<li>'+row(p.title,p.reason,openPost(p,'예약 확인'))+'</li>').join('')+'</ul>'+
     (!session.readOnly?'<button type="button" class="btn" data-action="sns-settings">연결 설정 열기</button>':'')+'</details>';
   }),
   ...review.slice(0,3).map(p=>row(p.title,(labels[p.channel]||p.channel)+' · 게시 전 승인 대기',openPost(p,'원고 검토'))),
   ...deadline.slice(0,2).map(t=>row(t.title,(t.due<today()?'기한 경과 ':'오늘 마감 ')+t.due+' · '+(t.assignee||'담당 미지정'),
    session.readOnly?'<button type="button" class="btn" data-page="tasks">업무 목록</button>':button('업무 보기','task-edit',t.id))),
  ];
  const more=(groups.length>limit?'<button type="button" class="btn" data-approval-filter="issues">예약 확인 전체</button>':'')+
   (review.length>3?'<button type="button" class="btn" data-approval-filter="pending">검토 대기 전체</button>':'')+
   (deadline.length>2?'<button type="button" class="btn" data-page="tasks">마감 업무 전체</button>':'');
  return '<section class="panel panel-inner daily-queue" aria-labelledby="daily-queue-heading"><div class="panel-head"><h2 id="daily-queue-heading">오늘 처리할 일</h2>'+
   '<time class="caption" datetime="'+today()+'">'+today().replaceAll('-', '. ')+' KST</time></div>'+
   (rows.length?'<ul class="daily-queue-list"><li>'+rows.join('</li><li>')+'</li></ul>':'<p class="caption">확인이 필요한 예약, 승인 대기 원고, 마감 업무가 없습니다.</p>')+
   (more?'<div class="toolbar">'+more+'</div>':'')+'</section>';
 },
 trend(site){
  const trend=site.userTrend?.daily;
  if(!trend)return '';
  if(site.stale)return '<small class="daily-change caption">최근 변화 · 원천 재조회 필요</small>';
  if(trend.state==='insufficient')return '<small class="daily-change caption">최근 변화 · 비교할 조회 기록 부족</small>';
  if(trend.state!=='significant')return '';
  const before=trend.previous,after=trend.current;
  return '<small class="daily-change"><strong>최근 '+formatUserChange(trend.delta)+'</strong><br><span class="caption">'+
   money(before.users)+'명 → '+money(after.users)+'명 · '+esc(dt(before.observedAt))+' → '+esc(dt(after.observedAt))+' KST</span></small>';
 },
 pushSettings:null,
 pushFields(){
  const prefs=this.pushSettings?.timing;
  const check=(name,label,checked)=>'<label class="check-label"><input type="checkbox" name="'+name+'" '+(checked?'checked':'')+'>'+label+'</label>';
  return '<fieldset class="daily-push"><legend>이 기기의 수신 시간 · KST</legend>'+
   check('push-immediate','확인이 필요한 예약은 바로 받기',prefs?.immediate??true)+
   check('push-morning','아침에 한 번 요약 받기',prefs?.morning??false)+
   check('push-quiet','조용한 시간에 알림 모으기',prefs?.quiet??false)+
   '<div class="daily-push-times">'+
   formField('조용한 시간 시작','push-from',prefs?.from||'22:00','time')+
   formField('조용한 시간 종료','push-to',prefs?.to||'08:00','time')+
   formField('아침 요약','push-morningAt',prefs?.morningAt||'08:00','time')+'</div>'+
   '<p class="caption">조용한 시간과 겹치는 아침 요약은 조용한 시간이 끝난 뒤 받습니다. 수신 시간을 적용하려면 이 기기에서 알림 받기를 누르세요.</p></fieldset>';
 },
 pushOptions(){
  const panel=document.querySelector('.daily-push');
  if(!panel)return {};
  const read=(name,property)=>panel.querySelector('[name="push-'+name+'"]')[property];
  return {timing:{immediate:read('immediate','checked'),morning:read('morning','checked'),
   quiet:read('quiet','checked'),from:read('from','value'),to:read('to','value'),morningAt:read('morningAt','value')}};
 },
 async loadPush(){
  const panel=document.querySelector('.daily-push');
  if(!panel)return;
  const epoch=refreshEpoch;
  try{
   const worker=await navigator.serviceWorker.getRegistration('/dashboard');
   const subscription=await worker?.pushManager.getSubscription();
   if(!subscription||!panel.isConnected||epoch!==refreshEpoch)return;
   const prefs=this.pushSettings||await api('push/preferences',{endpoint:subscription.endpoint});
   if(!panel.isConnected||epoch+(this.pushSettings?0:2)!==refreshEpoch)return;
   this.pushSettings=prefs.active?prefs:null;
   if(!this.pushSettings)return;
   for(const [name,value] of Object.entries(prefs.timing)){
    const input=panel.querySelector('[name="push-'+name+'"]');
    input[typeof value==='boolean'?'checked':'value']=value;
   }
   document.getElementById('device-regular-activity').checked=prefs.activity;
   document.getElementById('device-push-status').textContent='이 기기에 저장된 수신 설정입니다.';
  }catch{}
 },
});
