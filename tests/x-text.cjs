'use strict';
const assert=require('node:assert/strict');
const {repurpose,weight}=require('../src/server/content-tools.cjs');

assert.equal(weight('a'.repeat(280),'x'),280);
assert.equal(weight('a'.repeat(281),'x'),281);
assert.equal(weight('가'.repeat(140),'x'),280);
assert.equal(weight('https://example.com/'+ 'long-path/'.repeat(20),'x'),23);

const family='👨‍👩‍👧‍👦',flag='🇰🇷',url='https://example.com/'+ 'long-path/'.repeat(20);
const [draft]=repurpose({title:'제목',body:family+flag+'a'.repeat(1000),seo:{url,cta:'자세한 내용을 확인하세요.'}},['x']);
assert(weight(draft.body,'x')<=280);
assert(draft.body.includes(family));
assert(draft.body.includes(flag));
assert(draft.body.includes(url));
assert(!draft.body.includes('\uFFFD'));

const nfd='e\u0301'.repeat(1000),normalized=repurpose({title:'제목',body:nfd,seo:{url,cta:'a'.repeat(50)}},['x'])[0];
assert(weight(normalized.body,'x')<=280);
assert(normalized.body.includes('é'));
assert(!normalized.body.includes('e\u0301'));

const bodyURL='https://body.example/'+ 'long-path/'.repeat(20);
for(let padding=160;padding<=205;padding++){
 const boundary=repurpose({title:'제목',body:'a'.repeat(padding)+' '+family+flag+' '+bodyURL+' '+'z'.repeat(1000),seo:{url,cta:'a'.repeat(50)}},['x'])[0];
 assert(weight(boundary.body,'x')<=280);
 assert(!boundary.body.includes('z'.repeat(50)),'input must exercise truncation');
 assert(!boundary.body.includes('https://body.example')||boundary.body.includes(bodyURL));
 const remainder=boundary.body.replaceAll(family,'').replaceAll(flag,'');
 assert(!/[\uD800-\uDFFF\u200D\u{1F1E6}-\u{1F1FF}]/u.test(remainder));
}
console.log('PASS X weighted length, URL shortening, emoji clusters and repurposed limit');
