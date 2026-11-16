import type {MetadataRoute} from 'next';
import {marketOrigin} from '@/lib/security';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 let origin='';try{origin=marketOrigin();}catch{}
 return {rules:[{userAgent:'*',allow:'/',disallow:['/login','/dashboard','/access-pending','/reset-password','/api','/nurimarket/admin','/nurimarket/login','/admin','/one']}],...(origin?{sitemap:`${origin}/sitemap.xml`}:{})};
}
