import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as list, POST as change} from '../src/app/api/personal/social/route';
import {GET as callback} from '../src/app/api/personal/social/[provider]/route';
import {runPersonalSocial} from '../src/lib/personal-social';
import {context} from '../src/server/context.cjs';
import {createPersonalCard} from '../src/lib/personal-cards';
import {getPersonalCardMedia} from '../src/lib/personal-card-media';

const origin = 'https://personal-social.example.invalid';
const accounts = {
  owner: {
    id: 'd3bf51db-3bc0-4c0a-a66c-18881b2abb81', email: 'owner@example.invalid',
    cookie: 'aaa.' + Buffer.from(JSON.stringify({session_id:'a3bf51db-3bc0-4c0a-a66c-18881b2abb81'})).toString('base64url') + '.bbb',
  },
  friend: {
    id: 'd3bf51db-3bc0-4c0a-a66c-18881b2abb82', email: 'friend@example.invalid',
    cookie: 'aaa.' + Buffer.from(JSON.stringify({session_id:'a3bf51db-3bc0-4c0a-a66c-18881b2abb82'})).toString('base64url') + '.bbb',
  },
  viewer: {
    id: 'd3bf51db-3bc0-4c0a-a66c-18881b2abb83', email: 'viewer@example.invalid',
    cookie: 'aaa.' + Buffer.from(JSON.stringify({session_id:'a3bf51db-3bc0-4c0a-a66c-18881b2abb83'})).toString('base64url') + '.bbb',
  },
};
type Person = keyof typeof accounts;
const env = {
  DATABASE_URL: 'postgres://test-only', MARKET_ORIGIN: origin, MARKET_MODE: 'test',
  SUPABASE_URL: 'https://social-auth.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'fixture-only',
  SESSION_SECRET: 'fixture-personal-social-test-secret-only', OPERATOR_EMAIL: accounts.owner.email, OPERATOR_USER_ID: accounts.owner.id,
};

function req(who?: Person, input?: Record<string, unknown>, options: {id?: string; cookie?: string; path?: string; from?: string} = {}) {
  const account = who ? accounts[who] : undefined;
  return new NextRequest(origin + (options.path ?? '/api/personal/social'), {
    method: input ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json', Origin: options.from ?? origin,
      ...(account ? {'X-Personal-Account': options.id ?? account.id, Cookie:'nh_access=' + (options.cookie ?? account.cookie)} : {}),
    },
    ...(input ? {body: JSON.stringify(input)} : {}),
  });
}

async function responseJSON(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return response.json();
}

