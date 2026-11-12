import type { WASocket } from '@whiskeysockets/baileys';

export interface SchedulerDeps {
  api: ReturnType<typeof import('./api-client').createBotApiClient>;
  sock: () => WASocket | null;
  log: (msg: string) => void;
  intervalMs?: number;
}

export function startScheduler(deps: SchedulerDeps): () => void {
  const { api, sock, log } = deps;
  const intervalMs = deps.intervalMs ?? 60_000;
  let lastMaintenance = 0;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const data = await api.getSchedules();
      const schedules = data.schedules ?? [];
      for (const s of schedules) {
        const sck = sock();
        if (!sck) continue;
        try {
          await sck.sendMessage(s.group_jid, { text: s.message });
          await api.reportExecuted(s.id, true);
        } catch {
          try {
            await api.reportExecuted(s.id, false);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore transient */
    }

    // daily maintenance
    const now = Date.now();
    if (now - lastMaintenance > 24 * 60 * 60 * 1000) {
      lastMaintenance = now;
      try {
        await api.runMaintenance();
      } catch {
        /* ignore */
      }
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  // Tick pertama lebih cepat supaya jadwal jatuh tempo langsung terkirim.
  const firstTick = setTimeout(() => void tick(), Math.min(intervalMs, 5_000));

  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(firstTick);
  };
}
