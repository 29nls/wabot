export interface GroupMetadataParticipant {
  id: string;
  admin?: 'admin' | 'superadmin' | null;
}

export interface GroupMetadata {
  participants?: GroupMetadataParticipant[];
}

export function isParticipantAdmin(metadata: GroupMetadata, userJid: string): boolean {
  const participant = metadata.participants?.find((item) => item.id === userJid);
  return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}

export function isBotAdmin(metadata: GroupMetadata, botJid: string): boolean {
  return isParticipantAdmin(metadata, botJid);
}

export class AdminCache {
  private readonly cache = new Map<string, { metadata: GroupMetadata; expiresAt: number }>();

  constructor(private readonly ttlMs = 60_000) {}

  get(groupJid: string): GroupMetadata | null {
    const entry = this.cache.get(groupJid);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(groupJid);
      return null;
    }
    return entry.metadata;
  }

  set(groupJid: string, metadata: GroupMetadata): void {
    this.cache.set(groupJid, { metadata, expiresAt: Date.now() + this.ttlMs });
  }
}