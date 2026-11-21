'use strict';
(() => {
  const root=document.getElementById('workbench');
  if(!root)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const sections={projects:'프로젝트',weekly:'주간 리뷰',schedule:'일정 재계획',approvals:'승인함',activity:'실행 내역',connect:'연결 관리'};
  const categories={business:'사업 운영',content:'콘텐츠',seller:'판매 준비',mail:'메일',drive:'Drive',schedule:'일정',cards:'카드뉴스'};
  const providers={chatgpt:['ChatGPT','플러그인 → 추가 → 사용자 지정 MCP 서버에서 이 주소를 등록하세요. Business·Enterprise·Edu에서 작성 기능을 지원합니다. Pro는 조회 권한으로 연결할 수 있습니다.','https://chatgpt.com/'],claude:['Claude','커넥터에서 사용자 지정 연결을 추가하고 OAuth 클라이언트는 자동 등록을 선택하세요.','https://claude.ai/'],gemini:['Gemini','사용자 지정 연결은 현재 미국의 개인 Google 계정에서 영어로 지원됩니다. 한국에서는 구독 AI의 요청 복사 기능을 사용하세요.','https://gemini.google.com/']};
  const templates={
    business:{label:'1인 AI 사업자',name:'고객 제안과 주간 운영',rules:'고객이 요청한 범위와 확인되지 않은 가정을 구분한다. 제안서는 목표, 범위, 일정, 검토할 질문 순으로 쓴다. 확인되지 않은 비용이나 성과를 확정 표현으로 쓰지 않는다.',step:'고객 요청 요약 → 제안 초안 → 마감 배치 → 메일 검토',prompt:'프로젝트 기억을 읽고, 내가 제공하는 고객 요청으로 제안서 초안을 작성해 누리원 승인함에 넣어줘. 확정되지 않은 조건에는 확인 필요라고 표시해줘.'},
    content:{label:'콘텐츠 크리에이터',name:'주간 콘텐츠 제작',rules:'독자가 바로 사용할 수 있는 예시를 넣는다. 인용과 이미지의 출처를 확인한다. 채널마다 첫 문장과 길이를 조정하고, 과장 표현을 피한다.',step:'아이디어 → 카드뉴스 원고 → 채널별 문구 → 게시 전 검토',prompt:'프로젝트 기억을 읽고 내가 주는 주제를 바탕으로 카드뉴스 5장은 카드뉴스 도구로, 채널별 문구는 별도의 콘텐츠 초안으로 작성해 누리원 승인함에 넣어줘.'},
    seller:{label:'개인마켓 셀러',name:'상품 출시 준비',rules:'제공받은 상품 사양만 사용한다. 배송, 반품, 가격 등 미정인 조건은 확인 필요로 표시한다. 고객 정보는 초안에 포함하지 않는다.',step:'실제 상품 자료 → 상세페이지 문구 → 고객 질문 → 판매 전 점검',prompt:'프로젝트 기억을 읽고 내가 제공하는 상품 자료로 상세페이지 문구와 고객 질문 답변 초안을 작성해 누리원 승인함에 넣어줘.'},
    personal:{label:'개인 업무',name:'내 일과 자료 정리',rules:'마감이 가까운 일부터 정리한다. 문서는 제목, 정리 위치, 다음 할 일만 간단히 적는다. 가족이나 지인의 정보를 별도 승인 없이 공유하지 않는다.',step:'오늘 할 일 → 집중 시간 → 자료 정리 → 확인',prompt:'오늘 업무와 프로젝트 기억을 읽고, 중요한 일 세 가지와 자료 정리 순서를 제안해서 누리원 승인함에 넣어줘.'},
  };
  let pane='projects', owner=null, controller=null, data=null, projectId=null, detailId=null, selectedTemplate=null, showHistory=false;
  const home=document.getElementById('personal-resume');
  let homeRead=null,activityData=null,profileData=null,projectFilter='';
  let weeklyProject='',weeklyStart='',weeklyData=null,weeklyRead=0;
  let running=false, resume=null, channels=null, checkingChannels=false, channelError=false, channelFilter='all';
  const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
  function today(){return now.format(new Date());}
  function connectionURL(){return location.origin+'/api/one/mcp';}
  function status(message){const el=root.querySelector('[data-workbench-status]');if(el)el.textContent=message;}
  function action(label,key,id=''){return '<button type="button" class="btn" data-action="'+key+'" data-id="'+esc(id)+'">'+label+'</button>';}
  const selectProject=(selected=projectId)=>'<option value="">선택 안 함</option>'+data.projects.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===selected?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  function projects(){
    const project=data.projects.find(p=>p.id===projectId);
    const template=templates[selectedTemplate];
    const related=project?data.decisions.filter(row=>row.projectId===project.id):[];
    const starter=!data.projects.length||!!template;
    const firstRun=starter?'<section class="workbench-narrow"><h2>첫 업무 시작</h2><p>자주 할 일을 선택하면 업무 원칙과 첫 검토 항목을 준비합니다.</p>'+
      '<div class="workbench-actions workbench-starter-options">'+Object.entries(templates).map(([id,value])=>
        '<button type="button" class="btn" data-action="template" data-id="'+id+'" aria-pressed="'+(selectedTemplate===id)+'">'+esc(value.label)+'</button>').join('')+'</div>'+
      (template?'<p>'+esc(template.step)+'</p>'+action('프로젝트와 첫 업무 만들기','start',selectedTemplate)+
        '<details><summary>연결한 AI에 요청하기</summary><p>'+esc(template.prompt)+'</p>'+
        '<div class="workbench-actions">'+action('요청 문장 복사','copy-example',selectedTemplate)+
        '<a class="personal-link" href="#workbench" data-action="connect-pane">AI 연결 확인</a></div></details>':'')+'</section>':'';
    const next=project?'<section class="workbench-narrow"><div class="workbench-heading"><h2>이 프로젝트 이어서 하기</h2>'+
      '<div class="workbench-actions">'+action('프로젝트 AI 대화','project-chat',project.id)+action('프로젝트 승인함','project-queue',project.id)+action('주간 리뷰 열기','project-weekly',project.id)+action('프로젝트 기록','project-records',project.id)+action('할 일 추가','project-task',project.id)+'</div>'+'</div>'+
      (related.length?'<ul class="workbench-list">'+related.slice(0,6).map(row=>'<li>'+action(esc(row.title),'go-review',row.id)+
      '<small>'+decisionLabel(row)+'</small></li>').join('')+'</ul>':'<p class="workbench-muted">이 프로젝트에 연결된 제안이 없습니다.</p>')+
      contentForm(project.id)+'</section>':'';

    return firstRun+next+'<div class="workbench-body'+(starter?' workbench-body-single':'')+'">'+
      '<section><h2>프로젝트 기억</h2><p class="workbench-muted">프로젝트마다 말투, 기준, 확인할 사실을 저장합니다. 연결된 AI는 선택한 프로젝트의 기억을 읽습니다.</p>'+
      '<ul class="workbench-list">'+data.projects.map(p=>'<li>'+action(esc(p.name),'edit',p.id)+'</li>').join('')+'</ul>'+
      '<form data-form="project" class="personal-form"><label>프로젝트 이름<input name="name" maxlength="80" required value="'+esc(project?.name??template?.name)+'"></label>'+
      '<label>AI가 참고할 업무 원칙<textarea name="rules" rows="4" maxlength="1600" required>'+esc(project?.rules??template?.rules)+'</textarea></label>'+
      '<div class="workbench-actions"><button class="btn primary" type="submit">기억 저장</button>'+
      (project?action('새 프로젝트','new')+action('기억 삭제','remove-project',project.id):'')+'</div></form></section>'+
      (!starter?'<section><h2>업무별 시작 가이드</h2><ul class="workbench-list">'+Object.entries(templates).map(([id,entry])=>
        '<li><strong>'+entry.label+'</strong><p>'+entry.step+'</p>'+action('예제로 시작','template',id)+'</li>').join('')+'</ul></section>':'')+'</div>';
  }

  function schedule(){
    return '<section class="workbench-narrow"><h2>빈 시간에 할 일 배치</h2><p class="workbench-muted">선택한 날의 빈 시간에 마감이 가까운 할 일을 30분씩 배치합니다. 날짜가 없는 할 일은 제외합니다. 기존 마감과 일정을 유지하고 제안은 승인함에서 확인합니다.</p>'+
      '<form class="personal-form" data-form="plan"><label>배치할 날짜<input type="date" name="day" min="'+today()+'" value="'+today()+'" required></label>'+
      '<label>관련 프로젝트<select name="projectId">'+selectProject()+'</select></label>'+
      '<div class="workbench-time"><label>시작 시간<input type="time" name="start" value="09:00" required></label><label>끝 시간<input type="time" name="end" value="18:00" required></label></div>'+
      '<label class="workbench-check"><input type="checkbox" name="projectOnly"> 선택한 프로젝트의 할 일만 배치</label>'+
      '<small>한국 시간 기준. 시간이 있는 일정과 예약은 시작부터 30분을 비워 둡니다.</small>'+
      '<div><button class="btn primary" type="submit">일정 제안 만들기</button></div></form><a class="personal-link" href="#schedule">내 일정 보기</a></section>';
  }
  const decisionLabel=row=>({pending:'검토 대기',applied:'승인 완료',declined:'반려',undone:'되돌림'})[row.status]||'';
  function contentForm(id){
    return '<details><summary>콘텐츠 묶음 만들기</summary><form class="personal-form" data-form="content-pack">'+
      '<input type="hidden" name="projectId" value="'+esc(id)+'">'+
      '<label>묶음 제목<input name="title" maxlength="80" required></label><label>주제와 원본 자료<textarea name="topic" rows="3" maxlength="2000" required></textarea></label>'+
      '<label>숏폼 대본<textarea name="short" rows="3" maxlength="4000"></textarea></label><label>블로그 초안<textarea name="blog" rows="3" maxlength="4000"></textarea></label>'+
      '<label>SNS 문구<textarea name="social" rows="3" maxlength="4000"></textarea></label>'+
      '<label>카드뉴스 JSON<textarea name="card" rows="3" maxlength="18000"></textarea></label>'+
      '<div class="workbench-actions"><button class="btn primary" type="submit">초안을 승인함에 추가</button>'+
      action('AI 요청 예시 복사','copy-pack',id)+'</div></form></details>';
  }
  function approvals(){
    const decision=data.decisions.find(item=>item.id===detailId);
    const rows=data.decisions.filter(item=>(!projectFilter||item.projectId===projectFilter)&&(showHistory?item.status!=='pending':item.status==='pending'));
    const statusText={pending:'검토 대기',applied:'승인 완료',declined:'반려',undone:'되돌림'};
    let details='<p class="personal-empty">목록에서 검토할 항목을 고르세요.</p>';
    if(decision) {
      const project=data.projects.find(item=>item.id===decision.projectId);
      const stale=decision.projectId&&(!project||decision.projectVersion&&project.version!==decision.projectVersion);
      const destination={mail:'메일 초안 열기',content:'게시 초안 열기',drive:'정리 메모 열기',business:'업무 메모 열기',seller:'판매 준비 메모 열기'};
      const link=decision.pack&&['blog','short'].includes(decision.pack.format)?null:destination[decision.category];
      const cardList=decision.card?.slides.map((slide,index)=>'<li><small>'+(index+1)+'장</small><strong>'+esc(slide.headline)+'</strong><p>'+esc(slide.body)+'</p>'+
        (decision.status==='applied'&&decision.cardId?'<a class="btn" href="/api/personal/ai/cards/'+esc(decision.cardId)+'?slide='+index+'" target="_blank" rel="noopener">이미지 확인</a>':'')+'</li>').join('');
      details='<section class="workbench-detail">'+action('목록으로','close-review')+'<h3>'+esc(decision.title)+'</h3><p class="workbench-muted">'+esc([statusText[decision.status],decision.source,project?.name].filter(Boolean).join(' · '))+(project&&decision.projectVersion?' (기억 v'+esc(decision.projectVersion)+')':'')+'</p>'+
        '<p>'+esc(decision.text)+'</p>'+
        (decision.pack?'<details><summary>원본 자료와 이 묶음의 다른 초안</summary><p>'+esc(decision.pack.topic)+'</p><ul class="workbench-list">'+
          data.decisions.filter(row=>row.pack?.id===decision.pack.id&&row.id!==decision.id).map(row=>'<li>'+action(esc(row.title),'go-review',row.id)+'</li>').join('')+'</ul></details>':'')+
        (decision.originalText?'<details open><summary>수정 전 초안</summary><p>'+esc(decision.originalText)+'</p></details>':'')+
        (decision.status==='pending'&&!decision.card&&!decision.moves?'<details><summary>초안 수정</summary><form class="personal-form" data-form="revise">'+
          '<label>수정안<textarea name="text" maxlength="4000" rows="4" required>'+esc(decision.text)+'</textarea></label><div><button class="btn" type="submit">수정안 저장</button></div></form></details>':'')+
        (stale?'<p>초안 제안 이후 프로젝트 기억이 바뀌었습니다. 최신 기준과 대조해 주세요.</p>':'')+
        (decision.moves?'<ul class="workbench-list">'+decision.moves.map(move=>'<li><time>'+esc(move.day+' '+move.time)+'</time><strong>'+esc(move.title)+'</strong></li>').join('')+'</ul>':'')+
        (cardList?'<ol class="workbench-list">'+cardList+'</ol>':'')+
        '<div class="workbench-actions">'+(decision.status==='pending'?action(decision.category==='schedule'?'승인하고 일정에 반영':cardList?'승인하고 이미지 만들기':'초안 승인','approve',decision.id)+action('반려','decline',decision.id):'')+
        (decision.status==='applied'&&!cardList?action('되돌리기','undo',decision.id)+(!['schedule','cards'].includes(decision.category)?action('초안 복사','copy-draft',decision.id)+(link?action(link,'open-draft',decision.id):'')+(decision.category==='drive'?'<a href="#files">비공개 저장소</a>':''):''):'')+'</div></section>';
    }
    return '<div class="workbench-body workbench-review"'+(decision?' data-detail-open':'')+'><section class="workbench-queue"><div class="workbench-heading"><h2>검토할 제안</h2>'+action(showHistory?'대기 항목':'처리 내역','history')+'</div>'+
      (projectFilter?'<div class="workbench-actions"><small>'+esc(data.projects.find(row=>row.id===projectFilter)?.name)+'</small>'+action('모든 프로젝트','all-projects')+'</div>':'')+
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
  const channelFilters={all:'전체',attention:'조치 필요',setup:'앱 준비'};

  function channelRow({name,state,href,label,service,recover}){
    const target=service?' data-connect-service="'+service+'"'+(recover?' data-connect-recover':''):'';
    return '<li><div><strong>'+name+'</strong><p>'+state+'</p></div><a class="btn" href="'+href+'"'+target+
      ' aria-label="'+name+' '+label+'">'+label+'</a></li>';
  }

  function storageRow(name,href,channel,readyLabel){
    const connected=channel?.connected, paused=connected&&channel.paused;
    const reconnect=!connected&&channel?.hasSavedConnection;
    const attention=!channel||paused||reconnect;
    const setup=!!channel&&!channel.configured;
    const state=!channel?'상태 확인 실패':paused?'발송 일시정지':connected?'계정 연결됨':
      reconnect?'다시 연결 필요':setup?'운영 앱 준비 필요':'계정 연결 가능';
    const label=!channel?'화면 확인':paused?'일시정지 확인':connected?readyLabel:
      reconnect?'다시 연결':setup?'설정 안내':'연결 화면';
    return {name,href,state,label,attention,setup};
  }

  function socialRow(name,service,channel){
    const recover=!!channel?.stale;
    const attention=!channel||recover||!!channel.paused;
    const setup=!!channel&&!channel.configured;
    const state=!channel?'상태 확인 실패':channel.connected?channel.connected+'개 연결'+(channel.paused?' · '+channel.paused+'개 일시정지':'')+
      (recover?' · '+channel.stale+'개 재연결 필요':''):recover?'다시 연결 필요':setup?'운영 앱 준비 필요':'계정 연결 가능';
    const label=!channel?'화면 확인':recover?'다시 연결':channel.paused?'일시정지 확인':
      channel.connected?'계정 보기':setup?'설정 안내':'연결 화면';
    return {name,state,label,service,recover,attention,setup,href:'#social'};
  }

  function channelOverview(){
    if(!channels)return '<p role="status" class="workbench-muted">'+(channelError?'연결 상태를 불러오지 못했습니다.':'연결 상태를 확인하고 있습니다.')+'</p>'+
      (channelError?action('상태 다시 확인','retry-channels'):'');
    const {social,mail,drive}=channels;
    const work=[storageRow('Google Drive','#files',drive,'저장소 열기'),storageRow('Gmail','#mail',mail,'메일 열기')];
    const sns=Object.entries(serviceNames).map(([id,name])=>socialRow(name,id,social?.find(row=>row.id===id)));
    const counts={all:work.length+sns.length,attention:0,setup:0};
    for(const item of [...work,...sns]){
      if(item.attention)counts.attention++;
      if(item.setup)counts.setup++;
    }
    const show=item=>channelFilter==='all'||item[channelFilter];
    const list=rows=>'<ul class="workbench-list workbench-channel-list">'+rows.map(channelRow).join('')+'</ul>';
    const workRows=work.filter(show),snsRows=sns.filter(show);
    return '<div class="workbench-channel-filters" role="group" aria-label="작업 채널 상태 필터">'+
      Object.entries(channelFilters).map(([id,label])=>'<button type="button" data-channel-filter="'+id+'" aria-pressed="'+
        (channelFilter===id)+'">'+label+' <span>'+counts[id]+'</span></button>').join('')+'</div>'+
      (workRows.length?list(workRows):'')+(snsRows.length?'<h3>SNS</h3>'+list(snsRows):'')+
      (!counts[channelFilter]?'<p class="workbench-muted workbench-channel-empty" role="status">'+
        (channelFilter==='attention'?'다시 연결하거나 확인할 작업 채널이 없습니다.':'앱 설정을 기다리는 작업 채널이 없습니다.')+'</p>':'');
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
  function activity(){
    const labels={review:'확인 필요',scheduled:'예약됨',sent:'발송 완료',published:'게시 완료',sending:'발송 중',publishing:'게시 중',cancelled:'취소'};
    return '<section class="workbench-narrow"><div class="workbench-heading"><h2>최근 게시·발송 내역</h2>'+action('내역 갱신','refresh-activity')+'</div>'+
      (activityData?.error?'<p role="status">실행 내역을 불러오지 못했습니다.</p>':!activityData?'<p>내역을 불러오고 있습니다.</p>':
       activityData.length?'<ul class="workbench-list workbench-activity">'+activityData.map(item=>'<li><div><strong>'+esc(item.title)+'</strong><small>'+
       esc(item.kind==='mail'?'Gmail':serviceNames[item.provider]||'SNS')+' · '+labels[item.status]+'</small>'+
       (item.reason?'<p>'+esc(item.reason)+'</p>':'')+'</div>'+
       action(item.status==='review'?(item.unconfirmed?'결과 확인':'작업 복구'):'작업 보기','open-activity',item.id)+'</li>').join('')+'</ul>':
       '<p class="personal-empty">아직 처리할 게시·발송 내역이 없습니다.</p>')+'</section>';
  }
  function preferences(){
    return '<section class="workbench-narrow"><h2>내 업무 선호</h2>'+
      '<p class="workbench-muted">누리원 AI 비서에 적용됩니다. 외부 구독 AI에서 쓰려면 직접 복사해 요청에 추가하세요.</p>'+
      (!profileData||profileData.error?'<p>'+(!profileData?'선호를 불러오는 중입니다.':'선호를 불러오지 못했습니다.')+'</p>'+
        (profileData?.error?action('다시 불러오기','refresh-profile'):''):
        '<form class="personal-form" data-form="profile"><label>업무 시간·글쓰기 톤·검토 기준<textarea name="instructions" rows="5" maxlength="1200" placeholder="예: 오전에는 집중 업무를 먼저 배치">'+
        esc(profileData.instructions)+'</textarea></label><div class="workbench-actions"><button class="btn primary" type="submit">선호 저장</button>'+
        (profileData.instructions?action('저장한 선호 복사','copy-profile'):'')+'</div></form>')+'</section>';
  }
  const calendarDay=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const currentWeek=()=>{const date=today();return calendarDay(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));};
  const repeatLabels={daily:'매일',weekly:'매주',monthly:'매월'};
  const listReview=(rows,body,empty)=>rows.length?'<ul class="workbench-list">'+rows.map(body).join('')+'</ul>':'<p class="personal-empty">'+empty+'</p>';
  function weekly(){
    const available=data.projects.some(project=>project.id===weeklyProject);
    const header='<section class="workbench-narrow"><h2>프로젝트 주간 리뷰</h2>'+
      '<label class="workbench-week-project">프로젝트<select data-weekly-project>'+selectProject(weeklyProject)+'</select></label>'+
      '<div class="workbench-actions">'+action('이전 주','review-previous')+action('이번 주','review-current')+action('다음 주','review-next')+'</div>'+
      '<p class="workbench-muted">'+esc(weeklyStart+' – '+calendarDay(weeklyStart,6))+' · 한국 시간</p></section>';
    if(!available)return header+'<p>리뷰할 프로젝트를 선택해 주세요.</p>';
    if(!weeklyData)return header+'<p>주간 기록을 불러오고 있습니다.</p>';
    if(weeklyData.error)return header+'<p>'+esc(weeklyData.error)+'</p>'+action('다시 조회','review-refresh');
    const {completed,unfinished,approvals,rules,window:dates}=weeklyData;
    const earliest=dates.nextStart<today()?today():dates.nextStart;
    const canCarry=earliest<=dates.nextEnd;
    const counts='<ul class="workbench-week-counts" aria-label="주간 현황">'+[[completed,'완료'],[unfinished,'미완료'],[approvals,'승인 대기']].map(([rows,label])=>
      '<li><strong>'+rows.length+'</strong><span>'+label+'</span></li>').join('')+'</ul>';
    const done='<section><h3>완료</h3>'+listReview(completed,row=>'<li><strong>'+esc(row.title)+'</strong></li>','이 주에 완료한 일이 없습니다.')+'</section>';
    const pending='<section><h3>승인 대기</h3>'+listReview(approvals,row=>'<li><a class="personal-link" href="?review='+encodeURIComponent(row.id)+'#workbench" data-action="weekly-approval" data-id="'+esc(row.id)+'">'+esc(row.title)+'</a></li>','현재 승인 대기 항목이 없습니다.')+'</section>';
    const carry='<section><h3>미완료</h3><p class="workbench-muted">이 주까지 마감이거나 마감일이 없는 미완료 할 일입니다.</p>'+
      '<form class="personal-form" data-form="carry">'+listReview(unfinished,row=>'<li><label class="workbench-check">'+
        (canCarry?'<input type="checkbox" name="item" value="'+esc(row.id)+'">':'')+'<span>'+esc(row.title)+
        '<small>'+esc(row.dueOn||'마감일 없음')+'</small></span></label></li>','이월할 일이 없습니다.')+
      (unfinished.length&&canCarry?'<label>옮길 날짜<input name="target" type="date" value="'+earliest+'" min="'+earliest+'" max="'+dates.nextEnd+'" required></label>'+
        '<div><button class="btn primary" type="submit">선택한 일 다음 주로 넘기기</button></div>':'')+'</form></section>';
    const repeats='<section class="workbench-repeat"><h3>반복 업무</h3><p class="workbench-muted">프로젝트에 새 할 일을 생성합니다. 매월 같은 날짜가 없으면 그 달의 마지막 날에 생성합니다.</p>'+
      listReview(rules,row=>'<li><div><strong>'+esc(row.title)+'</strong><small>'+repeatLabels[row.frequency]+' · '+
        esc(row.active?'다음 '+row.nextOn:'일시정지')+'</small></div>'+action(row.active?'일시정지':'다시 시작','repeat-state',row.id)+'</li>','등록한 반복 업무가 없습니다.')+
      '<details><summary>반복 업무 추가</summary><form class="personal-form" data-form="repeat-create">'+
      '<label>할 일 이름<input name="title" maxlength="160" required></label><div class="workbench-time">'+
      '<label>주기<select name="frequency"><option value="daily">매일</option><option value="weekly" selected>매주</option><option value="monthly">매월</option></select></label>'+
      '<label>시작 날짜<input name="startOn" type="date" value="'+today()+'" min="'+today()+'" required></label></div>'+
      '<div><button class="btn primary" type="submit">반복 설정 저장</button></div></form></details></section>';
    return header+counts+'<div class="workbench-body workbench-week-details">'+carry+done+pending+repeats+'</div>';
  }
  function setupWeekly(){
    weeklyStart||=currentWeek();
    if(!data.projects.some(row=>row.id===weeklyProject))weeklyProject=data.projects.find(row=>row.id===projectId)?.id??data.projects[0]?.id??'';
  }
  async function weeklyRequest(input){
    const signal=controller.signal;
    const query=input?'':'?'+new URLSearchParams({project:weeklyProject,week:weeklyStart});
    const response=await fetch('/api/personal/project-planning'+query,{
      signal,cache:'no-store',headers:{'X-Personal-Account':owner,...(input?{'Content-Type':'application/json'}:{})},
      ...(input?{method:'POST',body:JSON.stringify(input)}:{}),
    });
    signal.throwIfAborted();
    const result=await response.json();
    signal.throwIfAborted();
    if(!response.ok)throw Error(result.error||'주간 리뷰를 처리하지 못했습니다.');
    return result;
  }
  async function loadWeekly(message=''){
    if(!weeklyProject||!controller||pane!=='weekly')return;
    const ref=++weeklyRead,signal=controller.signal;
    try{
      const result=await weeklyRequest();
      if(ref!==weeklyRead||signal.aborted)return;
      weeklyData=result;
    }catch(error){
      if(ref!==weeklyRead||signal.aborted)return;
      weeklyData={error:error.message};
    }
    if(pane==='weekly'){
      const focused=root.contains(document.activeElement);
      render(message||root.querySelector('[data-workbench-status]')?.textContent||'');
      if(focused)(root.querySelector('[data-weekly-project]')??root.querySelector('[aria-current=page]'))?.focus({preventScroll:true});
    }
  }
  async function writeWeekly(input,message){
    if(running||!controller)return;
    const signal=controller.signal;
    running=true;
    root.setAttribute('aria-busy','true');
    root.querySelectorAll('button,input,select').forEach(control=>{control.disabled=true;});
    try{
      const result=await weeklyRequest({...input,projectId:weeklyProject,week:weeklyStart});
      await loadWeekly(input.action==='repeat-create'&&!result.created?'같은 반복 설정이 이미 있습니다.':message);
      if(input.action==='carry')window.dispatchEvent(new Event('personal-automation-changed'));
    }catch(error){
      if(!signal.aborted){
        status(error.message);
        root.querySelectorAll('button,input,select').forEach(control=>{control.disabled=false;});
      }
    }finally{
      if(!signal.aborted){running=false;root.removeAttribute('aria-busy');}
    }
  }
  const renderers={projects,schedule,approvals,activity,connect,preferences,weekly};

  function render(message=''){
    if(data&&pane==='weekly')setupWeekly();
    if(data)window.NuriPersonalWorkspace?.syncProjects?.(data.projects);
    root.innerHTML='<nav class="workbench-nav" aria-label="업무 작업대 메뉴">'+Object.entries({...sections,preferences:'내 선호'}).map(([id,label])=>
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
  async function loadPane(target,force=false){
    if(!controller)return;
    if(target==='connect'){void loadChannels();return;}
    if(target==='weekly'){if(!weeklyData||force)void loadWeekly();return;}
    if(target!=='activity'&&target!=='preferences')return;
    const signal=controller.signal;
    try{
      if(target==='activity'&&(force||!activityData)){
        activityData=(await api(undefined,'?view=activity')).activity;
      }
      if(target==='preferences'&&(force||!profileData)){
        profileData=await profileRequest();
      }
    }catch{if(signal.aborted)return;if(target==='activity')activityData={error:true};else profileData={error:true};}
    if(!signal.aborted&&pane===target){
      const focus=root.contains(document.activeElement)?document.activeElement.dataset:null;
      if(focus&&document.activeElement.matches('input,textarea,select'))return;
      render();
      if(focus?.pane)root.querySelector('[aria-current="page"]')?.focus({preventScroll:true});
      else if(focus?.action)root.querySelector('[data-action="'+focus.action+'"]')?.focus({preventScroll:true});
    }
  }
  async function profileRequest(input){
    const signal=controller.signal;
    const response=await fetch('/api/personal/ai/profile',{signal,cache:'no-store',headers:{'X-Personal-Account':owner,
      ...(input?{'Content-Type':'application/json'}:{})},...(input?{method:'POST',body:JSON.stringify(input)}:{})});
    const result=await response.json();
    signal.throwIfAborted();
    if(!response.ok)throw Error(result.error||'선호를 저장하지 못했습니다.');
    return result;
  }
  function review(id){
    const row=data.decisions.find(item=>item.id===id);
    if(!row)return false;
    detailId=id;showHistory=row.status!=='pending';pane='approvals';
    return true;
  }
  async function mount(){
    if(!window.NuriPersonalAccount)return;
    const incoming=new URL(location.href);
    const requested=incoming.searchParams.get('workbench'), requestedReview=incoming.searchParams.get('review');
    if(controller){
      if(data&&(requested||requestedReview)){
        acceptRoute(incoming,requested,requestedReview);
        render();focusCurrent();
      }
      if(data)void loadPane(pane,pane!=='preferences');
      return;
    }
    owner=window.NuriPersonalAccount;
    pane=resume?.owner===owner?resume.pane:'projects';
    const previous=resume?.owner===owner?resume:null;
    channelFilter=previous?.channelFilter??'all';
    weeklyProject=previous?.weeklyProject??'';weeklyStart=previous?.weeklyStart??'';
    projectId=previous?.projectId??null;detailId=previous?.detailId??null;
    projectFilter=previous?.projectFilter??'';showHistory=previous?.showHistory??false;
    resume=null;
    controller=new AbortController();
    const signal=controller.signal;
    render();
    try{
      data=await api();
      acceptRoute(incoming,requested,requestedReview);
      render();void loadPane(pane);
      if(requestedReview)focusCurrent();
    }
    catch(error){if(!signal.aborted){controller=null;root.innerHTML='<p role="status">'+esc(error.message)+'</p>'+action('다시 불러오기','retry');}}
  }
  function acceptRoute(url,requested,id){
    if(requested==='connect'||requested==='activity')pane=requested;
    if(id){
      projectFilter='';
      if(!review(id)){pane='approvals';detailId=null;}
    }
    if(requested||id){
      url.searchParams.delete('workbench');url.searchParams.delete('review');
      history.replaceState(history.state,'',url.href);
    }
  }
  async function loadHome(){
    const account=window.NuriPersonalAccount;
    if(!home||!account)return;
    homeRead?.abort();
    const read=new AbortController();
    homeRead=read;
    try{
      const response=await fetch('/api/personal/workbench?view=resume',{signal:read.signal,cache:'no-store',headers:{'X-Personal-Account':account}});
      if(!response.ok)return;
      const {pending,reviews,latest,firstRun}=await response.json();
      if(read.signal.aborted||window.NuriPersonalAccount!==account)return;
      home.hidden=!pending&&!reviews&&!firstRun;
      home.innerHTML='<div class="personal-section-head"><h2>이어서 할 일</h2></div>'+
        (latest.length?'<ul class="workbench-list">'+latest.map(row=>'<li><a class="personal-link" href="?review='+encodeURIComponent(row.id)+'#workbench">'+
           esc(row.title)+'</a>'+(row.project?'<small>'+esc(row.project)+'</small>':'')+'</li>').join('')+'</ul>':'')+
        (reviews?'<a class="personal-link" href="?workbench=activity#workbench">게시·발송 확인 '+reviews+'건</a>':'')+
        (firstRun?'<a class="personal-link" href="#workbench">첫 프로젝트 시작</a>':'');
    }catch{}
  }
  async function mutate(input,message){
    if(running||!data||!controller)return;
    const signal=controller.signal;
    running=true;
    root.setAttribute('aria-busy','true');
    root.querySelectorAll('button').forEach(button=>{button.disabled=true;});
    try {
      const result=input.action==='profile'?{profile:await profileRequest({instructions:input.instructions,version:profileData.version})}:await api(input);
      if(result.profile)profileData=result.profile;
      if(result.decisions&&!result.projects){
        data.decisions=[...result.decisions,...data.decisions];
        projectFilter=projectId;review(result.decisions[0].id);
      }
      if(result.connections)data=result;
      else if(result.projects){data.projects=result.projects;data.decisions=result.decisions;}
      else if(result.decision){
        const decision=result.decision;
        data.decisions=[decision,...data.decisions.filter(row=>row.id!==decision.id)];
        detailId=decision.id;
        showHistory=decision.status!=='pending';
        pane='approvals';
      }
      if(result.projectId){projectId=result.projectId;selectedTemplate=null;}
      if(input.action==='project-remove'){projectId=null;projectFilter='';}
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
    void loadPane(next);
  }
  root.addEventListener('click',async event=>{
    const channel=event.target.closest('[data-connect-service]');
    if(channel&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&window.NuriPersonalAutomation?.focusProvider(channel.dataset.connectService,channel.hasAttribute('data-connect-recover'))){
      event.preventDefault();return;
    }
    const filter=event.target.closest('[data-channel-filter]');
    if(filter&&Object.hasOwn(channelFilters,filter.dataset.channelFilter)){
      channelFilter=filter.dataset.channelFilter;
      const panel=root.querySelector('[data-channel-overview]');
      panel.innerHTML=channelOverview();
      panel.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
      return;
    }
    const trigger=event.target.closest('[data-action],[data-pane]');
    if(!trigger||running)return;
    const {action:key,id,pane:next}=trigger.dataset;
    if(key==='retry'){void mount();return;}
    if(!data)return;
    if(next){switchPane(next);return;}
    if(key==='refresh-activity'||key==='refresh-profile'){void loadPane(pane,true);return;}
    if(key==='open-activity'){
      const item=Array.isArray(activityData)&&activityData.find(row=>row.id===id);
      if(item)window.NuriPersonalAutomation?.focusActivity(item.kind,item.id);
      return;
    }
    if(key==='all-projects'||key==='project-queue'){
      projectFilter=key==='project-queue'?id:'';showHistory=false;detailId=null;switchPane('approvals');return;
    }
    if(key==='go-review'&&review(id)){render();focusCurrent();return;}
    if(key==='start'&&templates[id]){
      const {name,rules,step}=templates[id];
      void mutate({action:'start-project',starter:id,name,rules,firstStep:step},'프로젝트와 첫 업무를 준비했습니다.');
      return;
    }
    if(key==='copy-profile'||key==='copy-pack'){
      const value=key==='copy-profile'?profileData?.instructions:
        '프로젝트 기억을 읽고, 아래 주제와 원본 자료를 바탕으로 숏폼 대본·블로그·SNS 문구를 따로 작성해 줘. 연결된 SNS 목록 조회 권한이 있으면 내 채널에 맞춰 줘. 카드뉴스 초안도 함께 만들고 propose_content_pack 도구로 원본 자료와 모든 초안을 묶어 승인함에 추가해 줘. 도구 연결이 없으면 결과를 각각 복사할 수 있게 제공해 줘.\n주제와 자료: '+(trigger.closest('form')?.elements.topic.value||'[여기에 입력]');
      try{if(value)await navigator.clipboard.writeText(value);status('복사했습니다.');}catch{status('자동 복사가 안 됩니다.');}
      return;
    }
    if(key.startsWith('review-')){
      weeklyStart=key==='review-current'?currentWeek():calendarDay(weeklyStart,key==='review-previous'?-7:key==='review-next'?7:0);
      weeklyData=null;render();void loadWeekly();return;
    }
    if(key==='weekly-approval'){
      if(review(id)){event.preventDefault();render();focusCurrent();}
      return;
    }
    if(key==='repeat-state'){
      const rule=weeklyData?.rules?.find(entry=>entry.id===id);
      if(rule)void writeWeekly({action:key,id,version:rule.version,active:!rule.active},rule.active?'반복 업무를 일시정지했습니다.':'반복 업무를 다시 시작했습니다.');
      return;
    }
    if(key==='retry-channels'){void loadChannels();return;}
    if(key==='refresh'){
      const signal=controller.signal;
      running=true;
      try{data=await api();render('최신 상태를 불러왔습니다.');void loadPane(pane,true);root.querySelector('[data-action="refresh"]').focus({preventScroll:true});}
      catch(error){if(!signal.aborted)status(error.message);}
      finally{if(!signal.aborted)running=false;}
      return;
    }
    const project=data.projects.find(row=>row.id===id),decision=data.decisions.find(row=>row.id===id);
    if(key==='project-weekly'&&project){weeklyProject=project.id;weeklyData=null;switchPane('weekly');return;}
    if(key==='project-records'&&project){window.NuriPersonalWorkspace?.openProjectRecords?.(project.id);return;}
    if(key==='project-task'&&project){window.NuriPersonalWorkspace?.reviewDraft?.('task',{projectId:project.id});return;}
    if(key==='project-chat'&&project){window.NuriPersonalAI?.openProject(project.id,project.name);return;}
    if(key==='connect-pane'){event.preventDefault();switchPane('connect');return;}
    if(key==='edit'||key==='new'||key==='template'){
      projectId=key==='edit'?id:null;selectedTemplate=key==='template'?id:null;
      render();
      (key==='template'?root.querySelector('[data-action="start"]'):root.querySelector('input[name="name"]'))?.focus();return;
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
      }else window.NuriPersonalWorkspace?.reviewDraft('note',{title,detail:text,projectId:decision.projectId});
      return;
    }
    if(key==='disconnect')void mutate({action:key,provider:id},'연결을 끊었습니다.');
    if(key==='remove-project'&&project&&window.confirm('이 프로젝트 기억을 삭제할까요?')){
      void mutate({action:'project-remove',id,version:project.version},'기억을 삭제했습니다.');
    }
    if(['approve','decline','undo'].includes(key)) void mutate({action:key,id,revision:decision?.revision??1},key==='approve'?'승인했습니다.':key==='decline'?'반려했습니다.':'되돌렸습니다.');
  });
  home?.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if(!link||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const url=new URL(link.href);
    if(url.pathname!==location.pathname||url.hash!=='#workbench')return;
    event.preventDefault();
    const current=new URL(location.href);
    current.search=url.search;
    history.replaceState(history.state,'',current.href);
    if(location.hash==='#workbench')void mount();else location.hash='workbench';
  });
  root.addEventListener('change',event=>{
    if(!event.target.matches('[data-weekly-project]')||running)return;
    weeklyProject=event.target.value;weeklyData=null;weeklyRead++;
    render();root.querySelector('[data-weekly-project]')?.focus({preventScroll:true});
    void loadWeekly();
  });
  root.addEventListener('submit',event=>{
    event.preventDefault();
    const form=event.target;
    const action=form.dataset.form;
    const fields=new FormData(form);
    const payload=Object.fromEntries(fields);
    if(action==='carry'){
      const picked=new Set(fields.getAll('item'));
      const items=weeklyData.unfinished.filter(row=>picked.has(row.id)).map(({id,version})=>({id,version}));
      if(!items.length){status('옮길 일을 선택해 주세요.');return;}
      void writeWeekly({action,target:payload.target,items},items.length+'건을 다음 주로 옮겼습니다.');return;
    }
    if(action==='repeat-create'){
      void writeWeekly({action,...payload},'반복 설정을 저장했습니다.');return;
    }
    if(action==='project'&&projectId){
      payload.id=projectId;payload.version=data.projects.find(row=>row.id===projectId)?.version;
    }
    if(action==='plan')payload.projectOnly=form.elements.projectOnly.checked;
    if(action==='revise'){payload.id=detailId;payload.revision=data.decisions.find(row=>row.id===detailId)?.revision??1;}
    if(action==='content-pack'&&payload.card){
      try{payload.card=JSON.parse(payload.card);if(!payload.card||typeof payload.card!=='object'||Array.isArray(payload.card))throw Error();}catch{status('카드뉴스 JSON 형식을 확인해 주세요.');return;}
    }
    void mutate({action,...payload},action==='profile'?'업무 선호를 저장했습니다.':action==='revise'?'수정안을 저장했습니다.':action==='project'?'프로젝트 기억을 저장했습니다.':'승인함에 제안을 추가했습니다.');
  });
  window.NuriWorkbench={mount,loadHome,suspend(){
    homeRead?.abort();homeRead=null;
    if(home){home.hidden=true;home.replaceChildren();}
    activityData=null;profileData=null;projectFilter='';
    if(owner)resume={owner,pane,channelFilter,projectId,detailId,projectFilter,showHistory,weeklyProject,weeklyStart};
    weeklyRead++;weeklyData=null;weeklyProject='';weeklyStart='';
    controller?.abort();controller=null;owner=null;data=null;channels=null;checkingChannels=false;channelError=false;channelFilter='all';pane='projects';projectId=null;detailId=null;selectedTemplate=null;showHistory=false;running=false;
    root.removeAttribute('aria-busy');root.replaceChildren();
  }};
})();
