# Third-party assets and provider references

Checked 2026-10-07. Scope: NURI ONE / MARKET local assets and public integration reference data. Owner: asset/catalog agent; UI, auth and provider activation belong to the implementation owner.

| Included files | Official source revision | License |
| --- | --- | --- |
| `public/assets/icons/` — 41 original SVGs | [Lucide 1fae58d](https://github.com/lucide-icons/lucide/tree/1fae58d0a9c661a338036838caf3399b5507bab6) | [Full ISC and inherited Feather MIT notices](public/licenses/lucide-LICENSE.txt) |
| `public/assets/emoji/` — 8 original Color SVGs | [Microsoft Fluent Emoji 1ffb34c](https://github.com/microsoft/fluentui-emoji/tree/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc) | [Full MIT license](public/licenses/fluent-emoji-LICENSE.txt) |

These licenses permit commercial use and redistribution with their notices. Retain the complete license files with distributed copies; no trademark endorsement is implied. SVGs are unmodified upstream files. [Manifest](public/assets/manifest.json) records each exact source URL, revision and SHA-256. Only the useful subset was downloaded, without packages, photos or video.

`src/lib/integration-catalog.ts` holds 12 public provider references, requirements and pricing caveats; it contains no credentials. `existing-code` means code exists, not successful provider authentication. Other APIs require setup; Tistory is manual-only because its [official Open API was discontinued](https://notice.tistory.com/2664). Commercial deployment cannot use [Vercel Hobby](https://vercel.com/docs/plans/hobby). X, Anthropic and OpenAI APIs incur usage charges. Meta developer pages were unavailable to this fetch; official Meta-owned Postman documentation confirmed account/token requirements, but pricing and live access remain unverified.

Tool availability: existing Node CLI, PowerShell, GitHub public REST/raw endpoints and web search were sufficient and successfully used. MCP/connectors were inventoried; no plugin installation, new dependency, hook, automation, account or paid API call was needed. GPT-6.1 with medium reasoning handled license/cost distinctions; repetitive transfer used Node built-ins. No live service was activated and no production deployment was performed.

Validation on 2026-10-07: PowerShell `XmlDocument.LoadXml`, `Get-FileHash -Algorithm SHA256` and prohibited-content checks passed for all 49 manifest assets; both complete upstream licenses are retained. `npm run typecheck` passed. Provider authentication, publish calls and deployed UI consumption were not tested by this asset task. Provider pricing is a dated reference and must be rechecked before activation. Alternative when credentials or approval are missing: retain the manual workflow and links.

`public/brand/nuri-{one,market}{,-light}.svg` contains original project wordmark paths. These are not third-party logos and do not load or redistribute a font. Login, dashboard and storefront use the same vector geometry with background-specific colors.
