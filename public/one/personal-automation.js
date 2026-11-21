'use strict';

(() => {
  const rootIds={social:'personal-social-root',mail:'personal-mail-root'};
  const titles={social:'게시 목록',mail:'메일 목록'};
  const statusText={draft:'초안',scheduled:'예약됨',publishing:'게시 중',published:'게시 완료',sending:'발송 중',sent:'발송 완료',review:'확인 필요',cancelled:'예약 취소'};
  const providerNames={instagram:'Instagram',threads:'Threads',youtube:'YouTube',x:'X',mail:'Gmail'};
  const oauthPaths={
    instagram:'https://www.instagram.com/oauth/authorize',
    threads:'https://threads.com/oauth/authorize',
    x:'https://x.com/i/oauth2/authorize',
    youtube:'https://accounts.google.com/o/oauth2/v2/auth',
    mail:'https://accounts.google.com/o/oauth2/v2/auth',
  };
  const formatter=new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'});
  const views=new Map();
  const cardIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const imageProviders=['instagram','threads'];
  let socialCard=null, approvedDraft=null;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const safeLink=value=>{
    try {
      const url=new URL(value);
      return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url.href:'';
    } catch {return '';}
  };
  const option=(value,title,chosen)=>'<option value="'+escape(value)+'"'+(chosen===value?' selected':'')+'>'+escape(title)+'</option>';
  const actionButton=(label,action,id='',primary=false)=>'<button type="button" class="btn'+(primary?' primary':'')+
    '" data-auto-action="'+action+'" data-id="'+escape(id)+'">'+label+'</button>';
  const current=view=>view.root.isConnected&&views.get(view.kind)===view&&window.NuriPersonalAccount===view.owner;
  const editAllowed=(view,item)=>['draft','cancelled'].includes(item?.status)||
    view.kind==='social'&&(item?.status==='scheduled'||item?.status==='review'&&item.uncertain===false);
  const futureStamp=(day,time)=>{
    const value = day+'T'+time;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('예약 날짜와 시간을 확인해 주세요.');
    const stamp=Date.parse(value+'+09:00');
    if(!Number.isFinite(stamp)||new Date(stamp+32400000).toISOString().slice(0,16)!==value||stamp<=Date.now()){
      throw Error('한국 시간으로 미래의 예약 날짜와 시간을 선택해 주세요.');
    }
    return new Date(stamp).toISOString();
  };

  async function request(view,body,signal) {
    const headers={'X-Personal-Account':view.owner};
    const response=await fetch('/api/personal/'+view.kind,{
      cache:'no-store',signal,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result) {
      const message=typeof result?.error==='string'&&result.error.length<=300?result.error:'요청을 처리하지 못했습니다. 다시 시도해 주세요.';
      throw Object.assign(Error(message),{status:response.status,code:result?.code});
    }
    return result;
  }

  function layout(view) {
    const {kind}=view;
    const prefix='personal-auto-'+kind;
    return `<section class="personal-automation" aria-label="${kind==='social'?'SNS 게시 작업':'Gmail 작업'}">
      <div class="personal-sheet auto-work">
        <header class="personal-section-head">
          <h2 id="${prefix}-list-title">${titles[kind]}</h2>
          <div class="auto-actions" data-auto-toolbar>
            ${actionButton('새 초안','new','',true)}${actionButton('다시 조회','refresh')}
          </div>
        </header>
        <div class="auto-first-connect" data-auto-first-connect hidden>
          <p>${kind==='social'?'계정을 연결하면 게시 초안을 만들고 예약할 수 있습니다.':'Gmail을 연결하면 작성한 초안을 발송 예약할 수 있습니다.'}</p>
          ${actionButton('계정 연결로 이동','setup-jump','',kind==='social')}
        </div>
        <p class="auto-message" data-auto-message role="status">목록을 불러오고 있습니다.</p>
        ${kind==='social'?'<div data-auto-filter></div>':''}
        <div data-auto-items aria-labelledby="${prefix}-list-title"></div>
      </div>
      <aside class="personal-sheet auto-connections" aria-labelledby="${prefix}-connection-title">
        <h2 id="${prefix}-connection-title">${kind==='social'?'SNS 계정':'Gmail 계정'}</h2>
        <div data-auto-accounts></div>
        ${kind==='social'?'<details class="auto-channel-setup" data-auto-setup><summary>채널 연결 및 설정</summary><div data-auto-catalog></div></details>':''}
      </aside>
      <dialog class="auto-dialog" aria-labelledby="${prefix}-dialog-title">
        <form class="personal-form" data-auto-form>
          <h2 id="${prefix}-dialog-title" data-auto-dialog-title></h2>
          <div class="auto-fields" data-auto-fields></div>
          <p class="auto-message" data-auto-dialog-message role="status"></p>
          <div class="personal-form-actions">
            ${actionButton('닫기','close')}<button type="submit" class="btn primary" data-auto-submit>저장</button>
          </div>
        </form>
      </dialog>
    </section>`;
  }

  function note(view,value,error=false,dialog=false) {
    const target=view.root.querySelector(dialog?'[data-auto-dialog-message]':'[data-auto-message]');
    target.textContent=value;
    target.classList.toggle('is-error',error);
  }

  function statusLabel(status) {
    return Object.hasOwn(statusText,status)?statusText[status]:'상태 미확인';
  }

  function connectionFor(view,item) {
    return view.data?.accounts?.find(account=>account.id===item.accountId)||null;
  }

  function approvalAvailable(view,item) {
    if(!editAllowed(view,item))return false;
    if(view.kind==='mail')return view.data.connection?.connected===true&&!view.data.connection.paused;
    const connection=connectionFor(view,item);
    return !!connection&&connection.ready===true&&!connection.paused;
  }

  function validTime(value) {
    const stamp=Date.parse(value);
    return Number.isFinite(stamp)?'<time datetime="'+escape(new Date(stamp).toISOString())+'">'+escape(formatter.format(stamp))+' KST</time>':'';
  }

  const connectedAccounts=view=>view.data?.accounts.filter(account=>account.ready)||[];
  function paintItems(view) {
    let rows=view.data?.items||[];
    if(view.kind==='social') {
      const accounts=connectedAccounts(view);
      const connected=new Set(accounts.map(account=>account.id));
      const inactive=rows.filter(row=>!connected.has(row.accountId));
      const filter=view.root.querySelector('[data-auto-filter]');
      if(view.filter==='history'&&!inactive.length||view.filter&&view.filter!=='history'&&!connected.has(view.filter))view.filter='';
      filter.innerHTML=accounts.length>1||inactive.length?'<label>게시 작업 보기<select data-auto-account-filter>'+
        option('','연결된 계정 전체',view.filter||'')+accounts.map(account=>option(account.id,account.label,view.filter)).join('')+
        (inactive.length?option('history','연결이 끊긴 계정의 기록',view.filter):'')+'</select></label>':'';
      rows=view.filter==='history'?inactive:rows.filter(row=>connected.has(row.accountId)&&(!view.filter||view.filter===row.accountId));
    }
    const pane=view.root.querySelector('[data-auto-items]');
    if(!rows.length) {
      pane.innerHTML=view.data?'<p class="personal-empty">작성한 초안이 없습니다.</p>':'';
      return;
    }
    pane.innerHTML=`<ul class="personal-list auto-list">${rows.map(item=>{
      const title=view.kind==='social'?item.title:item.subject;
      const channel=view.kind==='social'?connectionFor(view,item)?.label||providerNames[item.provider]:'받는 사람 '+(item.to||'');
      const review=item.status==='review'?(item.uncertain?' 실제 채널에서 처리 결과를 먼저 확인해 주세요.':' 연결 상태와 원고를 확인해 주세요.'):'';
      const link=view.kind==='social'&&item.status==='published'?safeLink(item.link):'';
      const buttons=[editAllowed(view,item)?actionButton('편집','edit',item.id):'',
        approvalAvailable(view,item)?actionButton(item.status==='scheduled'?'예약 변경':'원고 승인 및 예약','schedule',item.id):'',
        item.status==='scheduled'?actionButton('예약 취소','cancel',item.id):'',
      ].join('');
      return `<li class="personal-row auto-row"><div class="personal-row-text">
        <div class="auto-row-heading"><strong>${escape(title)}</strong><span class="auto-state" data-state="${escape(item.status)}">${statusLabel(item.status)}</span></div>
        <div class="personal-row-meta auto-meta"><span>${escape(channel||'채널 미확인')}</span>${item.cardId?'<span>'+escape((item.cardTitle||'카드뉴스')+' · '+(item.cardSlide+1)+'장')+'</span>':''}${validTime(item.scheduledAt)}</div>
        ${review?`<p class="auto-review">${escape(item.error||item.reason||review.trim())}</p>`:''}
        ${link?`<a class="personal-link" href="${escape(link)}" referrerpolicy="no-referrer" rel="noopener noreferrer" target="_blank">게시물 열기</a>`:''}
        </div>${buttons?`<div class="personal-row-actions auto-row-actions">${buttons}</div>`:''}</li>`;
    }).join('')}</ul>`;
  }

  function configuredCallback(view,provider) {
    const mail=view.kind==='mail';
    const app=mail?view.data?.connection:view.data?.providers?.find(item=>item.id===provider);
    try {
      const url=new URL(app?.redirectUri);
      const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if((url.protocol==='https:'||local)&&!url.username&&!url.password&&!url.search&&!url.hash&&
         url.pathname==='/api/personal/'+(mail?'mail/oauth':'social/'+provider))return url;
    }catch{}
    return null;
  }

  function connectionAction(view,provider,label,action,id=provider) {
    const callback=configuredCallback(view,provider);
    if(callback&&callback.origin!==location.origin) {
      const href=new URL('/personal#'+view.kind,callback);
      return `<a class="personal-link" href="${escape(href.href)}">운영 사이트에서 연결</a>`;
    }
    return actionButton(label,action,id);
  }

  function accountsPanel(view,catalog=false) {
    if(view.kind==='mail') {
      const {configured,connection={}}=view.data;
      const state=connection.connected?(connection.paused?'발송 일시정지':'연결됨'):'미연결';
      return `<div class="auto-account">
       <strong>Gmail</strong><p>${state}</p>
       <div class="auto-actions">
        ${configured?connectionAction(view,'mail',connection.connected?'다시 연결':'Google로 연결','connect'):''}
        ${connection.connected?actionButton(connection.paused?'발송 재개':'발송 일시정지','pause','mail')+actionButton('연결 해제','disconnect','mail'):''}
        ${actionButton(configured?'Google 앱 설정':'Google 앱 설정 추가','configure','mail')}
       </div></div>`;
    }
    const groupAccounts=provider=>view.data.accounts.filter(account=>account.provider===provider.id&&(catalog?!account.ready:account.ready));
    const providers=catalog?view.data.providers:view.data.providers.filter(provider=>groupAccounts(provider).length);
    if(!providers.length)return '<p class="personal-empty">'+(catalog?'연결할 수 있는 채널이 없습니다.':'연결된 SNS 계정이 없습니다.')+'</p>';
    return providers.map(provider=>{
      const accounts=groupAccounts(provider);
      return `<section class="auto-account" aria-label="${escape(provider.name||providerNames[provider.id])}">
        <strong>${escape(provider.name||providerNames[provider.id])}</strong>
        <p>${catalog?(provider.configured?'연결 가능':'앱 설정 필요'):accounts.length+'개 계정'}</p>
        ${accounts.length?`<ul class="auto-account-list">${accounts.map(account=>`<li>
          <div><b>${escape(account.label)}</b><small>${escape(account.username||'')}${account.ready?account.paused?' · 게시 일시정지':'':' · 다시 연결 필요'}</small></div>
          <div class="auto-actions">
            ${provider.configured?connectionAction(view,provider.id,'다시 연결','reconnect',account.id):''}
            ${account.ready?actionButton(account.paused?'게시 재개':'게시 일시정지','pause',account.id):''}
            ${actionButton('연결 해제','disconnect',account.id)}
          </div></li>`).join('')}</ul>`:''}
        ${catalog?'<div class="auto-actions">'+
          (provider.configured?connectionAction(view,provider.id,'계정 연결','connect'):'')+
          actionButton(provider.appSource==='personal'?'앱 설정':'내 앱 설정','configure',provider.id)+'</div>':''}
      </section>`;
    }).join('');
  }

  function paint(view) {
    paintItems(view);
    view.root.querySelector('[data-auto-accounts]').innerHTML=view.data?accountsPanel(view):'';
    if(view.kind==='social')view.root.querySelector('[data-auto-catalog]').innerHTML=view.data?accountsPanel(view,true):'';
    const connectionReady=view.kind==='social'?connectedAccounts(view).length>0:view.data?.connection?.connected;
    view.root.querySelector('[data-auto-first-connect]').hidden=!view.data||connectionReady===true;
    view.root.querySelector('[data-auto-action="new"]').hidden=view.kind==='social'&&!!view.data&&!connectedAccounts(view).length;
    setControls(view);
  }

  function setControls(view) {
    const working=view.busy||view.loading;
    view.root.querySelector('.personal-automation').setAttribute('aria-busy',String(working));
    view.fields.inert=view.busy;
    for(const control of view.root.querySelectorAll('[data-auto-action],[data-auto-submit]')){
      control.disabled=working||(control.dataset.autoAction==='new'&&(!view.data||(view.kind==='social'&&!connectedAccounts(view).length)));
    }
  }

  function applyState(view,result) {
    view.data=view.kind==='social'?{
      providers:(result.providers||[]).filter(p=>Object.hasOwn(providerNames,p.id)&&p.id!=='mail'),
      accounts:result.accounts||[],items:result.posts||[],
    }:{configured:result.configured===true,connection:result.connection||{},items:result.items||[]};
    paint(view);
  }

  async function load(view,retainedMessage='') {
    if(!current(view))return;
    view.read?.abort();
    const ticket=new AbortController();
    view.read=ticket;
    view.needsRefresh=false;
    view.loading=true;
    setControls(view);
    try {
      const result=await request(view,undefined,ticket.signal);
      if(!current(view)||view.read!==ticket)return;
      applyState(view,result);
      note(view,retainedMessage||'');
    } catch(error) {
      if(!current(view)||view.read!==ticket||ticket.signal.aborted)return;
      if(error.status===401||error.status===403) {
        view.data=null;
        view.dialog.close();
        view.fields.replaceChildren();
        paint(view);
      }
      note(view,retainedMessage?retainedMessage+' 목록을 다시 조회해 주세요.':error.message,true);
    } finally {
      if(view.read===ticket) {
        view.loading=false;
        view.read=null;
        if(current(view)){
          setControls(view);
          if(view.needsRefresh&&!view.busy&&location.hash==='#'+view.kind)void load(view);
          else openPendingDraft(view);
        }
      }
    }
  }

  function modal(view,kind,id,fields,heading,submit) {
    view.editor={kind,id,version:view.data.items.find(item=>item.id===id)?.version,invoker:document.activeElement?.dataset};
    view.fields.innerHTML=fields;
    view.root.querySelector('[data-auto-dialog-title]').textContent=heading;
    view.root.querySelector('[data-auto-submit]').textContent=submit;
    note(view,'',false,true);
    if(!view.dialog.open)view.dialog.showModal();
    view.fields.querySelector('input,select,textarea')?.focus();
  }

  function draftEditor(view,item,cardChoice=null,seed=null) {
    if(view.kind==='mail'){
      return modal(view,'draft',item?.id,`
        <label>받는 사람<input name="to" type="email" required maxlength="254" value="${escape(item?.to)}"></label>
        <label>제목<input name="subject" required maxlength="160" value="${escape(item?.subject??seed?.title)}"></label>
        <label>본문<textarea name="body" rows="6" maxlength="16000" required>${escape(item?.body??seed?.text)}</textarea></label>`,
      item?'메일 초안 편집':'새 메일 초안','초안 저장');
    }
    const accounts=connectedAccounts(view);
    if(!accounts.length){
      view.root.querySelector('[data-auto-setup]').open=true;
      return note(view,'SNS 계정을 연결한 뒤 초안을 작성해 주세요.',true);
    }
    const account=cardChoice?.accountId||(item?(accounts.some(row=>row.id===item.accountId)?item.accountId:''):seed?'':accounts.find(row=>row.id===view.filter)?.id||accounts[0].id);
    const bool=(value)=>option('','선택',value==null?'':String(value))+option('true','예',String(value))+option('false','아니요',String(value));
    modal(view,'draft',item?.id,`
     ${item?.status==='scheduled'?'<p class="auto-caption">편집을 저장하면 현재 예약이 해제됩니다. 게시 시각을 다시 승인해 주세요.</p>':''}
     <label>게시 계정<select name="accountId" required>${option('','게시 계정을 선택해 주세요.',account)+accounts.map(a=>option(a.id,a.label+' · '+(providerNames[a.provider]||a.provider),account)).join('')}</select></label>
     <label>제목<input name="title" required maxlength="160" value="${escape(item?.title??seed?.title)}"></label>
     <label>본문<textarea name="body" rows="6" maxlength="5000" required>${escape(item?.body??seed?.text)}</textarea></label>
     <p class="auto-caption" data-auto-media-note></p>
     <div data-auto-channel-field="image"><label for="personal-sns-image-source">게시 이미지</label>
     <select id="personal-sns-image-source" name="imageSource">
      ${option('url','공개 이미지 주소',!cardChoice&&!item?.cardId?'url':'')}
      ${option('card','내 카드뉴스',cardChoice||item?.cardId?'card':'')}
     </select></div>
     <label data-auto-channel-field="image" data-auto-image-source="url">공개 이미지 주소<input name="mediaUrl" type="url" maxlength="2000" value="${escape(item?.mediaUrl)}"></label>
     <div class="auto-field-pair" data-auto-channel-field="image" data-auto-image-source="card">
      <label>카드뉴스<select name="cardId">${option('','카드 목록을 불러오는 중','')}</select></label>
      <label>페이지<select name="cardSlide">${option('','카드뉴스 선택','')}</select></label>
      <p class="auto-caption auto-card-description" data-auto-card-description aria-live="polite"></p>
     </div>
     <label data-auto-channel-field="youtube">비공개 YouTube 영상 주소 또는 ID<input name="videoId" maxlength="2000" value="${escape(item?.videoId)}"></label>
     <div class="auto-field-pair" data-auto-channel-field="youtube">
      <label>아동용 콘텐츠<select name="madeForKids">${bool(item?.madeForKids)}</select></label>
      <label>변경·합성 콘텐츠<select name="synthetic">${bool(item?.synthetic)}</select></label>
     </div>`,item?'게시 초안 편집':'새 게시 초안','초안 저장');
    view.editor.cards=new Map();
    view.editor.existingCard=item?.cardId?item:null;
    view.editor.preselectedCard=cardChoice;
    setDraftFields(view);
    if(view.form.elements.imageSource.value==='card')void loadDraftCards(view);
  }

  function cardPage(view, selected='') {
    const {cardId,cardSlide}=view.form.elements;
    const card=view.editor.cards.get(cardId.value);
    cardSlide.innerHTML=card?.slides.length?card.slides.map((slide,index)=>
      option(String(index),(index+1)+'장 · '+slide.headline,String(selected))).join(''):option('','카드뉴스 선택','');
    const slide=card?.slides[Number(cardSlide.value)];
    view.fields.querySelector('[data-auto-card-description]').textContent=slide?
      '이미지 대체 텍스트 · '+[slide.label,slide.headline,slide.body].filter(Boolean).join('. '):'';
  }

  async function loadDraftCards(view) {
    const editor=view.editor;
    if(!current(view)||editor.kind!=='draft'||editor.cardLoading)return;
    if(editor.cardsLoaded)return;
    editor.cardLoading=true;
    const ticket=new AbortController();
    view.cardRead?.abort();
    view.cardRead=ticket;
    const status=view.fields.querySelector('[data-auto-card-description]');
    status.textContent='내 카드뉴스를 불러오고 있습니다.';
    try {
      const response=await fetch('/api/personal/ai/cards',{cache:'no-store',signal:ticket.signal,headers:{'X-Personal-Account':view.owner}});
      if(!response.ok)throw Error('내 카드뉴스를 불러오지 못했습니다. 다시 선택해 주세요.');
      const result=await response.json();
      if(!current(view)||view.editor!==editor||view.cardRead!==ticket||ticket.signal.aborted)return;
      const preselected=editor.preselectedCard;
      const selected=preselected?.id||view.form.elements.cardId.value||editor.existingCard?.cardId;
      for(const card of result.cards||[]){
        if(cardIdPattern.test(card.id)&&Array.isArray(card.slides))editor.cards.set(card.id,card);
      }
      if(selected&&cardIdPattern.test(selected)&&!editor.cards.has(selected)){
        const previous=await fetch('/api/personal/ai/cards/'+selected,{
          cache:'no-store',signal:ticket.signal,headers:{'X-Personal-Account':view.owner},
        });
        const card=previous.ok?(await previous.json()).card:null;
        if(!current(view)||view.editor!==editor||view.cardRead!==ticket||ticket.signal.aborted)return;
        if(card?.id===selected&&Array.isArray(card.slides))editor.cards.set(card.id,card);
      }
      view.form.elements.cardId.innerHTML=option('','최근 카드뉴스 선택',selected)+[...editor.cards.values()].map(card=>
        option(card.id,card.title,selected)).join('');
      editor.cardsLoaded=true;
      const existingPage=selected&&selected===editor.existingCard?.cardId?editor.existingCard.cardSlide:0;
      const slide=preselected?.slide??existingPage;
      const invalidPage=preselected&&editor.cards.has(selected)&&!editor.cards.get(selected).slides[slide];
      if(invalidPage)view.form.elements.cardId.value='';
      cardPage(view,slide);
      if(!editor.cards.size)status.textContent='저장한 카드뉴스가 없습니다. AI 비서에서 먼저 만들어 주세요.';
      else if(preselected&&!editor.cards.has(selected))status.textContent='선택한 카드뉴스를 확인할 수 없습니다.';
      else if(invalidPage)status.textContent='선택한 카드 페이지를 확인할 수 없습니다. 다시 선택해 주세요.';
      editor.preselectedCard=null;
    }catch(error){
      if(current(view)&&view.editor===editor&&!ticket.signal.aborted){
        status.textContent=error.message;
        view.form.elements.cardId.innerHTML=option('','다시 선택해 주세요.','');
      }
    }finally{
      editor.cardLoading=false;
      if(view.cardRead===ticket)view.cardRead=null;
    }
  }

  function setDraftFields(view) {
    const provider=connectionFor(view,{accountId:view.form.elements.accountId.value})?.provider;
    const youtube=provider==='youtube',imageAllowed=imageProviders.includes(provider);
    const imageSource=view.form.elements.imageSource.value;
    view.form.elements.title.maxLength=youtube?100:160;
    view.form.elements.body.maxLength={threads:1000,instagram:4400}[provider]||5000;
    for(const group of view.fields.querySelectorAll('[data-auto-channel-field]')){
      const image=group.dataset.autoChannelField==='image';
      const source=group.dataset.autoImageSource;
      group.hidden=image?!imageAllowed||!!source&&source!==imageSource:!youtube;
      for(const field of group.querySelectorAll('input,select')){
        field.disabled=group.hidden;
        field.required=!group.hidden&&(!image||source==='card'||source==='url'&&provider==='instagram');
      }
    }
    view.fields.querySelector('[data-auto-media-note]').textContent=youtube?
      'YouTube Studio의 비공개 영상과 제목·설명을 일치시켜 주세요.':
      provider==='instagram'?'내 카드뉴스 한 장이나 공개 HTTPS JPEG를 선택해 주세요.':
      provider==='threads'?'Threads는 텍스트만 작성해도 됩니다.':provider==='x'?'X는 텍스트만 예약할 수 있으며 본문은 가중 280자 이내여야 합니다.':'';
  }

  function scheduleEditor(view,item) {
    const mail=view.kind==='mail', subject=mail?item.subject:item.title;
    const account=mail?item.to:connectionFor(view,item)?.label;
    modal(view,'schedule',item.id,`<div class="auto-approval-preview"><strong>${escape(subject)}</strong>
      <p class="auto-caption">${escape((mail?'받는 사람 ':'게시 계정 ')+(account||'미확인'))}</p>
      <p>${escape(item.body)}</p>${!mail&&item.cardId?'<p class="auto-caption">첨부 이미지 · '+escape(item.cardTitle||'카드뉴스')+' '+(item.cardSlide+1)+'장</p><p class="auto-caption">'+escape(item.altText)+'</p>':''}</div>
      <div class="auto-field-pair">
        <label>예약 날짜<input name="day" type="date" required></label>
        <label>예약 시간 <small>한국 시간</small><input name="time" type="time" required></label>
      </div>
      <label class="auto-approval"><input name="approved" type="checkbox" required>
      <span>원고와 ${mail?'받는 사람':'게시 계정'}을 확인하고 예약을 승인합니다.</span></label>`,
    mail?'메일 검토 및 예약':'게시 원고 검토 및 예약',mail?'발송 예약':'게시 예약');
  }

  function setupEditor(view,providerId,account) {
    if(!Object.hasOwn(oauthPaths,providerId))return;
    const provider=view.data.providers?.find(p=>p.id===providerId);
    const mail=view.kind==='mail';
    const callback=configuredCallback(view,providerId);
    modal(view,'configure',providerId,`
      <p class="auto-caption">${mail?'Google':'채널'} 앱에 등록할 콜백 주소</p>
      ${callback?`<code class="auto-callback" tabindex="0">${escape(callback.href)}</code>
        <div class="auto-actions">${actionButton('주소 복사','copy-callback')}</div>`:
        '<p class="auto-caption">등록 주소를 불러오지 못했습니다. 목록을 다시 조회해 주세요.</p>'}
      ${callback&&callback.origin!==location.origin?'<p class="auto-caption">계정 동의는 운영 사이트에서 시작해 주세요.</p>':''}
      <label>Client ID<input name="clientId" maxlength="500" autocomplete="off" required
       value="${escape(mail?view.data.connection.clientId:provider?.clientId)}"></label>
      <label>Client Secret<input name="clientSecret" type="password" maxlength="500" autocomplete="new-password" required></label>
      ${providerId==='instagram'?`<label>Instagram API 버전<input name="version" maxlength="8" placeholder="v25.0" value="${escape(provider?.version)}"></label>`:''}
      ${providerId==='x'?'<p class="auto-caption">X 개발자 앱에 쓰기 권한과 게시 API 접근이 필요합니다.</p>':''}
      ${account?'<p class="auto-caption">앱을 변경한 뒤 새로 연결해 주세요.</p>':''}`,
    providerNames[providerId]+' 앱 설정','설정 저장');
  }

  async function copyCallback(view) {
    const code=view.fields.querySelector('.auto-callback');
    if(!code)return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      if(current(view)&&code.isConnected)note(view,'등록 주소를 복사했습니다.',false,true);
    }catch{
      if(!current(view)||!code.isConnected)return;
      code.focus();
      window.getSelection()?.selectAllChildren(code);
      note(view,'선택된 등록 주소를 복사해 주세요.',false,true);
    }
  }

  function confirmEditor(view,action,id) {
    const item=view.data.items.find(row=>row.id===id);
    const account=view.data.accounts?.find(row=>row.id===id);
    const cancel=action==='cancel';
    const label=cancel?'예약 취소':'연결 해제';
    const name=cancel?item?.title||item?.subject:account?.label||'Gmail';
    modal(view,action,id,'<p>'+escape(name||'선택한 계정')+'의 '+(cancel?'예약을 취소할까요?':'연결을 해제할까요?')+'</p>',label,label);
    view.root.querySelector('[data-auto-dialog-title]').setAttribute('tabindex','-1');
    view.root.querySelector('[data-auto-dialog-title]').focus();
  }

  function followOAuth(provider,value) {
    const raw=safeLink(value);
    if(!raw)throw Error('채널의 승인 화면 주소를 확인하지 못했습니다.');
    const url=new URL(raw),expected=new URL(oauthPaths[provider]);
    if(url.origin!==expected.origin||url.pathname!==expected.pathname)throw Error('채널의 승인 화면 주소를 확인하지 못했습니다.');
    location.assign(url.href);
  }

  async function mutate(view,body,notice,provider) {
    if(!current(view)||view.busy||view.loading)return;
    view.busy=true;
    const epoch=view.epoch;
    const focus=view.dialog.open?view.editor?.invoker:document.activeElement?.dataset;
    let written=false;
    setControls(view);
    try {
      const result=await request(view,body);
      if(!current(view)||epoch!==view.epoch)return;
      if(provider) {
        followOAuth(provider,result.url);
        return;
      }
      written=true;
      if(view.dialog.open)view.dialog.close();
      view.fields.replaceChildren();
      if(view.kind==='mail'&&Array.isArray(result.items))applyState(view,result);
      else if(view.kind==='social'&&result.post) {
        view.data.items=[result.post,...view.data.items.filter(item=>item.id!==result.post.id)];
        paint(view);
      } else await load(view,notice);
      if(current(view)&&epoch===view.epoch) {
        if(Array.isArray(result.items)||result.post)note(view,notice);
        window.dispatchEvent(new Event('personal-automation-changed'));
      }
    } catch(error) {
      if(!current(view)||epoch!==view.epoch)return;
      note(view,error.status?error.message:'처리 결과를 확인하지 못했습니다. 목록을 다시 조회해 주세요.',true,view.dialog.open);
    } finally {
      view.busy=false;
      if(current(view)){
        setControls(view);
        if(view.needsRefresh)void load(view);
        if(written&&focus?.autoAction&&!view.root.closest('[hidden]')&&document.visibilityState==='visible') {
          const buttons=[...view.root.querySelectorAll('[data-auto-action]:not(:disabled)')];
          (buttons.find(button=>button.dataset.id===focus.id&&button.dataset.autoAction===focus.autoAction)||
           buttons.find(button=>button.dataset.autoAction==='refresh'))?.focus({preventScroll:true});
        }
        openPendingDraft(view);
      }
    }
  }

  function submit(view,event) {
    event.preventDefault();
    if(view.busy||view.loading||!view.editor)return;
    const {kind,id,version}=view.editor;
    const fields=Object.fromEntries(new FormData(view.form));
    const item=view.data.items.find(row=>row.id===id);
    try {
      if(kind==='draft'){
        const change=id?{id,version}:{};
        const draft=view.kind==='mail'?{action:'draft',to:fields.to,subject:fields.subject,body:fields.body}:
          {action:'save',accountId:fields.accountId,title:fields.title,body:fields.body,mediaUrl:fields.mediaUrl||'',videoId:fields.videoId||'',
            ...(fields.cardId?{cardId:fields.cardId,cardSlide:Number(fields.cardSlide)}:{}),
            ...(fields.madeForKids!==undefined?{madeForKids:fields.madeForKids==='true',synthetic:fields.synthetic==='true'}:{})};
        return mutate(view,{...draft,...change},'초안을 저장했습니다.');
      }
      if(kind==='schedule'){
        if(!item||fields.approved!=='on')throw Error('원고와 예약 내용을 확인한 뒤 승인해 주세요.');
        const scheduledAt=futureStamp(fields.day,fields.time);
        return mutate(view,{action:kind,id,version,approved:true,[view.kind==='mail'?'at':'scheduledAt']:scheduledAt},'예약을 등록했습니다.');
      }
      if(kind==='configure'){
        const provider=view.data.providers?.find(p=>p.id===id);
        view.form.elements.clientSecret.value='';
        return mutate(view,{action:kind,clientId:fields.clientId,clientSecret:fields.clientSecret,
          ...(provider?{provider:id,...(fields.version?{version:fields.version}:{})}:{})},'앱 설정을 저장했습니다.');
      }
      if(kind==='connect'){
        const account=view.data.accounts.find(a=>a.id===id);
        const provider=account?.provider||id;
        return mutate(view,{action:kind,provider,label:fields.label,...(account?{accountId:account.id}:{})},'',provider);
      }
      if(kind==='disconnect')return mutate(view,{action:kind,...(view.kind==='social'?{accountId:id}:{})},'연결을 해제했습니다.');
      if(kind==='cancel'&&item)return mutate(view,{action:kind,id,version},'예약을 취소했습니다.');
    } catch(error) {note(view,error.message,true,true);}
  }

  function click(view,event) {
    const button=event.target.closest('[data-auto-action]');
    if(!button)return;
    const id=button.dataset.id,action=button.dataset.autoAction;
    const item=view.data?.items.find(row=>row.id===id);
    const account=view.data?.accounts?.find(row=>row.id===id);
    if(!current(view)||view.busy||view.loading)return;
    if(action==='close')return view.dialog.close();
    if(action==='refresh')return void load(view);
    if(action==='copy-callback')return void copyCallback(view);
    if(action==='setup-jump'){
      const setup=view.root.querySelector('[data-auto-setup]');
      if(setup)setup.open=true;
      const control=view.root.querySelector(setup?'[data-auto-setup] summary':'[data-auto-accounts] :is([data-auto-action="connect"],[data-auto-action="reconnect"],[data-auto-action="configure"],a.personal-link)');
      if(control){
        control.focus({preventScroll:true});
        control.scrollIntoView({block:'center',behavior:'instant'});
      }
      return;
    }
    if(action==='new'||action==='edit'&&item&&editAllowed(view,item))return draftEditor(view,item);
    if(action==='schedule'&&item&&approvalAvailable(view,item))return scheduleEditor(view,item);
    if(action==='configure')return setupEditor(view,id,view.kind==='mail'?view.data.connection.connected:view.data.accounts.some(p=>p.provider===id));
    if(action==='disconnect'||action==='cancel'&&item?.status==='scheduled')return confirmEditor(view,action,id);
    if(action==='pause'){
      const source=view.kind==='mail'?view.data.connection:account;
      if(!source)return;
      return mutate(view,{action,paused:!source.paused,...(account?{accountId:id}:{})},source.paused?'일시정지를 해제했습니다.':'예약 처리를 일시정지했습니다.');
    }
    if(action==='connect'&&view.kind==='mail')return mutate(view,{action},'',id);
    if(action==='connect'||action==='reconnect'&&account){
      return modal(view,'connect',id,`<label>계정 이름<input name="label" required maxlength="100" value="${escape(account?.label)}"></label>`,
        providerNames[account?.provider||id]+' 계정 연결','승인 화면 열기');
    }
  }

  function oauthNotice(kind) {
    const url=new URL(location.href),key=kind==='social'?'sns':'mail',value=url.searchParams.get(key);
    if(value!=='connected'&&value!=='failed')return '';
    url.searchParams.delete(key);
    history.replaceState(history.state,'',url.href);
    return value==='connected'?'계정을 연결했습니다.':'연결을 완료하지 못했습니다. 다시 연결해 주세요.';
  }

  function suspendView(view) {
    view.epoch++;
    view.read?.abort();
    view.cardRead?.abort();
    view.read=null;
    view.loading=false;
    view.needsRefresh=true;
    view.openDraft||=view.dialog.open&&view.editor?.kind==='draft'&&!view.busy;
    if(view.dialog.open)view.dialog.close();
    const secret=view.form.elements.clientSecret;
    if(secret)secret.value='';
  }

  function openPendingDraft(view) {
    if(!current(view)||!view.data||view.loading||view.busy||view.dialog.open||
       document.visibilityState==='hidden'||location.hash!=='#'+view.kind)return;
    if(approvedDraft?.owner===view.owner&&approvedDraft.kind===view.kind){
      const seed=approvedDraft;
      approvedDraft=null;
      draftEditor(view,null,null,seed);
      return;
    }
    if(view.kind!=='social'||!socialCard||socialCard.owner!==view.owner)return;
    const pending=socialCard;
    socialCard=null;
    const account=view.data.accounts.find(a=>imageProviders.includes(a.provider)&&a.ready&&!a.paused);
    if(!account){
      note(view,'카드뉴스를 올리려면 Instagram 또는 Threads 계정을 연결해 주세요.',true);
      return;
    }
    draftEditor(view,null,{id:pending.id,slide:pending.slide,accountId:account.id});
  }

  function reviewApprovedDraft(kind,title,text) {
    const owner=window.NuriPersonalAccount;
    if(!owner||!['mail','social'].includes(kind))return false;
    approvedDraft={kind,title,text,owner};
    if(location.hash!=='#'+kind)location.hash=kind;
    else mount(kind);
    return true;
  }

  function selectSocialCard(id,slide=0) {
    const owner=window.NuriPersonalAccount;
    if(!owner||typeof id!=='string'||!cardIdPattern.test(id)||!Number.isInteger(slide)||slide<0)return;
    socialCard={id,slide,owner};
    if(location.hash!=='#social')location.hash='social';
    else mount('social');
  }

  function mount(kind) {
    const root=document.getElementById(rootIds[kind]),owner=window.NuriPersonalAccount;
    if(!root||!owner||!Object.hasOwn(rootIds,kind))return;
    for(const [mode,previous] of views){
      if(previous.owner===owner)continue;
      suspendView(previous);
      previous.root.onclick=null;
      previous.root.onchange=null;
      previous.root.replaceChildren();
      views.delete(mode);
    }
    const prior=views.get(kind);
    if(prior?.root===root&&prior.owner===owner){
      if(prior.needsRefresh&&!prior.busy&&!prior.loading){
        if(prior.openDraft){
          prior.dialog.showModal();prior.openDraft=false;
          if(prior.form.elements.imageSource?.value==='card')void loadDraftCards(prior);
        }
        void load(prior);
      }else openPendingDraft(prior);
      return;
    }
    if(prior)suspendView(prior);
    const view={root,owner,kind,data:null,busy:false,loading:false,read:null,epoch:0};
    views.set(kind,view);
    root.innerHTML=layout(view);
    view.dialog=root.querySelector('dialog');
    view.form=root.querySelector('[data-auto-form]');
    view.fields=root.querySelector('[data-auto-fields]');
    view.form.addEventListener('submit',event=>submit(view,event));
    view.form.addEventListener('change',event=>{
      if(kind!=='social'||view.editor?.kind!=='draft')return;
      const name=event.target.name;
      if(name==='accountId'||name==='imageSource'){
        setDraftFields(view);
        if(view.form.elements.imageSource.value==='card')void loadDraftCards(view);
      }
      if(name==='cardId')cardPage(view,0);
      if(name==='cardSlide')cardPage(view,event.target.value);
    });
    view.dialog.addEventListener('cancel',event=>{if(view.busy)event.preventDefault();});
    view.dialog.addEventListener('close',()=>{
      if(view.dialog.open)return;
      view.cardRead?.abort();
      const secret=view.form.elements.clientSecret;
      if(secret)secret.value='';
      openPendingDraft(view);
    });
    root.onclick=event=>click(view,event);
    root.onchange=event=>{
      if(current(view)&&event.target.matches('[data-auto-account-filter]')){
        view.filter=event.target.value;
        paintItems(view);
        root.querySelector('[data-auto-account-filter]')?.focus({preventScroll:true});
      }
    };
    void load(view,oauthNotice(kind));
  }

  function suspend() {
    approvedDraft=null;
    for(const view of views.values())suspendView(view);
  }
  window.addEventListener('personal-automation-changed',event=>{
    const view=views.get(event.detail?.kind);
    if(!view||!current(view))return;
    view.needsRefresh=true;
    if(!view.busy&&!view.loading&&location.hash==='#'+view.kind)void load(view);
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')suspend();});
  window.addEventListener('pagehide',suspend);
  window.NuriPersonalAutomation={mount,suspend,selectSocialCard,reviewApprovedDraft};
})();
