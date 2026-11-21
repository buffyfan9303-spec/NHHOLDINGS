import {authorizationMetadata} from '@/lib/personal-connector';
export const dynamic='force-dynamic';
export const GET=()=>Response.json(authorizationMetadata());
