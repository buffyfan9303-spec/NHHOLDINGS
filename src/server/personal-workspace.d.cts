export type PersonalKind = 'task' | 'schedule' | 'note' | 'link';

export interface PersonalDraft {
  kind: PersonalKind;
  title: string;
  detail: string;
  dueOn: string | null;
  dueTime: string | null;
  done: boolean;
}

export interface PersonalItem extends PersonalDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const uuidPattern: RegExp;

export function personalWorkspace(ownerId: string): {
  list(): Promise<PersonalItem[]>;
  get(id: string): Promise<PersonalItem | null>;
  create(draft: PersonalDraft, id?: string): Promise<PersonalItem | null>;
  update(previous: PersonalItem, draft: PersonalDraft): Promise<PersonalItem | null>;
  remove(id: string, version: number): Promise<boolean>;
};
