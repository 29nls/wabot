export interface SyncGroupInput {
  jid: string;
  name: string;
  member_count?: number;
  owner_jid?: string | null;
}

export async function syncGroupsOnce(
  syncFn: (groups: SyncGroupInput[], complete: boolean) => Promise<unknown>,
  groups: SyncGroupInput[],
  complete = true
): Promise<void> {
  await syncFn(groups, complete);
}