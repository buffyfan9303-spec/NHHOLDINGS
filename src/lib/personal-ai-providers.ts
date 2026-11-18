import {pool} from '@/server/postgres.cjs';
import {uuidPattern} from '@/server/personal-workspace.cjs';
import {MarketError, seal, textValue, unseal} from './security';

const names = {openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini'} as const;
export type PersonalAIProvider = keyof typeof names;
export type PersonalAIMessage = {role: 'system' | 'user' | 'assistant'; content: string};
type AIOptions = {signal?: AbortSignal; model?: string};
type Settings = {ownerId: string; model: string; secret: string; version: number};
type AIConfig = {model: string; apiKey: string};
type Json = Record<string, unknown>;

const providerIds = Object.keys(names) as PersonalAIProvider[];
const owned = "workspace='live' AND kind='personal-ai-provider' AND id=$1 AND data->>'ownerId'=$2";
const savedRequired = () => new MarketError('개인 AI API 키와 모델을 먼저 연결해 주세요.', 409);
const upstreamFailure = () => new MarketError('AI 제공자의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
const interrupted = () => new MarketError('AI 응답이 완료되지 않았습니다. 다시 시도해 주세요.', 502);
const refused = () => new MarketError('선택한 AI 모델에서 이 요청의 답변을 생성하지 못했습니다.', 422);
const outputLimit = 4_096;
const maxStreamEvent = 400_000;
const maxResponseBytes = 1_000_000;
const modelPattern = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;

export function isPersonalAIProvider(input: unknown): input is PersonalAIProvider {
  return typeof input === 'string' && Object.hasOwn(names, input);
}

function modelId(input: unknown) {
  const value = textValue(input, '모델 ID', 120);
  if (!modelPattern.test(value)) throw new MarketError('제공자의 모델 ID를 확인해 주세요.');
  return value;
}

function providerKey(input: unknown) {
  const value = textValue(input, 'API 키', 2000);
  if (!/^[!-~]{6,2000}$/.test(value)) throw new MarketError('발급받은 API 키를 확인해 주세요.');
  return value;
}

function key(actor: string, provider: PersonalAIProvider) {
  if (!uuidPattern.test(actor)) throw new MarketError('개인 업무 공간 접근 승인이 필요합니다.', 403);
  if (!isPersonalAIProvider(provider)) throw new MarketError('AI 제공자를 선택해 주세요.');
  return [actor + ':' + provider, actor];
}

async function settings(actor: string, provider: PersonalAIProvider) {
  const {rows} = await pool().query<{data: Settings}>(
    'SELECT data FROM nh_documents WHERE ' + owned, key(actor, provider),
  );
  return rows[0]?.data ?? null;
}

function credential(saved: Settings | null): AIConfig {
  if (!saved || typeof saved.model !== 'string' || !modelPattern.test(saved.model)) throw savedRequired();
  try {
    return {model: saved.model, apiKey: providerKey(unseal(saved.secret))};
  } catch {
    throw savedRequired();
  }
}

export async function assertPersonalAIConfigured(actor: string, provider: PersonalAIProvider) {
  credential(await settings(actor, provider));
}

export async function listPersonalAIProviders(actor: string) {
  if (!uuidPattern.test(actor)) throw new MarketError('개인 업무 공간 접근 승인이 필요합니다.', 403);
  const {rows} = await pool().query<{id: string; data: Settings}>(
    "SELECT id,data FROM nh_documents WHERE workspace='live' AND kind='personal-ai-provider' AND id LIKE $1 AND data->>'ownerId'=$2",
    [actor + ':%', actor],
  );
  const stored = new Map(rows.map(row => [row.id, row.data]));
  return {
    providers: providerIds.map(id => {
      const saved = stored.get(actor + ':' + id);
      try {
        const {model} = credential(saved ?? null);
        return {id, name: names[id], configured: true, model};
      } catch {
        return {id, name: names[id], configured: false, model: typeof saved?.model === 'string' && modelPattern.test(saved.model) ? saved.model : null};
      }
    }),
  };
}

export async function changePersonalAIProvider(actor: string, input: Json) {
  const provider = input.provider;
  if (!isPersonalAIProvider(provider)) throw new MarketError('AI 제공자를 선택해 주세요.');
  const owner = key(actor, provider);
  if (input.action === 'remove') {
    await pool().query('DELETE FROM nh_documents WHERE ' + owned, owner);
    return listPersonalAIProviders(actor);
  }
  if (input.action !== 'save') throw new MarketError('AI 연결 설정 작업을 확인해 주세요.');
  const model = modelId(input.model);
  const old = await settings(actor, provider);
  let secret: string;
  if (input.apiKey === undefined || input.apiKey === '') {
    if (!old) throw savedRequired();
    credential(old);
    secret = old.secret;
  } else {
    secret = seal(providerKey(input.apiKey));
  }
  const data: Settings = {ownerId: actor, model, secret, version: (old?.version ?? 0) + 1};
  const result = old
    ? await pool().query("UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE " + owned + " AND data->>'version'=$4 RETURNING id",
        [...owner, JSON.stringify(data), String(old.version)])
    : await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-ai-provider',$1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [owner[0], JSON.stringify(data)]);
  if (!result.rows.length) throw new MarketError('AI 연결이 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 409);
  return listPersonalAIProviders(actor);
}

function checkedMessages(messages: readonly PersonalAIMessage[]) {
  if (!Array.isArray(messages) || messages.length > 80 ||
      !messages.every(message => message && ['system','user','assistant'].includes(message.role) &&
        typeof message.content === 'string' && !!message.content.trim()) ||
      !messages.some(message => message.role === 'user') ||
      messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0) > 100_000) {
    throw new MarketError('AI에 전달할 메시지와 길이를 확인해 주세요.');
  }
  return {
    system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
    turns: messages.filter(message => message.role !== 'system'),
  };
}

function requestOptions(provider: PersonalAIProvider, {model, apiKey}: AIConfig, messages: readonly PersonalAIMessage[], stream: boolean) {
  const {system, turns} = checkedMessages(messages);
  const headers: Record<string, string> = {'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json'};
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: {...headers, Authorization: 'Bearer ' + apiKey},
      body: {model, stream, store:false, max_output_tokens:outputLimit, ...(system && {instructions:system}), input:turns},
    };
  }
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {...headers, 'x-api-key':apiKey, 'anthropic-version':'2023-06-01'},
      body: {model, stream, max_tokens:outputLimit, ...(system && {system}), messages:turns},
    };
  }
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) +
      (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'),
    headers: {...headers, 'x-goog-api-key':apiKey},
    body: {
      ...(system && {systemInstruction:{parts:[{text:system}]}}),
      contents: turns.map(({role, content}) => ({role:role === 'assistant' ? 'model' : 'user',parts:[{text:content}]})),
      generationConfig:{maxOutputTokens:outputLimit},
    },
  };
}

