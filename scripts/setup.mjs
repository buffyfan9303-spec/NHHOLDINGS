import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 이상이 필요합니다.');
if(!existsSync('.env.local')){const template=readFileSync('.env.example','utf8').replace(/^SESSION_SECRET=.*$/m,`SESSION_SECRET=${randomBytes(32).toString('hex')}`).replace(/^CRON_SECRET=.*$/m,`CRON_SECRET=${randomBytes(32).toString('hex')}`);writeFileSync('.env.local',template,{flag:'wx'});console.log('.env.local을 만들었습니다. Supabase 연결값과 운영자 UUID를 입력해주세요.');}else console.log('기존 .env.local 설정을 사용합니다.');
console.log('스토어 http://127.0.0.1:3120 / 로그인 /login / 통합 /dashboard / 쇼핑몰 관리 /nurimarket/admin');
