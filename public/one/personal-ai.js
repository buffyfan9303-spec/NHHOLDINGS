'use strict';

(() => {
  const apiPath='/api/personal/ai/';
  const providerLabels={openai:'GPT',anthropic:'Claude',gemini:'Gemini'};
  const modes={chat:'대화',brief:'업무 요약',task:'할 일 추가',schedule:'일정 추가',note:'메모 작성',social:'SNS 초안',mail:'메일 초안',cards:'카드뉴스'};
  const socialProviders={instagram:'Instagram',threads:'Threads',youtube:'YouTube',x:'X'};
  const destinations={task:['할 일 열기','#tasks'],schedule:['일정 열기','#schedule'],note:['메모 열기','#notes'],social:['SNS 초안 열기','#social'],mail:['메일 초안 열기','#mail']};
  const formatTime=new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
  const media=window.matchMedia('(min-width:1200px)');
  let active=null;
  let resumeOwner=null;
  const current=view=>active===view&&view.root.isConnected&&window.NuriPersonalAccount===view.owner;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const selectOptions=entries=>Object.entries(entries).map(([key,label])=>'<option value="'+key+'">'+escape(label)+'</option>').join('');
  const node=(tag,css,text)=>{const el=document.createElement(tag);if(css)el.className=css;if(text)el.textContent=text;return el;};

  function layout(){
    return `<dialog id="personal-ai-dock" class="personal-ai-dock" aria-labelledby="personal-ai-title">
      <header class="personal-ai-top">
        <h2 id="personal-ai-title">AI 도우미</h2>
        <div class="personal-ai-actions">
          <button type="button" class="personal-action" data-ai-action="settings" aria-expanded="false" aria-controls="personal-ai-settings">제공자 설정</button>
          <button type="button" class="personal-action" data-ai-action="close" aria-label="AI 도우미 닫기">닫기</button>
        </div>
      </header>
      <section id="personal-ai-settings" class="personal-ai-settings" aria-label="AI 제공자 설정" hidden>
        <form class="personal-form" data-ai-settings>
          <label>제공자<select name="provider">${selectOptions(providerLabels)}</select></label>
          <label>모델 ID<input name="model" required maxlength="120" spellcheck="false" autocomplete="off"></label>
          <label>API 키<input name="apiKey" type="password" minlength="6" maxlength="2000" autocomplete="new-password" spellcheck="false"></label>
          <div class="personal-ai-actions">
            <button type="submit" class="btn" data-ai-config-save>설정 저장</button>
            <button type="button" class="personal-action" data-ai-action="verify" hidden>저장된 모델 확인</button>
            <button type="button" class="personal-action" data-ai-action="remove">키 삭제</button>
          </div>
        </form>
      </section>
      <p class="personal-ai-status" role="status" data-ai-status></p>
      <section class="personal-ai-history" aria-label="나의 AI 대화" tabindex="0" data-ai-history></section>
      <form class="personal-form personal-ai-compose" data-ai-compose>
        <div class="personal-ai-options">
          <label>응답 모델<select name="provider" required></select></label>
          <label>작업<select name="mode">${selectOptions(modes)}</select></label>
        </div>
        <label data-ai-social-field hidden>SNS 채널<select name="socialProvider">${selectOptions(socialProviders)}</select></label>
        <p class="personal-ai-mode-note" data-ai-mode-note hidden></p>
        <label>요청<textarea name="prompt" rows="3" maxlength="6000" required placeholder="할 일이나 정리할 내용을 입력하세요."></textarea></label>
        <div class="personal-ai-actions">
          <button type="submit" class="btn primary" data-ai-send>보내기</button>
          <button type="button" class="btn" data-ai-action="stop" hidden>응답 중지</button>
        </div>
      </form>
    </dialog>`;
  }

  function status(view,text,error=false){
    view.status.textContent=text;
    view.status.classList.toggle('is-error',error);
  }

  function options(method,owner,body,signal){
    return {method,cache:'no-store',signal,headers:{'X-Personal-Account':owner,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})};
  }

  function serverError(data){
    const message=data?.message||data?.error;
    return typeof message==='string'&&message.length<=320?message:'AI 요청을 완료하지 못했습니다.';
  }

  async function json(view,path,body,signal){
    const r=await fetch(apiPath+path,options(body?'POST':'GET',view.owner,body,signal));
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data)throw Object.assign(Error(serverError(data)),{status:r.status});
    return data;
  }

  function modeChanged(view){
    const mode=view.compose.elements.mode.value;
    const social=view.dock.querySelector('[data-ai-social-field]');
    social.hidden=mode!=='social';
    social.querySelector('select').disabled=social.hidden;
    const note=view.dock.querySelector('[data-ai-mode-note]');
    note.textContent=mode==='mail'?'받는 사람 이메일 주소 한 개와 메일 목적을 입력하세요.':mode==='social'?(
      view.compose.elements.socialProvider.value==='youtube'?'작성한 YouTube 원고를 메모에서 확인할 수 있어요.':'초안은 내 SNS에서 검토하고 예약할 수 있어요.'
    ):'';
    note.hidden=!note.textContent;
  }

  function providerState(view){
    const provider=view.setup.elements.provider.value;
    const data=view.providers.find(p=>p.id===provider);
    view.setup.elements.model.value=data?.model||'';
    const key=view.setup.elements.apiKey;
    key.value='';
    key.required=!data?.configured;
    key.placeholder=data?.configured?'새 키로 바꿀 때만 입력':'';
    view.dock.querySelector('[data-ai-action="verify"]').hidden=!data?.configured;
    view.dock.querySelector('[data-ai-action="remove"]').hidden=!data?.configured;
  }

  function setControls(view){
    const usable=view.providers.some(p=>p.configured);
    const waiting=!!view.stream;
    const composing=view.loading||view.configuring||waiting||!usable;
    view.dock.querySelector('[data-ai-send]').disabled=composing;
    view.dock.querySelector('[data-ai-action="stop"]').hidden=!waiting;
    view.compose.elements.prompt.disabled=composing;
    view.compose.elements.provider.disabled=composing;
    view.compose.elements.mode.disabled=composing;
    view.compose.elements.socialProvider.disabled=composing||view.compose.elements.mode.value!=='social';
    const configuring=view.loading||view.configuring||waiting;
    for(const field of view.setup.elements)field.disabled=configuring;
  }

  function updateProviders(view,result){
    const selection=view.compose.elements.provider.value;
    view.providers=(Array.isArray(result.providers)?result.providers:[]).filter(p=>Object.hasOwn(providerLabels,p.id));
    const configured=view.providers.filter(p=>p.configured);
    view.compose.elements.provider.replaceChildren();
    if(!configured.length)view.compose.elements.provider.add(new Option('등록한 모델 없음',''));
    for(const provider of configured){
      const label=providerLabels[provider.id]+(provider.model?' · '+provider.model:'');
      view.compose.elements.provider.add(new Option(label,provider.id));
    }
    if(configured.some(p=>p.id===selection))view.compose.elements.provider.value=selection;
    providerState(view);
    if(!configured.length)setSettings(view,true);
    setControls(view);
  }

  function cardURL(id,slide,download=false){
    return apiPath+'cards/'+encodeURIComponent(id)+'?slide='+slide+(download?'&download=1':'');
  }

  function cardReceipt(action){
    const count=Array.isArray(action.slides)?action.slides.length:action.slides;
    if(!Number.isInteger(count)||count<1||count>20||!/^[A-Za-z0-9_-]{1,80}$/.test(action.id||''))return null;
    const card=node('div','personal-ai-card');
    card.dataset.aiCardId=action.id;
    card.dataset.aiCount=count;
    card.dataset.aiPage='0';
    const title=node('strong','',action.title||'카드뉴스');
    const image=node('img','personal-ai-card-image');
    image.alt=(action.title||'카드뉴스')+' 1번';
    image.loading='lazy';
    image.referrerPolicy='no-referrer';
    image.src=cardURL(action.id,0);
    const bar=node('div','personal-ai-actions');
    for(const [dir,label] of [['prev','이전 장'],['next','다음 장']]){
      const button=node('button','personal-action',label);
      button.type='button';
      button.dataset.aiAction=dir;
      button.disabled=dir==='prev'||count===1;
      bar.append(button);
    }
    const countLabel=node('span','personal-ai-card-count','1 / '+count);
    const open=node('a','personal-link','크게 보기');
    open.href=cardURL(action.id,0);
    open.target='_blank';
    open.rel='noopener noreferrer';
    open.dataset.aiCardOpen='';
    const download=node('a','personal-link','PNG 저장');
    download.href=cardURL(action.id,0,true);
    download.download='';
    download.dataset.aiCardDownload='';
    bar.append(countLabel,open,download);
    if(typeof window.NuriPersonalAutomation?.selectSocialCard==='function'){
      const use=node('button','personal-action','카드뉴스를 SNS에 첨부');
      use.type='button';
      use.dataset.aiAction='attach';
      bar.append(use);
    }
    card.append(title,image,bar);
    return card;
  }

  function receipt(action){
    if(!action)return null;
    if(action.kind==='cards')return cardReceipt(action);
    if(!Object.hasOwn(destinations,action.kind))return null;
    const [label,path]=destinations[action.kind];
    const wrap=node('div','personal-ai-receipt');
    wrap.append(node('strong','',action.title||label));
    const link=node('a','personal-link',label);
    link.href=path;
    link.dataset.aiGo='';
    wrap.append(link);
    return wrap;
  }

  function turn(message,pending=false){
    const entry=node('li','personal-ai-turn');
    const person=node('div','personal-ai-question');
    person.append(node('strong','', '나'),node('p','',message.prompt));
    const answer=node('div','personal-ai-answer');
    const label=node('strong','',providerLabels[message.provider]||'AI');
    const text=node('p','',message.response||'');
    if(pending)text.dataset.aiLive='';
    answer.append(label,text);
    const result=receipt(message.action);
    if(result)answer.append(result);
    const time=Date.parse(message.createdAt);
    if(Number.isFinite(time)){
      const timestamp=node('time','personal-ai-time',formatTime.format(time)+' KST');
      timestamp.dateTime=new Date(time).toISOString();
      answer.append(timestamp);
    }
    entry.append(person,answer);
    return entry;
  }

  function scrollHistory(view){
    view.history.scrollTop=view.history.scrollHeight;
  }

  function paintHistory(view,scroll=false){
    const list=node('ol','personal-ai-turns');
    for(const message of view.messages)list.append(turn(message));
    if(view.pending)list.append(turn(view.pending,true));
    view.history.replaceChildren(list);
    if(!list.children.length)view.history.append(node('p','personal-empty','첫 요청을 보내면 답변이 여기에 표시됩니다.'));
    if(scroll)scrollHistory(view);
  }

  function setSettings(view,open){
    const settings=view.dock.querySelector('#personal-ai-settings');
    settings.hidden=!open;
    view.dock.querySelector('[data-ai-action="settings"]').setAttribute('aria-expanded',String(open));
  }

  async function hydrate(view){
    if(view.loading||!current(view))return;
    view.loading=true;
    const check=new AbortController();
    view.loadingCheck=check;
    status(view,'내 모델과 대화를 불러오고 있습니다.');
    setControls(view);
    const [providers,messages]=await Promise.allSettled([
      json(view,'providers',undefined,check.signal),json(view,'chat',undefined,check.signal),
    ]);
    if(!current(view)||view.loadingCheck!==check)return;
    view.loadingCheck=null;
    view.loading=false;
    if(providers.status==='fulfilled')updateProviders(view,providers.value);
    if(messages.status==='fulfilled'){
      view.messages=Array.isArray(messages.value.messages)?[...messages.value.messages].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)):[];
      paintHistory(view,true);
    }
    view.ready=providers.status==='fulfilled'&&messages.status==='fulfilled';
    status(view,view.ready?'':'모델 또는 대화 기록을 불러오지 못했습니다. 패널을 다시 열어 주세요.',!view.ready);
    setControls(view);
    if(view.dock.open&&document.visibilityState==='visible'){
      if(!view.providers.some(provider=>provider.configured))view.setup.elements.provider.focus({preventScroll:true});
      else if(view.dock.contains(document.activeElement)&&document.activeElement.matches('[data-ai-action="settings"]'))view.compose.elements.prompt.focus({preventScroll:true});
    }
  }

  function parseFrame(frame){
    let type='message';
    const chunks=[];
    for(const line of frame.split('\n')){
      if(line.startsWith('event:'))type=line.slice(6).trim();
      if(line.startsWith('data:'))chunks.push(line.slice(5).trimStart());
    }
    if(!chunks.length)return null;
    let data;
    try{data=JSON.parse(chunks.join('\n'));}catch{return null;}
    return {type,data};
  }

  async function readStream(response,callback){
    const reader=response.body?.getReader();
    if(!reader)throw Error('실시간 응답을 열지 못했습니다.');
    const decode=new TextDecoder();
    let buffer='';
    try {
      for(;;){
        const read=await reader.read();
        buffer=(buffer+decode.decode(read.value,{stream:!read.done})).replace(/\r\n/g,'\n');
        let boundary;
        while((boundary=buffer.indexOf('\n\n'))!==-1){
          const frame=parseFrame(buffer.slice(0,boundary));
          buffer=buffer.slice(boundary+2);
          if(frame&&callback(frame))return true;
        }
        if(read.done){
          const frame=parseFrame(buffer);
          return !!frame&&callback(frame);
        }
        if(buffer.length>450000)throw Error('실시간 응답 형식을 확인하지 못했습니다.');
      }
    } finally {await reader.cancel().catch(()=>{});}
  }

  async function send(view,event){
    event.preventDefault();
    if(!current(view)||view.stream||view.loading||view.configuring)return;
    const values=Object.fromEntries(new FormData(view.compose)),prompt=values.prompt?.trim()||'';
    if(!prompt||!view.providers.some(provider=>provider.id===values.provider&&provider.configured))return;
    const mode=Object.hasOwn(modes,values.mode)?values.mode:'chat';
    const request={provider:values.provider,prompt,mode,...(mode==='social'?{socialProvider:values.socialProvider}:{})};
    const check=new AbortController();
    view.stream=check;
    view.pending={provider:values.provider,prompt,response:''};
    status(view,'답변을 받고 있습니다.');
    paintHistory(view,true);
    setControls(view);
    try {
      const response=await fetch(apiPath+'chat',options('POST',view.owner,request,check.signal));
      if(!response.ok){
        const data=await response.json().catch(()=>null);
        throw Error(serverError(data));
      }
      if(!response.headers.get('Content-Type')?.startsWith('text/event-stream'))throw Error('실시간 응답 형식을 확인하지 못했습니다.');
      const complete=await readStream(response,({type,data})=>{
        if(!current(view)||view.stream!==check)return true;
        if(type==='error')throw Error(serverError(data));
        if(type==='delta'&&typeof data?.text==='string'){
          const nearEnd=view.history.scrollHeight-view.history.scrollTop-view.history.clientHeight<64;
          view.pending.response+=data.text;
          const live=view.history.querySelector('[data-ai-live]');
          if(live)live.textContent=view.pending.response;
          if(nearEnd)scrollHistory(view);
          return false;
        }
        if(type==='done'&&data?.message?.id){
          view.messages=[...view.messages.filter(message=>message.id!==data.message.id),data.message];
          view.compose.elements.prompt.value='';
          status(view,data.message.action?'작업 결과를 저장했습니다.':'답변을 받았습니다.');
          if(data.message.action)window.dispatchEvent(new CustomEvent('personal-automation-changed',{detail:{kind:data.message.action.kind}}));
          return true;
        }
        return false;
      });
      if(!complete)throw Error('응답이 중간에 끊겼습니다. 요청을 다시 확인해 주세요.');
    } catch(error){
      if(current(view)&&view.stream===check)status(view,check.signal.aborted?'응답 읽기를 중지했습니다.':error.message,!check.signal.aborted);
    } finally {
      if(current(view)&&view.stream===check){
        view.stream=null;
        view.pending=null;
        paintHistory(view,true);
        setControls(view);
        if(view.dock.open&&view.dock.contains(document.activeElement)&&view.compose.contains(document.activeElement)){
          view.compose.elements.prompt.focus({preventScroll:true});
        }
      }
    }
  }

  async function changeProvider(view,action='save'){
    if(!current(view)||view.loading||view.configuring||view.stream)return;
    const values=Object.fromEntries(new FormData(view.setup));
    if(action==='remove'&&!confirm('이 제공자의 저장된 API 키를 삭제할까요?'))return;
    const body={action,provider:values.provider,...(action==='save'?{model:values.model.trim(),
      ...(values.apiKey?{apiKey:values.apiKey}:{})}:{})};
    if(action!=='verify')view.setup.elements.apiKey.value='';
    const check=new AbortController();
    view.configCheck=check;
    view.configuring=true;
    setControls(view);
    if(action==='verify')status(view,'저장된 모델을 확인하고 있습니다.');
    try {
      const result=await json(view,'providers',body,check.signal);
      if(!current(view)||view.configCheck!==check)return;
      if(action==='verify'){
        status(view,(result.model||'저장된 모델')+' 조회에 성공했습니다. 답변은 채팅에서 확인할 수 있습니다.');
      }else{
        updateProviders(view,result);
        if(action==='save')view.compose.elements.provider.value=values.provider;
        status(view,action==='remove'?'저장된 키를 삭제했습니다.':'모델 설정을 저장했습니다.');
      }
    }catch(error){
      if(current(view)&&view.configCheck===check)status(view,error.message,true);
    }finally{
      if(current(view)&&view.configCheck===check){
        view.configuring=false;
        view.configCheck=null;
        setControls(view);
      }
    }
  }

  function pageCard(button,dir){
    const card=button.closest('[data-ai-card-id]');
    if(!card)return;
    const count=Number(card.dataset.aiCount),page=Number(card.dataset.aiPage)+dir;
    if(page<0||page>=count)return;
    const {aiCardId:id}=card.dataset;
    card.dataset.aiPage=page;
    const image=card.querySelector('img');
    image.src=cardURL(id,page);
    image.alt=(card.querySelector('strong').textContent||'카드뉴스')+' '+(page+1)+'번';
    card.querySelector('.personal-ai-card-count').textContent=(page+1)+' / '+count;
    card.querySelector('[data-ai-card-open]').href=cardURL(id,page);
    card.querySelector('[data-ai-card-download]').href=cardURL(id,page,true);
    const prev=card.querySelector('[data-ai-action="prev"]'),next=card.querySelector('[data-ai-action="next"]');
    prev.disabled=page===0;
    next.disabled=page===count-1;
    if(button.disabled)(dir<0?next:prev).focus({preventScroll:true});
  }

  function show(view,focus=false){
    view.root.classList.add('is-open');
    const modal=!media.matches;
    if(view.dock.open&&view.dock.matches(':modal')!==modal)view.dock.close();
    if(!view.dock.open){
      if(modal)view.dock.showModal();
      else view.dock.show();
    }
    view.toggle.setAttribute('aria-expanded','true');
    if(focus)view.dock.querySelector('[data-ai-action="settings"]').focus({preventScroll:true});
    if(!view.ready)void hydrate(view);
  }

  function hide(view,restore=false){
    view.root.classList.remove('is-open');
    if(view.dock.open)view.dock.close();
    view.toggle.setAttribute('aria-expanded','false');
    if(restore&&view.toggle.isConnected&&!view.toggle.disabled)view.toggle.focus({preventScroll:true});
  }

  function bind(view){
    view.toggle.onclick=()=>{if(current(view)){if(view.dock.open)hide(view,true);else show(view,true);}};
    view.dock.addEventListener('cancel',event=>{event.preventDefault();hide(view,true);});
    view.dock.addEventListener('click',event=>{
      if(event.target.closest('[data-ai-go]')){hide(view);return;}
      const control=event.target.closest('[data-ai-action]');
      if(!control||!current(view))return;
      const action=control.dataset.aiAction;
      if(action==='close')hide(view,true);
      else if(action==='settings'){
        const open=view.dock.querySelector('#personal-ai-settings').hidden;
        setSettings(view,open);
        if(open)view.setup.elements.provider.focus();
        else view.setup.elements.apiKey.value='';
      }
      else if(action==='stop')view.stream?.abort();
      else if(action==='remove'||action==='verify')void changeProvider(view,action);
      else if(action==='prev'||action==='next')pageCard(control,action==='prev'?-1:1);
      else if(action==='attach'){
        const card=control.closest('[data-ai-card-id]');
        if(card){hide(view);window.NuriPersonalAutomation?.selectSocialCard?.(card.dataset.aiCardId,Number(card.dataset.aiPage));}
      }
    });
    view.compose.addEventListener('submit',event=>void send(view,event));
    view.compose.addEventListener('change',event=>{if(['mode','socialProvider'].includes(event.target.name))modeChanged(view);});
    view.compose.elements.prompt.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();view.compose.requestSubmit();}
    });
    view.setup.addEventListener('submit',event=>{event.preventDefault();void changeProvider(view);});
    view.setup.elements.provider.addEventListener('change',()=>providerState(view));
  }

  function dispose(view){
    view.loadingCheck?.abort();
    view.configCheck?.abort();
    view.stream?.abort();
    view.toggle.disabled=true;
    hide(view);
    view.root.replaceChildren();
    active=null;
  }

  function mount(){
    const owner=window.NuriPersonalAccount,root=document.getElementById('personal-ai-root'),toggle=document.getElementById('personal-ai-open');
    if(!owner||!root||!toggle)return;
    if(active?.owner===owner&&active.root===root)return;
    if(active){
      dispose(active);
      resumeOwner=null;
    }
    root.innerHTML=layout();
    const dock=root.querySelector('dialog');
    const view={owner,root,toggle,dock,compose:dock.querySelector('[data-ai-compose]'),setup:dock.querySelector('[data-ai-settings]'),
      status:dock.querySelector('[data-ai-status]'),history:dock.querySelector('[data-ai-history]'),providers:[],messages:[]};
    active=view;
    toggle.disabled=false;
    toggle.hidden=false;
    toggle.setAttribute('aria-controls',dock.id);
    toggle.setAttribute('aria-haspopup','dialog');
    toggle.setAttribute('aria-expanded','false');
    bind(view);
    modeChanged(view);
    setControls(view);
    if(resumeOwner===owner)show(view);
    resumeOwner=null;
  }

  function suspend(){
    if(!active)return;
    resumeOwner=active.dock.open?active.owner:null;
    dispose(active);
  }

  media.addEventListener('change',()=>{if(active?.dock.open&&current(active))show(active);});
  window.NuriPersonalAI={mount,suspend};
})();