function statusError(status: number) {
  if (status === 401 || status === 403) return new MarketError('API 키 또는 모델 사용 권한을 확인해 주세요.', 422);
  if ([400,404,422].includes(status)) return new MarketError('선택한 모델 ID와 API 키의 사용 가능 여부를 확인해 주세요.', 422);
  if (status === 402 || status === 429) return new MarketError('AI 제공자의 API 사용 한도와 결제 상태를 확인해 주세요.', status);
  return upstreamFailure();
}

function abortError(signal: AbortSignal, caller?: AbortSignal) {
  if (caller?.aborted) return new DOMException('AI 응답 요청이 취소되었습니다.', 'AbortError');
  if (signal.aborted) return new MarketError('AI 응답 대기 시간이 지났습니다. 다시 시도해 주세요.', 504);
  return null;
}

async function request(actor: string, provider: PersonalAIProvider, messages: readonly PersonalAIMessage[], input: AIOptions, stream: boolean) {
  if (input.signal?.aborted) throw new DOMException('AI 응답 요청이 취소되었습니다.', 'AbortError');
  const saved = credential(await settings(actor, provider));
  const config = {...saved, model:input.model === undefined ? saved.model : modelId(input.model)};
  const {url, headers, body} = requestOptions(provider, config, messages, stream);
  const timeout = AbortSignal.timeout(65_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {method:'POST', headers, body:JSON.stringify(body), signal, cache:'no-store', redirect:'error'});
  } catch {
    throw abortError(signal, input.signal) ?? upstreamFailure();
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw statusError(response.status);
  }
  return {response, signal};
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value.map(object) : [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function candidate(event: Json) {
  return array(event.candidates)[0] ?? {};
}

function geminiText(choice: Json) {
  return array(object(choice.content).parts).filter(part => part.thought !== true).map(part => text(part.text)).join('');
}

function parseOutput(provider: PersonalAIProvider, result: Json) {
  if (result.error) throw upstreamFailure();
  if (provider === 'openai') {
    if (result.status !== 'completed') throw interrupted();
    return array(result.output).filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => array(item.content)).filter(item => item.type === 'output_text').map(item => text(item.text)).join('');
  }
  if (provider === 'anthropic') {
    if (result.stop_reason !== 'end_turn' && result.stop_reason !== 'stop_sequence') {
      throw result.stop_reason === 'max_tokens' ? interrupted() : refused();
    }
    return array(result.content).filter(item => item.type === 'text').map(item => text(item.text)).join('');
  }
  const choice = candidate(result);
  if (choice.finishReason !== 'STOP') throw choice.finishReason === 'MAX_TOKENS' ? interrupted() : refused();
  return geminiText(choice);
}

