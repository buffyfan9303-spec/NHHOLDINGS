declare module '*.cjs' {
 export function controller(options:{demo?:boolean;collect?:(source:{id:string})=>Promise<unknown>}):Promise<{handle:(req:Request,route:string,input:Record<string,unknown>,email:string)=>Promise<Response>;view:()=>unknown;refresh:()=>Promise<void>;tick:()=>Promise<void>}>;
 export function pool():import('pg').Pool;
 export function context(workspace:'live'|'sample'):Promise<any>;
 export const SOURCES:{id:string;name:string}[];
 export const providers:Record<string,{name:string;scopes:readonly string[]}>;
 export function authorization(provider:string,config:any,flow:{state:string;verifier:string;redirectUri:string}):string;
 export function exchange(provider:string,config:any,flow:{code:string;verifier:string;redirectUri:string}):Promise<any>;
 export function identity(provider:string,config:any):Promise<{userId:string;username:string}>;
}
