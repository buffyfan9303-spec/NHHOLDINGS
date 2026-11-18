export const chunkSize: number;
export const maxSize: number;
interface UploadStatus {
  id: string;
  received: number;
  size: number;
  videoId: string | null;
  studioUrl: string | null;
  chunkSize: number;
}
export function begin(context: unknown, owner: string, input: Record<string, unknown>): Promise<UploadStatus>;
export function transfer(context: unknown, owner: string, id: unknown, offset: number | null, bytes: Buffer | null): Promise<UploadStatus>;