async function boundedJson(response: Response) {
  if (!response.body) throw upstreamFailure();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) throw upstreamFailure();
      json += decoder.decode(value, {stream:true});
    }
    return object(JSON.parse(json + decoder.decode()));
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function generatePersonalAI(actor: string, provider: PersonalAIProvider, messages: readonly PersonalAIMessage[], options: AIOptions = {}) {
  const {response, signal} = await request(actor, provider, messages, options, false);
  try {
    const output = parseOutput(provider, await boundedJson(response));
    if (!output.trim()) throw refused();
    return output;
  } catch (error) {
    throw abortError(signal, options.signal) ?? (error instanceof MarketError ? error : upstreamFailure());
  }
}

async function* events(response: Response) {
  if (!response.body || !/^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type') ?? '')) {
    void response.body?.cancel().catch(() => undefined);
    throw upstreamFailure();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let lines: string[] = [];
  let size = 0;
  let carry = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      let next = carry + (done ? decoder.decode() : decoder.decode(value, {stream:true}));
      carry = !done && next.endsWith('\r') ? '\r' : '';
      if (carry) next = next.slice(0,-1);
      lineBuffer += next.replaceAll('\r\n','\n').replaceAll('\r','\n');
      let end: number;
      while ((end = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0,end);
        lineBuffer = lineBuffer.slice(end+1);
        if (line === '') {
          if (lines.length) {
            const data = lines.join('\n');
            if (data !== '[DONE]') yield object(JSON.parse(data));
          }
          size = 0;
          lines = [];
        } else if (line.startsWith('data:') || line === 'data') {
          size += line.length;
          if (size > maxStreamEvent) throw upstreamFailure();
          lines.push(line.slice(5).replace(/^ /,''));
        }
      }
      if (lineBuffer.length > maxStreamEvent) throw upstreamFailure();
      if (done) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* streamPersonalAI(actor: string, provider: PersonalAIProvider, messages: readonly PersonalAIMessage[], options: AIOptions = {}) {
  const {response, signal} = await request(actor, provider, messages, options, true);
  let returnedBytes = 0;
  try {
    for await (const event of events(response)) {
      if (event.error || event.type === 'error' || event.type === 'response.failed') throw upstreamFailure();
      let delta = '';
      let complete = false;
      if (provider === 'openai') {
        if (event.type === 'response.incomplete') throw interrupted();
        if (event.type === 'response.output_text.delta') delta = text(event.delta);
        complete = event.type === 'response.completed';
      } else if (provider === 'anthropic') {
        const block = object(event.content_block);
        const fragment = object(event.delta);
        if (event.type === 'content_block_start' && block.type === 'text') delta = text(block.text);
        if (event.type === 'content_block_delta' && fragment.type === 'text_delta') delta = text(fragment.text);
        if (event.type === 'message_delta' && fragment.stop_reason && !['end_turn','stop_sequence'].includes(text(fragment.stop_reason))) {
          throw fragment.stop_reason === 'max_tokens' ? interrupted() : refused();
        }
        complete = event.type === 'message_stop';
      } else {
        const choice = candidate(event);
        const reason = choice.finishReason;
        if (object(event.promptFeedback).blockReason) throw refused();
        if (reason && reason !== 'STOP') throw reason === 'MAX_TOKENS' ? interrupted() : refused();
        delta = geminiText(choice);
        complete = reason === 'STOP';
      }
      if (delta) {
        returnedBytes += Buffer.byteLength(delta,'utf8');
        if (returnedBytes > maxResponseBytes) throw interrupted();
        yield delta;
      }
      if (complete) {
        if (!returnedBytes) throw refused();
        return;
      }
    }
    throw interrupted();
  } catch (error) {
    throw abortError(signal, options.signal) ?? (error instanceof MarketError ? error : upstreamFailure());
  }
}
