declare module '*.cjs' {
 export function controller(options:{demo?:boolean;collect?:(source:{id:string})=>Promise<unknown>}):Promise<{handle:(req:Request,route:string,input:Record<string,unknown>,email:string)=>Promise<Response>;view:()=>unknown;refresh:()=>Promise<void>;tick:()=>Promise<void>}>;
 export function pool():import('pg').Pool;
}
