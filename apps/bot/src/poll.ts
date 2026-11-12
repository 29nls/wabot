import type { WASocket } from '@whiskeysockets/baileys';

export interface PollSpec {
  question: string;
  options: string[];
}

/** Parse raw args like: "Pertanyaan" "Opsi A" "Opsi B". */
export function parsePollArgs(rawArgs: string): PollSpec | null {
  const matches = rawArgs.match(/"([^"]*)"/g);
  if (!matches || matches.length < 3) return null;
  const values = matches.map((m) => m.slice(1, -1).trim());
  const question = values[0];
  const options = values.slice(1);
  if (!question || options.length < 2 || options.length > 12) return null;
  if (options.some((o) => !o)) return null;
  return { question, options };
}

export async function sendPoll(sock: WASocket, jid: string, rawArgs: string): Promise<boolean> {
  const spec = parsePollArgs(rawArgs);
  if (!spec) return false;
  await sock.sendMessage(jid, {
    poll: { name: spec.question, values: spec.options, selectableCount: 1 }
  });
  return true;
}