test('personal SNS OAuth, approved publication, ambiguous failures and revocation stay scoped by identity', async () => {
  const database = new PGlite();
  const global = globalThis as typeof globalThis & {nhPool?: unknown};
  const previous = {fetch:global.fetch, pool:global.nhPool, env:Object.fromEntries(Object.keys(env).map(key=>[key, process.env[key]]))};
  const remote: Array<{host:string; path:string; method:string; token:string; fields:URLSearchParams}> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    const result = await database.query(sql, params);
    return {...result, rowCount: result.affectedRows ?? result.rows.length};
  };
  let queue = Promise.resolve();
  const connect = async () => {
    const last = queue;
    let release!: () => void;
    queue = new Promise<void>(done => {release = done;});
    await last;
    return {query, release};
  };
  let attachedCard: {id:string; slide:number; alt:string} | null = null;
  let signedImageRequests = 0;
  async function verifyCardAttachment(fields: URLSearchParams) {
    assert.ok(attachedCard);
    assert.equal(fields.get('alt_text'),attachedCard.alt);
    const media = new URL(fields.get('image_url')!);
    assert.equal(media.origin,origin);
    assert.equal(media.pathname,'/api/personal/ai/card-media/'+attachedCard.id+'.jpg');
    const token = media.searchParams.get('token');
    assert.ok(token);
    assert.equal(await getPersonalCardMedia(attachedCard.id+'.jpg',''),null);
    const grant = await getPersonalCardMedia(attachedCard.id+'.jpg',token);
    assert.equal(grant?.card.id,attachedCard.id);
    assert.equal(grant?.slide,attachedCard.slide);
    signedImageRequests++;
  }
  let lostPublish = false;
  let holdMedia = false;
  let videoOwner = 'UC' + 'A'.repeat(22);
  const youtube = {id:'C0dEX74219g', userId:'UC' + 'A'.repeat(22), title:'내 YouTube 영상', body:'Studio 비공개 영상 설명'};
  const youtubeScope = 'https://www.googleapis.com/auth/youtube.force-ssl';
  const api = (who: Person, payload: Record<string, unknown>, status = 200) => change(req(who,payload)).then(response=>responseJSON(response,status));
  const state = (who: Person) => list(req(who)).then(response=>responseJSON(response));
  const identityFixture = (who: Person) => ({id: accounts[who].id, email: accounts[who].email, email_confirmed_at:'2026-11-19T00:00:00Z'});
  async function due(who: Person, id: string, clearWait = false) {
    await database.query(
      "UPDATE nh_documents SET data=jsonb_set(data,'{scheduledAt}',to_jsonb($2::text))" +
      (clearWait ? "-'checkedAt'" : '') + " WHERE workspace='live' AND kind='personal-social-post' AND id=$1",
      [accounts[who].id + ':' + id, new Date(Date.now()-10_000).toISOString()],
    );
  }
  const approve = (who: Person, post: {id:string;version:number}) => api(who, {
    action:'schedule', id:post.id, version:post.version, approved:true, scheduledAt:new Date(Date.now()+300_000).toISOString(),
  });
  const route = (provider: string) => ({params: Promise.resolve({provider})});

  try {
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
    await database.exec(await readFile('db/dashboard.sql', 'utf8'));
    global.nhPool = {query, connect};
    Object.assign(process.env, env);
    await database.query(
      "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2),('live','access',$3,$4)",
      [accounts.friend.id, JSON.stringify({status:'approved',scope:'personal',email:accounts.friend.email}),
        accounts.viewer.id, JSON.stringify({status:'approved',scope:'business',email:accounts.viewer.email})],
    );
    global.fetch = async (input, init) => {
      const url = new URL(String(input));
      const token = new Headers(init?.headers).get('Authorization')?.slice(7) ?? '';
      if (url.origin === env.SUPABASE_URL) {
        const person = Object.keys(accounts).find(who => accounts[who as Person].cookie === token) as Person | undefined;
        return person ? Response.json(identityFixture(person)) : new Response(null, {status:401});
      }
      const method = init?.method ?? 'GET';
      const fields = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
      remote.push({host:url.hostname,path:url.pathname,method,token,fields});
      assert.equal(init?.redirect, 'error', 'provider calls do not follow redirects');
      if (url.hostname === 'graph.threads.com') {
        if (url.pathname === '/oauth/access_token') {
          const person = fields.get('code') === 'owner-code' ? 'owner' : 'friend';
          assert.equal(fields.get('client_id'), person === 'owner' ? '2731' : '2732');
          assert.equal(fields.get('client_secret'), person + '-app-key');
          return Response.json({access_token:person+'-short'});
        }
        if (url.pathname === '/access_token') return Response.json({access_token:url.searchParams.get('access_token')?.replace('-short','-grant'),expires_in:86400*40});
        if (url.pathname === '/v1.0/me') return Response.json({id:token==='owner-grant'?'3111':'3112',username:token==='owner-grant'?'owner_handle':'friend_handle'});
        if (/\/threads$/.test(url.pathname)) {
          if(attachedCard) {
            assert.equal(fields.get('media_type'),'IMAGE');
            await verifyCardAttachment(fields);
          }
          return Response.json({id:'5511'});
        }
        if (url.pathname === '/v1.0/5511') return Response.json({status:holdMedia?'IN_PROGRESS':'FINISHED'});
        if (/\/threads_publish$/.test(url.pathname)) {
          if (lostPublish) throw new Error('fixture response loss after publication');
          return Response.json({id:'6611'});
        }
        if (url.pathname === '/v1.0/6611') return Response.json({permalink:'https://www.threads.com/@owner_handle/post/abc'});
      }
      if (url.hostname === 'api.instagram.com' && url.pathname === '/oauth/access_token') {
        assert.equal(fields.get('client_secret'), 'instagram-app-key');
        return Response.json({access_token:'ig-short'});
      }
      if (url.hostname === 'graph.instagram.com') {
        if (url.pathname === '/access_token') return Response.json({access_token:'ig-grant',expires_in:86400*40});
        assert.equal(token,'ig-grant');
        if (url.pathname === '/v25.0/me') return Response.json({user_id:'8111',username:'my_instagram'});
        if (url.pathname === '/v25.0/8111/media') {
          if(attachedCard)await verifyCardAttachment(fields);
          else assert.equal(fields.get('image_url'),'https://images.example.com/personal.jpg');
          return Response.json({id:'8222'});
        }
        if (url.pathname === '/v25.0/8222') return Response.json({status_code:'FINISHED'});
        if (url.pathname === '/v25.0/8111/media_publish') return Response.json({id:'8333'});
        if (url.pathname === '/v25.0/8333') return Response.json({permalink:'https://www.instagram.com/p/Personal/'});
      }
      if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
        assert.match(fields.get('code_verifier') ?? '',/^[-\w]{43}$/);
        return Response.json({access_token:'yt-grant',refresh_token:'yt-refresh',expires_in:3600,scope:youtubeScope});
      }
      if (url.hostname === 'www.googleapis.com') {
        assert.equal(token,'yt-grant');
        if (url.pathname === '/youtube/v3/channels') return Response.json({items:[{id:youtube.userId,snippet:{title:'Personal YouTube'}}]});
        if (url.pathname === '/youtube/v3/videos' && method === 'GET') {
          return Response.json({items:[{id:youtube.id,snippet:{channelId:videoOwner,title:youtube.title,description:youtube.body},status:{privacyStatus:'private',uploadStatus:'processed'}}]});
        }
        if (url.pathname === '/youtube/v3/videos' && method === 'PUT') {
          const payload = JSON.parse(String(init?.body));
          assert.equal(payload.id,youtube.id);
          assert.deepEqual(payload.status,{privacyStatus:'public',selfDeclaredMadeForKids:false,containsSyntheticMedia:true});
          return Response.json({id:youtube.id,status:{privacyStatus:'public'}});
        }
      }
      if (url.hostname === 'api.x.com') {
        if (url.pathname === '/2/oauth2/token') {
          assert.match(fields.get('code_verifier') ?? '',/^[-\w]{43}$/);
          return Response.json({access_token:'x-grant',refresh_token:'x-refresh',expires_in:3600,scope:'tweet.read tweet.write users.read offline.access'});
        }
        assert.equal(token,'x-grant');
        if (url.pathname === '/2/users/me') return Response.json({data:{id:'9991',username:'personal_x'}});
        if (url.pathname === '/2/tweets') {
          assert.deepEqual(JSON.parse(String(init?.body)), {text:'내 개인 X 게시'});
          return Response.json({data:{id:'9992'}});
        }
      }
      throw new Error('Unexpected provider call ' + url.origin + url.pathname);
    };

    assert.equal((await list(req())).status,401);
    assert.equal((await list(req('viewer'))).status,403);
    assert.equal((await list(req('owner',undefined,{id:accounts.friend.id}))).status,409);
    assert.equal((await change(req('owner',{action:'configure'},{from:'https://elsewhere.invalid'}))).status,403);
    assert.deepEqual((await state('friend')).accounts,[]);
    await api('owner',{action:'configure',provider:'threads',clientId:'2731',clientSecret:'owner-app-key'});
    await api('friend',{action:'configure',provider:'threads',clientId:'2732',clientSecret:'friend-app-key'});
    assert.deepEqual((await state('friend')).providers.find((p: {id:string})=>p.id==='threads'),{id:'threads',name:'Threads',configured:true,appSource:'personal'});

    async function begin(who: Person,provider = 'threads') {
      const response = await change(req(who,{action:'connect',provider,label:who+' saved label'}));
      const url = new URL((await responseJSON(response)).url);
      const setCookie = response.headers.get('Set-Cookie') ?? '';
      assert.match(setCookie,/HttpOnly/i);
      assert.ok(setCookie.includes('Path=/api/personal/social/'+provider));
      const providerHosts: Record<string,string> = {threads:'threads.com',instagram:'www.instagram.com',youtube:'accounts.google.com',x:'x.com'};
      assert.equal(url.host,providerHosts[provider]);
      assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/personal/social/'+provider);
      const finishPath = '/api/personal/social/'+provider+'?' + new URLSearchParams({state:url.searchParams.get('state')!,code:who+'-code'});
      return {provider,finishPath, flowCookie:setCookie.split(';')[0]};
    }
    function finish(who: Person, flow: {provider:string;finishPath:string;flowCookie:string}) {
      return callback(req(who,undefined,{cookie:accounts[who].cookie+'; '+flow.flowCookie,path:flow.finishPath}),route(flow.provider));
    }
    const ownerFlow = await begin('owner');
    assert.match((await finish('friend',ownerFlow)).headers.get('Location') ?? '',/sns=failed#social$/);
    assert.equal(remote.length,0, 'mismatched callback does not reach Meta');
    assert.match((await finish('owner',ownerFlow)).headers.get('Location') ?? '',/sns=connected#social$/);
    assert.match((await finish('owner',ownerFlow)).headers.get('Location') ?? '',/sns=failed#social$/, 'callback cannot be replayed');
    const friendFlow = await begin('friend');
    assert.match((await finish('friend',friendFlow)).headers.get('Location') ?? '',/sns=connected#social$/);
    const owner = (await state('owner')).accounts[0];
    const friend = (await state('friend')).accounts[0];
    assert.equal(owner.username,'owner_handle');
    assert.equal(friend.username,'friend_handle');
    assert.equal(owner.ready,true);
    const dbValues = JSON.stringify((await database.query("SELECT id,data FROM nh_documents WHERE kind LIKE 'personal-social-%'")).rows);
    assert.doesNotMatch(dbValues,/-app-key|-short|-grant/);
    assert.doesNotMatch(JSON.stringify(await state('owner')),/friend_handle|-app-key|-grant|ownerId|clientSecret|appFingerprint/);
    const business = await context('live');
    for(const kind of ['app','flow','account','post']) assert.equal(business.list('personal-social-'+kind).length,0);
    await api('friend',{action:'disconnect',accountId:owner.id},404);
    await api('friend',{action:'save',accountId:owner.id,title:'foreign',body:'foreign'},404);

    const drafts = async (who: Person, label: string) => (await api(who,{
      action:'save',accountId:who==='owner'?owner.id:friend.id,title:label,body:label,
    })).post;
    const ownerPost = await drafts('owner','owner approved post');
    const friendPost = await drafts('friend','friend revoked post');
    assert.equal((await context('live')).list('personal-social-post').length,0);
    await api('friend',{action:'schedule',id:ownerPost.id,version:ownerPost.version,approved:true,scheduledAt:new Date(Date.now()+20_000).toISOString()},404);
    await api('owner',{action:'schedule',id:ownerPost.id,version:ownerPost.version,scheduledAt:new Date(Date.now()+20_000).toISOString()},400);
    const ownerScheduled = (await approve('owner',ownerPost)).post;
    const friendScheduled = (await approve('friend',friendPost)).post;
    assert.equal(ownerScheduled.status,'scheduled');
    await due('owner',ownerScheduled.id);
    await due('friend',friendScheduled.id);
    await database.query(
      "UPDATE nh_documents SET data=data||'{\"status\":\"revoked\"}'::jsonb WHERE workspace='live' AND kind='access' AND id=$1",
      [accounts.friend.id],
    );
    holdMedia = true;
    const pending = await runPersonalSocial();
    assert.equal(pending.published,0);
    assert.equal(pending.review,1);
    assert.equal((await state('owner')).posts[0].status,'scheduled');
    assert.equal((await list(req('friend'))).status,403);
    assert.ok(remote.filter(r=>/\/threads$/.test(r.path)).every(r=>r.token==='owner-grant'&&r.path.includes('/3111/')));

    holdMedia = false;
    await due('owner',ownerScheduled.id,true);
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal((await state('owner')).posts[0].link,'https://www.threads.com/@owner_handle/post/abc');
    assert.equal((await runPersonalSocial()).published,0);
    assert.equal(remote.filter(r=>/\/threads_publish$/.test(r.path)).length,1);

    const lost = (await approve('owner',await drafts('owner','lost response'))).post;
    await due('owner',lost.id);
    lostPublish = true;
    assert.equal((await runPersonalSocial()).review,1);
    const uncertain = (await state('owner')).posts.find((p: {id:string})=>p.id===lost.id);
    assert.equal(uncertain.status,'review');
    assert.equal(uncertain.uncertain,true);
    await api('owner',{action:'schedule',id:uncertain.id,version:uncertain.version,approved:true,scheduledAt:new Date(Date.now()+20_000).toISOString()},409);
    assert.equal((await runPersonalSocial()).published,0);
    assert.equal(remote.filter(r=>/\/threads_publish$/.test(r.path)).length,2);

    const paused = (await approve('owner',await drafts('owner','paused approval'))).post;
    await api('owner',{action:'pause',accountId:owner.id,paused:true});
    await api('owner',{action:'pause',accountId:owner.id,paused:false});
    await due('owner',paused.id);
    assert.equal((await runPersonalSocial()).review,1);
    const reconnect = (await approve('owner',await drafts('owner','different app'))).post;
    await api('owner',{action:'configure',provider:'threads',clientId:'9021',clientSecret:'changed-fake-key'});
    assert.equal((await state('owner')).accounts[0].ready,false);
    await due('owner',reconnect.id);
    assert.equal((await runPersonalSocial()).review,1);
    assert.equal(remote.filter(r=>/\/threads_publish$/.test(r.path)).length,2);
    await api('owner',{action:'disconnect',accountId:owner.id});
    assert.deepEqual((await state('owner')).accounts,[]);

    async function connectProvider(who: Person, provider: string, clientId: string, clientSecret = provider+'-app-key') {
      await api(who,{action:'configure',provider,clientId,clientSecret});
      assert.match((await finish(who,await begin(who,provider))).headers.get('Location') ?? '',/sns=connected#social$/);
      return (await state(who)).accounts.find((item: {provider:string})=>item.provider===provider);
    }
    const instagram = await connectProvider('owner','instagram','4001');
    const card = await createPersonalCard(accounts.owner.id,{title:'내 카드뉴스',slides:[
      {headline:'표지',body:'첫 페이지'},
      {headline:'작업 가이드',body:'두 번째 페이지',label:'알아보기'},
    ]});
    const foreignCard = await createPersonalCard(accounts.friend.id,{title:'친구 소유 카드',slides:[{headline:'공유하지 않는 페이지'}]});
    const instagramInput = {action:'save',accountId:instagram.id,title:'내 Instagram',body:'내 이미지 게시'};
    await api('owner',instagramInput,400);
    const instagramDraft = (await api('owner',{...instagramInput,mediaUrl:'https://images.example.com/personal.jpg'})).post;
    await due('owner',(await approve('owner',instagramDraft)).post.id);
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal((await state('owner')).posts.find((post: {id:string})=>post.id===instagramDraft.id).link,'https://www.instagram.com/p/Personal/');

    await api('owner',{...instagramInput,cardId:foreignCard.id,cardSlide:0},404);
    await api('owner',{...instagramInput,cardId:card.id,cardSlide:2},400);
    await api('owner',{...instagramInput,cardId:card.id,cardSlide:1,mediaUrl:'https://images.example.com/personal.jpg'},400);
    const cardDraft = (await api('owner',{...instagramInput,cardId:card.id,cardSlide:1})).post;
    assert.equal(cardDraft.cardTitle,card.title);
    assert.equal(cardDraft.cardId,card.id);
    assert.equal(cardDraft.mediaUrl,'');
    assert.equal(cardDraft.altText,'알아보기. 작업 가이드. 두 번째 페이지');
    assert.equal(signedImageRequests,0);
    assert.equal((await runPersonalSocial()).published,0,'draft is not dispatched');
    const cardApproval = (await approve('owner',cardDraft)).post;
    assert.equal(signedImageRequests,0,'approval stores the data without issuing a URL');
    attachedCard={id:card.id,slide:1,alt:cardDraft.altText};
    await due('owner',cardApproval.id);
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal(signedImageRequests,1);
    assert.doesNotMatch(JSON.stringify(await state('owner')),/card-media|\?token=/);
    const storedCardPost = (await database.query("SELECT data FROM nh_documents WHERE workspace='live' AND kind='personal-social-post' AND id=$1", [
      accounts.owner.id + ':' + cardDraft.id,
    ])).rows[0];
    assert.doesNotMatch(JSON.stringify(storedCardPost),/card-media|\?token=/);

    lostPublish=false;
    const threads = await connectProvider('owner','threads','2731','owner-app-key');
    const cardThreads = (await api('owner',{action:'save',accountId:threads.id,title:'카드뉴스 스레드',body:'내 카드뉴스',cardId:card.id,cardSlide:1})).post;
    await due('owner',(await approve('owner',cardThreads)).post.id);
    holdMedia=true;
    assert.equal((await runPersonalSocial()).published,0);
    assert.equal(signedImageRequests,2);
    await due('owner',cardThreads.id,true);
    holdMedia=false;
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal(signedImageRequests,2,'rechecking an existing container does not mint a new signed URL');
    attachedCard=null;

    const channel = await connectProvider('owner','youtube','owner-google.apps.googleusercontent.com');
    const youtubeInput = {action:'save',accountId:channel.id,title:youtube.title,body:youtube.body,videoId:youtube.id,madeForKids:false,synthetic:true};
    await api('owner',{...youtubeInput,cardId:card.id,cardSlide:0},400);
    const youtubeDraft = (await api('owner',youtubeInput)).post;
    await due('owner',(await approve('owner',youtubeDraft)).post.id);
    videoOwner = 'UC' + 'B'.repeat(22);
    assert.equal((await runPersonalSocial()).review,1,'the granted account must own the selected Studio video');
    assert.equal(remote.filter(r=>r.host==='www.googleapis.com'&&r.method==='PUT').length,0);
    videoOwner = youtube.userId;
    const youtubeReview = (await state('owner')).posts.find((post: {id:string})=>post.id===youtubeDraft.id);
    await due('owner',(await approve('owner',youtubeReview)).post.id);
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal((await state('owner')).posts.find((post: {id:string})=>post.id===youtubeDraft.id).link,'https://www.youtube.com/watch?v='+youtube.id);

    const x = await connectProvider('owner','x','x-project-id');
    const xInput = {action:'save',accountId:x.id,title:'개인 X',body:'내 개인 X 게시'};
    await api('owner',{...xInput,body:'한'.repeat(141)},400);
    await api('owner',{...xInput,cardId:card.id,cardSlide:0},400);
    const xDraft = (await api('owner',xInput)).post;
    await due('owner',(await approve('owner',xDraft)).post.id);
    assert.equal((await runPersonalSocial()).published,1);
    assert.equal((await state('owner')).posts.find((post: {id:string})=>post.id===xDraft.id).link,'https://x.com/i/web/status/9992');
  } finally {
    global.fetch = previous.fetch;
    global.nhPool = previous.pool;
    for (const [key,value] of Object.entries(previous.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.close();
  }
});
