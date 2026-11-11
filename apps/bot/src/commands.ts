export interface ParsedCommand {
  name: string;
  args: string[];
  rawArgs: string;
}

export function parseCommand(text: string, prefix: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!prefix || !trimmed.startsWith(prefix)) return null;
  const withoutPrefix = trimmed.slice(prefix.length).trim();
  if (!withoutPrefix) return null;
  const parts = withoutPrefix.split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { name, args, rawArgs: withoutPrefix.slice(name.length).trim() };
}

export const COMMAND_NAMES = [
  'menu',
  'ping',
  'id',
  'welcome',
  'setwelcome',
  'goodbye',
  'antilink',
  'antispam',
  'kick',
  'mute',
  'level',
  'top',
  'addcmd',
  'delcmd',
  'help'
] as const;