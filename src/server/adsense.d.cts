export const scope:string,domain:string;
export function authorization(config:any,flow:{state:string;verifier:string;redirectUri:string}):string;
export function exchange(config:any,flow:{code:string;verifier:string;redirectUri:string},request?:typeof fetch):Promise<any>;
export function accounts(config:any,request?:typeof fetch):Promise<any[]>;
export function parseReport(input:any,range:{startDate:string;endDate:string}):any;
export function parsePayments(input:any,account:string):any[];
