export interface SocialApp {
  clientId: string;
  clientSecret: string;
  version?: string;
}

export interface SocialToken extends SocialApp {
  token: string;
  refreshToken?: string;
  issuedAt: string;
  expiresAt: string;
  authType: 'oauth2';
  analytics?: boolean;
  comments?: boolean;
}

export interface SocialIdentity {
  userId: string;
  username: string;
}

interface Flow {
  verifier: string;
  redirectUri: string;
  analytics?: boolean;
  comments?: boolean;
}

export const providers: Record<string, {name: string; scopes: readonly string[]; authorize: string; token: string; docs: string}>;
export function authorization(provider: string, app: SocialApp, flow: Flow & {state: string}): string;
export function exchange(provider: string, app: SocialApp, flow: Flow & {code: string}, request?: typeof fetch): Promise<SocialToken>;
export function refresh(provider: string, token: SocialToken, request?: typeof fetch): Promise<SocialToken>;
export function identity(provider: string, token: SocialToken, request?: typeof fetch): Promise<SocialIdentity>;
