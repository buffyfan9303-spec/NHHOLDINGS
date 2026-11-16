// NHHOLDINGS 가드 — 취향은 막지 않고 확정적으로 틀린 것(비밀 노출·운영 개시 우회)만 막는다.
import { readFileSync } from 'node:fs'
const BSLASH = String.fromCharCode(92)
let data
try { data = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const ti = data.tool_input || {}
const file = String(ti.file_path || '').split(BSLASH).join('/')
let content = ti.content ?? ti.new_string ?? ''
if (Array.isArray(ti.edits)) content += '\n' + ti.edits.map((e) => e?.new_string ?? '').join('\n')
if (!content) process.exit(0)
const isCode = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)
const isClient = /(^|\/)src\/components\//.test(file) || /(^|\/)public\//.test(file)
const rules = [
  { block: true, when: /(^|\/)\.private\//.test(file), re: /[\s\S]*/, msg: '.private/는 비밀·운영 자료 폴더다. 수정 금지.' },
  { block: true, when: isClient, re: /SUPABASE_SERVICE_ROLE_KEY|SESSION_SECRET|CRON_SECRET|DATABASE_URL|TOSS_SECRET_KEY|SOURCE_[A-Z]+_DATABASE_URL/, msg: 'src/components와 public/은 브라우저로 제공된다. 비밀 환경변수 참조는 공개와 같다. 서버 코드(src/lib, src/server, src/app/api)에서만 다룬다.' },
  { block: true, when: true, re: /(test|live)_sk_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{10,}|eyJhbGciOi[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\./, msg: '비밀 키·토큰이 코드·문서에 들어간다. 환경변수(.env.local, Vercel 설정)에만 둔다.' },
  { block: true, when: isCode, re: /process\.env\.(LIVE_APPROVED|MARKET_MODE|NODE_ENV)\s*=[^=]/, msg: '코드에서 운영 모드·개시 승인을 바꾸면 게이트를 우회한다. 실결제 개시는 사용자 지시와 운영 검증 뒤 환경변수로만 한다.' },
  { block: true, when: true, re: /reuseExistingServer:\s*true/, msg: 'reuseExistingServer: true 금지 — 고아 서버가 옛 빌드를 서빙해 E2E가 오래된 코드를 검사한 사고가 있었다.' },
  { block: false, when: isCode, re: /console\.(log|info|debug)\([^)]*(phone|address|email|accessKey|password|token)/i, msg: '고객 개인정보·접근키·비밀번호·토큰을 로그에 남기지 않는다.' },
]
let blocked = false
for (const r of rules) {
  if (!r.when || !r.re.test(content)) continue
  process.stderr.write((r.block ? 'BLOCK: ' : 'NOTE: ') + r.msg + '\n')
  if (r.block) blocked = true
}
process.exit(blocked ? 2 : 0)
