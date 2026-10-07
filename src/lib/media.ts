import sharp from 'sharp';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {Database} from './db';
import {MarketError} from './security';
import {audit} from './commerce';
import {storage} from './storage';
export const mediaDirectory=()=>path.join(process.cwd(),'.data','media');
export async function normalizeImage(bytes:Buffer){if(!bytes.length||bytes.length>4_000_000)throw new MarketError('4MB 이하 이미지를 선택해주세요.');const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!jpeg&&!png&&!webp)throw new MarketError('JPG·PNG·WebP 정지 이미지만 지원합니다.');try{const input=sharp(bytes,{limitInputPixels:20_000_000}),meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new MarketError('JPG·PNG·WebP 정지 이미지만 지원합니다.');return await input.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch(error){if(error instanceof MarketError)throw error;throw new MarketError('이미지 형식 또는 픽셀 한도를 확인해주세요.');}}
async function saveMedia(db:Database,bytes:Buffer,extension:string,mime:string){const id=randomUUID(),directory=mediaDirectory(),name=`${id}.${extension}`,file=path.join(directory,name),cloud=!!process.env.DATABASE_URL;if(cloud){const result=await storage(name,'POST',bytes,mime);if(!result.ok)throw new MarketError('파일 저장소 업로드를 다시 시도해주세요.',503);}else{await mkdir(directory,{recursive:true});await writeFile(file,bytes,{flag:'wx'});}try{await db.transaction(async tx=>{await tx.query('INSERT INTO mkt_media(id,mime,size) VALUES($1,$2,$3)',[id,mime,bytes.length]);await audit(tx,'media.uploaded',`${id} / ${bytes.length}bytes / metadata stripped`);});}catch(error){if(cloud)await storage(name,'DELETE').catch(()=>{});else await unlink(file);throw error;}return {id,url:`/api/media/${name}`,mime,size:bytes.length};}
export async function uploadImage(db:Database,bytes:Buffer){return saveMedia(db,await normalizeImage(bytes),'webp','image/webp');}
export function normalizeAudio(bytes:Buffer){
 if(bytes.length<44||bytes.length>2_000_000||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw new MarketError('2MB 이하의 PCM WAV 파일을 선택해주세요.');
 let fmt:Buffer|undefined,data:Buffer|undefined,pos=12;
 while(pos+8<=bytes.length){const name=bytes.toString('ascii',pos,pos+4),length=bytes.readUInt32LE(pos+4),start=pos+8;if(start+length>bytes.length)throw new MarketError('손상된 WAV 파일입니다.');if(name==='fmt '){if(fmt)throw new MarketError('중복 음원 형식입니다.');fmt=bytes.subarray(start,start+length);}if(name==='data'){if(data)throw new MarketError('중복 음원 데이터입니다.');data=bytes.subarray(start,start+length);}pos=start+length+(length%2);}
 if(pos!==bytes.length||!fmt||fmt.length<16||!data?.length||fmt.readUInt16LE(0)!==1)throw new MarketError('압축되지 않은 PCM WAV만 지원합니다.');
 const channels=fmt.readUInt16LE(2),rate=fmt.readUInt32LE(4),byteRate=fmt.readUInt32LE(8),align=fmt.readUInt16LE(12),bits=fmt.readUInt16LE(14);
 if(![1,2].includes(channels)||rate<8000||rate>96000||![8,16,24,32].includes(bits)||align!==channels*bits/8||byteRate!==rate*align||data.length%align||data.length/byteRate>5)throw new MarketError('1~2채널·5초 이하의 PCM WAV를 사용해주세요.');
 const result=Buffer.alloc(44+data.length+(data.length%2));result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);result.writeUInt32LE(16,16);fmt.copy(result,20,0,16);result.write('data',36);result.writeUInt32LE(data.length,40);data.copy(result,44);return result;
}
export async function uploadAudio(db:Database,bytes:Buffer){return saveMedia(db,normalizeAudio(bytes),'wav','audio/wav');}
