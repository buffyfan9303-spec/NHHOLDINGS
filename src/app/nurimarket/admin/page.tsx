import {cookies} from 'next/headers';
import {NextRequest} from 'next/server';
import {redirect} from 'next/navigation';
import {identity,isOwner} from '@/lib/auth';
import Admin from '@/components/admin';
export const dynamic='force-dynamic';
export default async function Page(){const req=new NextRequest('https://nhholdings.xyz',{headers:{cookie:(await cookies()).toString()}}),user=await identity(req);if(!user)redirect('/login');if(!isOwner(user))redirect('/nurimarket');return <Admin/>;}
