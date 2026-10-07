'use strict';
const crypto=require('node:crypto');
const {pool}=require('./postgres.cjs');
async function context(workspace){
 if(!['live','sample'].includes(workspace))throw new Error('Workspace invalid');
 let connection;const q=(sql,args=[])=> (connection||pool()).query(sql,args);
 const documents=new Map();let money=[],audits=[];
 const key=(kind,id)=>JSON.stringify([kind,id]);
 async function reload(){documents.clear();for(const r of (await q('SELECT kind,id,data,updated FROM nh_documents WHERE workspace=$1 ORDER BY updated DESC',[workspace])).rows)documents.set(key(r.kind,r.id),r);money=(await q("SELECT * FROM nh_money WHERE workspace=$1 ORDER BY day DESC,id",[workspace])).rows.map(({workspace,...r})=>({...r,day:typeof r.day==='string'?r.day.slice(0,10):r.day.toISOString().slice(0,10),amount:Number(r.amount)}));audits=(await q('SELECT id,at,email,action,target FROM nh_audit WHERE workspace=$1 ORDER BY id DESC LIMIT 100',[workspace])).rows.map(r=>({...r,id:Number(r.id),at:r.at.toISOString()}));}
 await reload();
 const get=(kind,id)=>{const row=documents.get(key(kind,id));return row?structuredClone(row.data):null;};
 const list=kind=>[...documents.values()].filter(r=>r.kind===kind).sort((a,b)=>new Date(b.updated)-new Date(a.updated)).map(r=>({id:r.id,...structuredClone(r.data)}));
 async function put(kind,id,data){const old=documents.get(key(kind,id));const result=old?await q('UPDATE nh_documents SET data=$4,updated=now() WHERE workspace=$1 AND kind=$2 AND id=$3 AND data=$5::jsonb RETURNING updated',[workspace,kind,id,JSON.stringify(data),JSON.stringify(old.data)]):await q('INSERT INTO nh_documents(workspace,kind,id,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING updated',[workspace,kind,id,JSON.stringify(data)]);if(result.rowCount!==1)throw Object.assign(new Error('다른 작업에서 변경했습니다. 새로고침 후 다시 저장해주세요.'),{status:409});documents.set(key(kind,id),{kind,id,data:structuredClone(data),updated:result.rows[0].updated});}
 async function audit(email,action,target){await q('INSERT INTO nh_audit(workspace,email,action,target) VALUES($1,$2,$3,$4)',[workspace,email,action,target]);}
 async function transaction(fn){if(connection)throw new Error('Nested transaction');connection=await pool().connect();try{await connection.query('BEGIN');const result=await fn();await connection.query('COMMIT');return result;}catch(e){await connection.query('ROLLBACK');await reload();throw e;}finally{connection.release();connection=undefined;}}
 async function recordMoney(values){await q('INSERT INTO nh_money(workspace,id,day,service,business,kind,amount,category,partner,reference,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[workspace,...values]);}
 async function voidMoney(id){const r=await q('UPDATE nh_money SET voided=1 WHERE workspace=$1 AND id=$2 AND voided=0 RETURNING id',[workspace,id]);if(r.rowCount!==1)throw Object.assign(new Error('거래가 이미 변경됐습니다.'),{status:409});}
 const findMoney=id=>money.find(r=>r.id===id&&!r.voided);
 const secret=process.env.SESSION_SECRET;if(!secret||secret.length<32)throw new Error('서버 보안 키가 필요합니다.');const secretKey=crypto.createHash('sha256').update(secret).digest();
 const encrypt=v=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secretKey,iv);return Buffer.concat([iv,cipher.update(JSON.stringify(v)),cipher.final(),cipher.getAuthTag()]).toString('base64');};
 const decrypt=v=>{const b=Buffer.from(v,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',secretKey,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString('utf8'));};
 return {workspace,get,list,put,audit,transaction,recordMoney,voidMoney,findMoney,encrypt,decrypt,reload,get money(){return money;},get audits(){return audits;}};
}
module.exports={context};
