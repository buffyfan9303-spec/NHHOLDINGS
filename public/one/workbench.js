'use strict';
(() => {
  const root=document.getElementById('workbench');
  if(!root)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const sections={projects:'프로젝트',schedule:'일정 재계획',approvals:'승인함',connect:'연결 관리'};
  const categories={business:'사업 운영',content:'콘텐츠',seller:'판매 준비',mail:'메일',drive:'Drive',schedule:'일정',cards:'카드뉴스'};
  const providers={chatgpt:['ChatGPT','플러그인 → 추가 → 사용자 지정 MCP 서버에서 이 주소를 등록하세요. Business·Enterprise·Edu에서 작성 기능을 지원합니다. Pro는 조회 권한으로 연결할 수 있습니다.','https://chatgpt.com/'],claude:['Claude','커넥터에서 사용자 지정 연결을 추가하고 OAuth 클라이언트는 자동 등록을 선택하세요.','https://claude.ai/'],gemini:['Gemini','사용자 지정 연결은 현재 미국의 개인 Google 계정에서 영어로 지원됩니다. 한국에서는 구독 AI의 요청 복사 기능을 사용하세요.','https://gemini.google.com/']};
  const templates={
    business:{label:'1인 AI 사업자',name:'고객 제안과 주간 운영',rules:'고객이 요청한 범위와 확인되지 않은 가정을 구분한다. 제안서는 목표, 범위, 일정, 검토할 질문 순으로 쓴다. 확인되지 않은 비용이나 성과를 확정 표현으로 쓰지 않는다.',step:'고객 요청 요약 → 제안 초안 → 마감 배치 → 메일 검토',prompt:'프로젝트 기억을 읽고, 내가 제공하는 고객 요청으로 제안서 초안을 작성해 누리원 승인함에 넣어줘. 확정되지 않은 조건에는 확인 필요라고 표시해줘.'},
    content:{label:'콘텐츠 크리에이터',name:'주간 콘텐츠 제작',rules:'독자가 바로 사용할 수 있는 예시를 넣는다. 인용과 이미지의 출처를 확인한다. 채널마다 첫 문장과 길이를 조정하고, 과장 표현을 피한다.',step:'아이디어 → 카드뉴스 원고 → 채널별 문구 → 게시 전 검토',prompt:'프로젝트 기억을 읽고 내가 주는 주제를 바탕으로 카드뉴스 5장은 카드뉴스 도구로, 채널별 문구는 별도의 콘텐츠 초안으로 작성해 누리원 승인함에 넣어줘.'},
    seller:{label:'개인마켓 셀러',name:'상품 출시 준비',rules:'제공받은 상품 사양만 사용한다. 배송, 반품, 가격 등 미정인 조건은 확인 필요로 표시한다. 고객 정보는 초안에 포함하지 않는다.',step:'실제 상품 자료 → 상세페이지 문구 → 고객 질문 → 판매 전 점검',prompt:'프로젝트 기억을 읽고 내가 제공하는 상품 자료로 상세페이지 문구와 고객 질문 답변 초안을 작성해 누리원 승인함에 넣어줘.'},
    personal:{label:'개인 업무',name:'내 일과 자료 정리',rules:'마감이 가까운 일부터 정리한다. 문서는 제목, 정리 위치, 다음 할 일만 간단히 적는다. 가족이나 지인의 정보를 별도 승인 없이 공유하지 않는다.',step:'오늘 할 일 → 집중 시간 → 자료 정리 → 확인',prompt:'오늘 업무와 프로젝트 기억을 읽고, 중요한 일 세 가지와 자료 정리 순서를 제안해서 누리원 승인함에 넣어줘.'},
  };
  let pane='projects', owner=null, controller=null, data=null, projectId=null, detailId=null, selectedTemplate=null, showHistory=false;
  let running=false, resume=null, channels=null, checkingChannels=false, channelError=false;
  const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
  function today(){return now.format(new Date());}
  function connectionURL(){return location.origin+'/api/one/mcp';}
  function status(message){const el=root.querySelector('[data-workbench-status]');if(el)el.textContent=message;}
  function action(label,key,id=''){return '<button type="button" class="btn" data-action="'+key+'" data-id="'+esc(id)+'">'+label+'</button>';}
  const selectProject=()=>'<option value="">선택 안 함</option>'+data.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  function projects(){
    const project=data.projects.find(p=>p.id===projectId);
    const template=templates[selectedTemplate];
    return '<div class="workbench-body">'+
      '<section><h2>프로젝트 기억</h2><p class="workbench-muted">프로젝트마다 말투, 기준, 확인할 사실을 저장합니다. 연결된 AI는 선택한 프로젝트의 기억을 읽습니다.</p>'+
      '<ul class="workbench-list">'+data.projects.map(p=>'<li>'+action(esc(p.name),'edit',p.id)+'</li>').join('')+'</ul>'+
      '<form data-form="project" class="personal-form"><label>프로젝트 이름<input name="name" maxlength="80" required value="'+esc(project?.name??template?.name)+'"></label>'+
      '<label>AI가 참고할 업무 원칙<textarea name="rules" rows="4" maxlength="1600" required>'+esc(project?.rules??template?.rules)+'</textarea></label>'+
      '<div class="workbench-actions"><button class="btn primary" type="submit">기억 저장</button>'+
      (project?action('새 프로젝트','new')+action('기억 삭제','remove-project',project.id):'')+'</div></form></section>'+
      '<section><h2>업무별 시작 가이드</h2><ul class="workbench-list">'+Object.entries(templates).map(([id,entry])=>
        '<li><strong>'+entry.label+'</strong><p>'+entry.step+'</p>'+action('예제로 시작','template',id)+'</li>').join('')+'</ul>'+
      (template?'<div class="workbench-detail"><h3>연결한 AI에게 이렇게 요청하세요</h3><p>'+esc(template.prompt)+'</p>'+action('요청 문장 복사','copy-example',selectedTemplate)+' <a href="#workbench" data-action="connect-pane">AI 연결 확인</a></div>':'')+'</section></div>';
  }

  function schedule(){
    return '<section class="workbench-narrow"><h2>빈 시간에 할 일 배치</h2><p class="workbench-muted">선택한 날의 빈 시간에 마감이 가까운 할 일을 30분씩 배치합니다. 날짜가 없는 할 일은 제외합니다. 기존 마감과 일정을 유지하고 제안은 승인함에서 확인합니다.</p>'+
      '<form class="personal-form" data-form="plan"><label>배치할 날짜<input type="date" name="day" min="'+today()+'" value="'+today()+'" required></label>'+
      '<div class="workbench-time"><label>시작 시간<input type="time" name="start" value="09:00" required></label><label>끝 시간<input type="time" name="end" value="18:00" required></label></div>'+
      '<small>한국 시간 기준. 시간이 있는 일정과 예약은 시작부터 30분을 비워 둡니다.</small>'+
      '<div><button class="btn primary" type="submit">일정 제안 만들기</button></div></form><a class="personal-link" href="#schedule">내 일정 보기</a></section>';
  }
  function approvals(){
    const decision=data.decisions.find(item=>item.id===detailId);
    const rows=data.decisions.filter(item=>showHistory?item.status!=='pending':item.status==='pending');
    const statusText={pending:'검토 대기',applied:'승인 완료',declined:'반려',undone:'되돌림'};
    let details='<p class="personal-empty">목록에서 검토할 항목을 고르세요.</p>';
    if(decision) {
      const project=data.projects.find(item=>item.id===decision.projectId);
      const stale=decision.projectId&&(!project||project.version!==decision.projectVersion);
      const destination={mail:'메일 초안 열기',content:'게시 초안 열기',drive:'정리 메모 열기',business:'업무 메모 열기',seller:'판매 준비 메모 열기'};
      const link=destination[decision.category];
      const cardList=decision.card?.slides.map((slide,index)=>'<li><small>'+(index+1)+'장</small><strong>'+esc(slide.headline)+'</strong><p>'+esc(slide.body)+'</p>'+
        (decision.status==='applied'&&decision.cardId?'<a class="btn" href="/api/personal/ai/cards/'+esc(decision.cardId)+'?slide='+index+'" target="_blank" rel="noopener">이미지 확인</a>':'')+'</li>').join('');
      details='<section class="workbench-detail">'+action('목록으로','close-review')+'<h3>'+esc(decision.title)+'</h3><p class="workbench-muted">'+esc(statusText[decision.status])+' · '+esc(decision.source)+(project?' · '+esc(project.name)+' (기억 v'+esc(decision.projectVersion)+')':'')+'</p>'+
        '<p>'+esc(decision.text)+'</p>'+
        (stale?'<p>초안 제안 이후 프로젝트 기억이 바뀌었습니다. 최신 기준과 대조해 주세요.</p>':'')+
        (decision.moves?'<ul class="workbench-list">'+decision.moves.map(move=>'<li><time>'+esc(move.day+' '+move.time)+'</time><strong>'+esc(move.title)+'</strong></li>').join('')+'</ul>':'')+
        (cardList?'<ol class="workbench-list">'+cardList+'</ol>':'')+
        '<div class="workbench-actions">'+(decision.status==='pending'?action(decision.category==='schedule'?'승인하고 일정에 반영':cardList?'승인하고 이미지 만들기':'초안 승인','approve',decision.id)+action('반려','decline',decision.id):'')+
        (decision.status==='applied'&&!cardList?action('되돌리기','undo',decision.id)+(!['schedule','cards'].includes(decision.category)?action('초안 복사','copy-draft',decision.id)+(link?action(link,'open-draft',decision.id):'')+(decision.category==='drive'?'<a href="#files">비공개 저장소</a>':''):''):'')+'</div></section>';
    }
    return '<div class="workbench-body workbench-review"'+(decision?' data-detail-open':'')+'><section class="workbench-queue"><div class="workbench-heading"><h2>검토할 제안</h2>'+action(showHistory?'대기 항목':'처리 내역','history')+'</div>'+
      (rows.length?'<ul class="workbench-list">'+rows.map(row=>'<li>'+action(esc(row.title),'review',row.id)+'<small>'+esc(categories[row.category])+' · '+statusText[row.status]+'</small></li>').join('')+'</ul>':'<p class="personal-empty">'+(showHistory?'처리한 제안이 없습니다.':'대기 중인 제안이 없습니다.')+'</p>')+
      '<details><summary>직접 초안 추가</summary><form class="personal-form" data-form="draft"><label>업무 종류<select name="category">'+Object.entries(categories).filter(([id])=>!['schedule','cards'].includes(id)).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></label>'+
      '<label>관련 프로젝트<select name="projectId">'+selectProject()+'</select></label><label>제목<input name="title" maxlength="160" required></label>'+
      '<label>초안<textarea name="text" rows="4" maxlength="4000" required></textarea></label><div><button class="btn primary" type="submit">승인함에 추가</button></div></form></details>'+
      '<details><summary>구독 AI 카드뉴스 가져오기</summary><form class="personal-form" data-form="cards-import">'+
      '<p class="workbench-muted">직접 연결 메뉴가 없어도 AI에서 받은 카드뉴스 답변으로 이미지를 만들 수 있습니다.</p>'+
      '<div>'+action('카드뉴스 요청 예시 복사','copy-card-prompt')+'</div>'+
      '<label>관련 프로젝트<select name="projectId">'+selectProject()+'</select></label>'+
      '<label>AI가 반환한 카드뉴스 JSON<textarea name="text" rows="5" maxlength="18000" required></textarea></label>'+
      '<div><button type="submit" class="btn primary">카드뉴스 검토 요청</button></div></form></details></section>'+details+'</div>';
  }

  const serviceNames={instagram:'Instagram',threads:'Threads',youtube:'YouTube',x:'X'};
  function channelRow(name,state,href,actionLabel,service=''){
    return '<li><div><strong>'+name+'</strong><p>'+state+'</p></div><a class="btn" href="'+href+'"'+(service?' data-connect-service="'+service+'"':'')+' aria-label="'+name+' '+actionLabel+'">'+actionLabel+'</a></li>';
  }

  function channelOverview(){
    if(!channels)return '<p role="status" class="workbench-muted">'+(channelError?'연결 상태를 불러오지 못했습니다.':'연결 상태를 확인하고 있습니다.')+'</p>'+
      (channelError?action('상태 다시 확인','retry-channels'):'');
    const {social,mail,drive}=channels;
    const driveState=!drive?'확인할 수 없음':drive.connected?'계정 연결됨':drive.hasSavedConnection?'다시 연결 필요':drive.configured?'계정 연결 가능':'운영 앱 준비 필요';
    const mailState=!mail?'확인할 수 없음':mail.connected?(mail.paused?'발송 일시정지':'계정 연결됨'):mail.configured?'계정 연결 가능':'운영 앱 준비 필요';
    return '<ul class="workbench-list workbench-channel-list">'+
      channelRow('Google Drive',driveState,'#files',drive?.connected?'저장소 열기':drive?.configured?'연결 화면':'설정 안내')+
      channelRow('Gmail',mailState,'#mail',mail?.connected?'메일 열기':mail?.configured?'연결 화면':'설정 안내')+
      '</ul><h3>SNS</h3><ul class="workbench-list workbench-channel-list">'+
      Object.entries(serviceNames).map(([id,name])=>{
        const channel=social?.find(row=>row.id===id);
        const state=!channel?'확인할 수 없음':channel.connected?channel.connected+'개 연결'+(channel.paused?' · '+channel.paused+'개 일시정지':'')+(channel.stale?' · '+channel.stale+'개 재연결 필요':''):
          channel.stale?'다시 연결 필요':channel.configured?'계정 연결 가능':'운영 앱 준비 필요';
        return channelRow(name,state,'#social',channel?.connected?'계정 보기':channel?.configured?'연결 화면':'설정 안내',id);
      }).join('')+'</ul>';
  }

  function connect(){
    return '<div class="workbench-body workbench-connections"><section class="personal-sheet workbench-connection-panel" aria-labelledby="workbench-channels-title"><h2 id="workbench-channels-title">내 작업 채널</h2><div data-channel-overview>'+channelOverview()+'</div></section><section class="personal-sheet workbench-connection-panel" aria-labelledby="workbench-ai-title"><h2 id="workbench-ai-title">본인 AI 구독 연결</h2><p class="workbench-muted">AI 앱에서 누리원을 한 번 연결하면 같은 대화에서 내 프로젝트와 업무를 조회하고 승인함에 초안을 넣을 수 있습니다. 연결은 최대 30일 동안 유지됩니다.</p>'+
      '<div class="workbench-address"><p>누리원 서버 주소</p><div class="workbench-copy"><code id="workbench-server-address">'+esc(connectionURL())+'</code>'+
      action('주소 복사','copy-url')+'</div></div>'+
      '<ul class="workbench-list workbench-provider-list">'+Object.entries(providers).map(([id,[name,instructions,link]])=>{
        const active=data.connections?.find(c=>c.provider===id&&c.active);
        return '<li><div class="workbench-provider-heading"><strong>'+name+'</strong><span>'+(active?'연결됨':'연결 필요')+'</span></div>'+
          '<p>'+instructions+'</p>'+(active?'<p class="workbench-muted">'+(active.socialRead?'SNS 목록 조회 허용':'SNS 목록 조회는 AI 앱에서 다시 연결')+'</p>':'')+
          '<div class="workbench-actions"><a class="btn" href="'+link+'" target="_blank" rel="noopener noreferrer">'+name+' 열기</a>'+
          (active?action('연결 끊기','disconnect',id):'')+'</div></li>';
      }).join('')+'</ul><p>누리원 AI 비서의 API 연결과 구독 AI로 요청을 보내는 기능도 사용할 수 있습니다.</p></section></div>';
  }
  const renderers={projects,schedule,approvals,connect};
  function render(message=''){
    root.innerHTML='<nav class="workbench-nav" aria-label="업무 작업대 메뉴">'+Object.entries(sections).map(([id,label])=>
      '<button type="button" data-pane="'+id+'"'+(id===pane?' aria-current="page"':'')+'>'+label+'</button>').join('')+
      (data?action('새로고침','refresh'):'')+'</nav><p class="personal-message" data-workbench-status role="status">'+esc(message)+'</p>'+
      (data?renderers[pane]():'<p class="workbench-muted">업무 작업대를 불러오는 중입니다.</p>');
  }
  async function api(input,query=''){
    const signal=controller.signal;
    const response=await fetch('/api/personal/workbench'+query,{signal,cache:'no-store',headers:{'X-Personal-Account':owner,
      ...(input?{'Content-Type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify(input)}:{})});
    signal.throwIfAborted();
    const result=await response.json();
    signal.throwIfAborted();
    if(!response.ok)throw Error(result.error||'작업을 처리하지 못했습니다.');
    return result;
  }
  async function loadChannels(){
    if(checkingChannels||!controller)return;
    const signal=controller.signal;
    checkingChannels=true;
    try{channels=await api(undefined,'?view=channels');channelError=false;}
    catch{if(!signal.aborted){channels=null;channelError=true;}}
    finally{
      if(!signal.aborted){
        checkingChannels=false;
        const panel=root.querySelector('[data-channel-overview]');
        if(panel)panel.innerHTML=channelOverview();
      }
    }
  }
  async function mount(){
    if(!window.NuriPersonalAccount)return;
    if(controller){
      if(data&&pane==='connect')void loadChannels();
      return;
    }
    owner=window.NuriPersonalAccount;
    pane=resume?.owner===owner?resume.pane:'projects';
    resume=null;
    controller=new AbortController();
    const signal=controller.signal;
    if(new URLSearchParams(location.search).get('workbench')==='connect'){
      pane='connect';
      const url=new URL(location.href);
      url.searchParams.delete('workbench');
      history.replaceState(history.state,'',url.href);
    }
    render();
    try{data=await api();render();if(pane==='connect')void loadChannels();}
    catch(error){if(!signal.aborted){controller=null;root.innerHTML='<p role="status">'+esc(error.message)+'</p>'+action('다시 불러오기','retry');}}
  }
  async function mutate(input,message){
    if(running||!data||!controller)return;
    const signal=controller.signal;
    running=true;
    root.setAttribute('aria-busy','true');
    root.querySelectorAll('button').forEach(button=>{button.disabled=true;});
    try {
      const result=await api(input);
      if(result.connections)data=result;
      else if(result.projects){data.projects=result.projects;data.decisions=result.decisions;}
      else if(result.decision){
        const decision=result.decision;
        data.decisions=[decision,...data.decisions.filter(row=>row.id!==decision.id)];
        detailId=decision.id;
        showHistory=decision.status!=='pending';
        pane='approvals';
      }
      if(input.action==='project-remove')projectId=null;
      if(input.action==='project') {
        projectId=input.id??result.projects.at(-1)?.id??null;
      }
      render(message);
      focusCurrent();
      if(result.decision?.category==='schedule'&&['approve','undo'].includes(input.action)){
        window.dispatchEvent(new Event('personal-automation-changed'));
      }
    } catch(error) {
      if(!signal.aborted){status(error.message);root.querySelectorAll('button').forEach(button=>{button.disabled=false;});}
    } finally {
      if(!signal.aborted){running=false;root.removeAttribute('aria-busy');}
    }
  }
  function focusCurrent(){
    const heading=root.querySelector(pane==='approvals'&&detailId?'.workbench-detail h3':'h2');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  function switchPane(next){
    pane=next;render();root.querySelector('[aria-current="page"]').focus({preventScroll:true});
    if(next==='connect')void loadChannels();
  }
  root.addEventListener('click',async event=>{
    const channel=event.target.closest('[data-connect-service]');
    if(channel&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&window.NuriPersonalAutomation?.focusProvider(channel.dataset.connectService)){
      event.preventDefault();return;
    }
    const trigger=event.target.closest('[data-action],[data-pane]');
    if(!trigger||running)return;
    const {action:key,id,pane:next}=trigger.dataset;
    if(key==='retry'){void mount();return;}
    if(!data)return;
    if(next){switchPane(next);return;}
    if(key==='retry-channels'){void loadChannels();return;}
    if(key==='refresh'){
      const signal=controller.signal;
      running=true;
      try{data=await api();render('최신 상태를 불러왔습니다.');if(pane==='connect')void loadChannels();root.querySelector('[data-action="refresh"]').focus({preventScroll:true});}
      catch(error){if(!signal.aborted)status(error.message);}
      finally{if(!signal.aborted)running=false;}
      return;
    }
    const project=data.projects.find(row=>row.id===id),decision=data.decisions.find(row=>row.id===id);
    if(key==='connect-pane'){event.preventDefault();switchPane('connect');return;}
    if(key==='edit'||key==='new'||key==='template'){
      projectId=key==='edit'?id:null;selectedTemplate=key==='template'?id:null;
      render();root.querySelector('input[name="name"]').focus();return;
    }
    if(key==='review'||key==='history'||key==='close-review'){
      detailId=key==='review'?id:null;
      if(key==='history')showHistory=!showHistory;
      render();focusCurrent();
      if(detailId&&window.matchMedia('(max-width:780px)').matches)root.scrollIntoView({block:'start',behavior:'instant'});
      return;
    }
    if(key==='copy-url'||key==='copy-draft'||key==='copy-example'||key==='copy-card-prompt'){
      const value=key==='copy-card-prompt'?'[주제와 독자를 여기에 입력] 카드뉴스를 JSON 한 개로 작성해 줘. 형식은 {"title":"제목","theme":"mint","slides":[{"headline":"첫 장 제목","body":"본문","label":"분류"}]}. 1~8장, 제목 64자, 장별 제목 58자, 본문 180자 이하. 확인되지 않은 사실은 확정해서 쓰지 마.':key==='copy-url'?connectionURL():key==='copy-draft'?decision?.text:templates[id]?.prompt;
      if(!value)return;
      try{await navigator.clipboard.writeText(value);status('복사했습니다.');}
      catch{status('자동 복사가 안 됩니다. 화면에서 직접 복사해 주세요.');}
      return;
    }
    if(key==='open-draft'&&decision?.status==='applied'){
      const {category,title,text}=decision;
      if(category==='mail'||category==='content'){
        window.NuriPersonalAutomation?.reviewApprovedDraft(category==='mail'?'mail':'social',title,text);
      }else window.NuriPersonalWorkspace?.reviewDraft('note',{title,detail:text});
      return;
    }
    if(key==='disconnect')void mutate({action:key,provider:id},'연결을 끊었습니다.');
    if(key==='remove-project'&&project&&window.confirm('이 프로젝트 기억을 삭제할까요?')){
      void mutate({action:'project-remove',id,version:project.version},'기억을 삭제했습니다.');
    }
    if(['approve','decline','undo'].includes(key)) void mutate({action:key,id},key==='approve'?'승인했습니다.':key==='decline'?'반려했습니다.':'되돌렸습니다.');
  });
  root.addEventListener('submit',event=>{
    event.preventDefault();
    const form=event.target;
    const action=form.dataset.form;
    const payload=Object.fromEntries(new FormData(form));
    if(action==='project'&&projectId){
      payload.id=projectId;payload.version=data.projects.find(row=>row.id===projectId)?.version;
    }
    void mutate({action,...payload},action==='project'?'프로젝트 기억을 저장했습니다.':'승인함에 제안을 추가했습니다.');
  });
  window.NuriWorkbench={mount,suspend(){
    if(owner)resume={owner,pane};
    controller?.abort();controller=null;owner=null;data=null;channels=null;checkingChannels=false;channelError=false;pane='projects';projectId=null;detailId=null;selectedTemplate=null;showHistory=false;running=false;
    root.removeAttribute('aria-busy');root.replaceChildren();
  }};
})();
