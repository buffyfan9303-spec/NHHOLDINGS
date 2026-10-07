import ExcelJS from 'exceljs';
import {inflateRawSync} from 'node:zlib';
import {MarketError} from './security';
export type InvoiceRow={orderNumber:string;carrier:string;trackingNumber:string};
export function checkZip(buffer:Buffer){
 if(buffer.length>3_000_000||buffer.length<22)throw new MarketError('3MB 이하의 XLSX 파일을 사용해주세요.');
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0)throw new MarketError('지원하지 않는 XLSX 압축 형식입니다.');
 const entries=buffer.readUInt16LE(end+10);let pos=buffer.readUInt32LE(end+16),size=0;
 if(entries>128||!entries)throw new MarketError('XLSX 파일 구성 한도를 초과했습니다.');
 for(let i=0;i<entries;i++){if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw new MarketError('손상된 XLSX 파일입니다.');const expected=buffer.readUInt32LE(pos+24),compressed=buffer.readUInt32LE(pos+20),offset=buffer.readUInt32LE(pos+42),method=buffer.readUInt16LE(pos+10);size+=expected;if(size>12_000_000||buffer.readUInt16LE(pos+8)&1)throw new MarketError('압축 해제 한도 초과 또는 암호화된 XLSX 파일입니다.');const n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),name=buffer.subarray(pos+46,pos+46+n).toString('utf8');if(/vbaProject|externalLinks|\.\.\//i.test(name))throw new MarketError('매크로·외부 링크 파일은 허용하지 않습니다.');
  if(offset+30>buffer.length||buffer.readUInt32LE(offset)!==0x04034b50||![0,8].includes(method))throw new MarketError('지원하지 않는 XLSX 압축 형식입니다.');const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);if(start+compressed>buffer.length)throw new MarketError('손상된 XLSX 압축 데이터입니다.');let actual:Buffer;try{actual=method===8?inflateRawSync(buffer.subarray(start,start+compressed),{maxOutputLength:Math.min(expected+1,12_000_001)}):buffer.subarray(start,start+compressed);}catch{throw new MarketError('실제 압축 해제 한도를 초과했습니다.');}if(actual.length!==expected||(/\.(xml|rels)$/.test(name)&&/<!DOCTYPE|<!ENTITY/i.test(actual.toString('utf8'))))throw new MarketError('손상된 크기 정보 또는 외부 엔티티 파일입니다.');pos+=46+n+extra+comment;}
}
export async function parseInvoices(buffer:Buffer):Promise<InvoiceRow[]>{
 checkZip(buffer);const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(buffer as never);}catch{throw new MarketError('XLSX 파일을 읽을 수 없습니다.');}
 if(workbook.worksheets.length!==1)throw new MarketError('단일 시트의 송장 양식을 사용해주세요.');const sheet=workbook.worksheets[0];if(sheet.rowCount>501||sheet.columnCount>20)throw new MarketError('최대 500행·20열까지만 지원합니다.');
 const headers:Record<string,number>={};sheet.getRow(1).eachCell((cell,col)=>{headers[cell.text.trim()]=col;});const cols=['주문번호','택배사','송장번호'].map((v,i)=>headers[v]??headers[['orderNumber','carrier','trackingNumber'][i]]);if(cols.some(x=>!x))throw new MarketError('주문번호·택배사·송장번호 헤더가 필요합니다.');
 const result:InvoiceRow[]=[];for(let i=2;i<=sheet.rowCount;i++){const cells=cols.map(col=>sheet.getRow(i).getCell(col));if(cells.every(c=>!c.text.trim()))continue;if(cells.some(c=>c.type===ExcelJS.ValueType.Formula||c.type===ExcelJS.ValueType.Hyperlink||c.type===ExcelJS.ValueType.Error))throw new MarketError(`${i}행: 수식·링크 대신 텍스트를 입력해주세요.`);result.push({orderNumber:cells[0].text.trim(),carrier:cells[1].text.trim(),trackingNumber:cells[2].text.trim()});}if(!result.length)throw new MarketError('송장 데이터가 없습니다.');return result;
}
export async function workbookBuffer(headers:string[],rows:unknown[][]){const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('NURI MARKET');sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true};sheet.columns.forEach((column,index)=>{column.width=index>4?35:22;column.numFmt='@';});sheet.views=[{state:'frozen',ySplit:1}];return Buffer.from(await wb.xlsx.writeBuffer());}
