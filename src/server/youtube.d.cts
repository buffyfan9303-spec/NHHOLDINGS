import type {SocialIdentity, SocialToken} from './social.cjs';

export function videoId(value: unknown): string;
export function validMetadata(title: string, description: string): boolean;
export function publish(
  post: {youtubeVideoId: string; title: string; body: string; youtubeMadeForKids: boolean; youtubeSynthetic: boolean},
  account: SocialIdentity,
  config: SocialToken,
  request?: typeof fetch,
  beforeWrite?: () => void | Promise<void>,
): Promise<{externalId: string; link: string}>;
