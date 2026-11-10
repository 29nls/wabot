# PRD — Wabot: Bot Grup WhatsApp Interaktif

| Atribut | Nilai |
| --- | --- |
| Nama produk | **Wabot** — bot grup WhatsApp interaktif + dashboard |
| Versi dokumen | 1.0 (Draft untuk implementasi) |
| Tanggal | 10 November 2026 |
| Status | Disetujui untuk dibangun (MVP) |
| Pemilik produk | Pemilik nomor bot (single-tenant) |
| Stack inti | `@whiskeysockets/baileys` (Node.js) + Cloudflare Worker, D1, R2 di domain `*.freebuff.page` |
| Metode login bot | **Pair code** (8 digit, tanpa QR) |

---

## 1. Ringkasan, Tujuan, dan Metrik

### 1.1 Ringkasan eksekutif

Wabot adalah bot WhatsApp untuk grup yang bisa diaktifkan hanya dengan **kode pairing 8 digit** — tanpa scan QR, tanpa aplikasi tambahan di HP. Setelah nomor tertaut, bot mengelola grup secara interaktif: menyambut anggota baru, menjaga grup dari spam dan tautan, menjalankan command, memberi XP/level, membuat poll, stiker, dan mini-games.

Seluruh **kontrol dan data** berada di website `*.freebuff.page`: dashboard untuk pairing, pengaturan per grup, kelola command, leaderboard, log, dan unggah aset (stiker/ikon grup) ke object storage. Runtime bot tetap berupa **daemon Node.js** karena Baileys memerlukan proses persisten dan penyimpanan kredensial lokal — hal ini tidak mungkin dijalankan di Worker (lihat §4.3).

### 1.2 Masalah yang diselesaikan

| Masalah | Dampak saat ini | Solusi Wabot |
| --- | --- | --- |
| Bot WhatsApp populer masih mengandalkan scan QR | Owner harus memegang HP setiap kali sesi terputus | Pair code 8 digit dari dashboard, bisa dilakukan admin lain |
| Pengaturan bot tersebar di file JSON di VPS | Sulit diubah, tidak ada audit, rawan salah edit | Dashboard terpusat, validasi form, audit log |
| Bot grup tidak punya data historis | XP, level, dan statistik grup hilang saat restart | State persisten di D1, buffer XP di daemon |
| Moderasi grup manual melelahkan | Admin harus memantau 24/7 | Anti-link, anti-spam, kick/mute otomatis + log |
| Belum ada cara aman menyimpan aset | Stiker/ikon menumpuk di host bot | Object storage R2 dengan URL publik terkontrol |

### 1.3 Tujuan produk (MVP)

1. Owner dapat menautkan nomor bot **hanya dengan pair code** dalam ≤ 2 menit, tanpa QR.
2. Sesi bertahan setelah restart: bot reconnect otomatis tanpa pairing ulang.
3. Admin grup dapat mengaktifkan fitur inti (welcome, anti-link, anti-spam, XP) dari dashboard tanpa menyentuh server.
4. Member grup mendapat pengalaman interaktif: command berprefix, poll, stiker, leaderboard, mini-games.
5. Semua konfigurasi, statistik, dan log dapat dilihat kembali di dashboard.

### 1.4 Non-goals (tidak dikerjakan di MVP)

- WhatsApp Business API resmi / pesan template berbayar.
- Broadcast massal ke nomor non-anggota (melanggar kebijakan WhatsApp dan berisiko ban).
- Chatbot AI/LLM, CRM, atau integrasi pembayaran.
- Multi-tenant (banyak owner, banyak nomor, billing) — arsitektur disiapkan, fitur tidak.
- Aplikasi mobile native.
- Tombol interaktif WhatsApp (lihat §11.2 — tidak stabil untuk akun personal).
- Custom domain di luar `*.freebuff.page`.

### 1.5 Metrik keberhasilan

| Metrik | Target MVP | Cara ukur |
| --- | --- | --- |
| Pairing success rate | ≥ 90% percobaan valid | Funnel `pair_requests` (code_ready → connected) |
| Waktu pairing (klik → connected) | median ≤ 90 detik | `completed_at - created_at` |
| Reconnect otomatis setelah restart host | 100% dalam ≤ 30 detik | Heartbeat + `reconnect_count` |
| Command sukses (bukan error) | ≥ 98% | `events` level=error vs total command |
| Latensi balasan command | p95 ≤ 2 detik | Timestamp masuk vs `sendMessage` |
| Grup aktif 7 hari setelah pairing | ≥ 3 grup | `groups.last_active_at` |
| Retensi owner setelah 14 hari | ≥ 70% | Login dashboard terakhir |
| Kuota free tier | 0 pelanggaran | Panel kuota Sites |

---

## 2. Pengguna dan Skenario

### 2.1 Persona

| Persona | Kebutuhan utama | Hambatan | Yang dilihat di Wabot |
| --- | --- | --- | --- |
| **Owner bot** (punya nomor) | Menautkan nomor sekali, memantau kesehatan bot | Takut sesi putus / nomor kena ban | Status koneksi, log, tombol logout, disclaimer risiko |
| **Admin grup** | Mengatur welcome, moderasi, command | Tidak paham server/CLI | Form pengaturan per grup, preview pesan |
| **Member grup** | Interaksi ringan, hiburan, info | Command tidak diketahui | `.menu`, leaderboard, poll, games |

### 2.2 User journey utama

**A. Pairing pertama kali**

1. Owner membuka dashboard → login password.
2. Klik **Hubungkan Bot** → memasukkan nomor bot (format `62812xxxx`, tanpa `+`).
3. Dashboard menampilkan kode 8 digit + hitung mundur.
4. Di HP: WhatsApp → **Perangkat Tertaut** → **Tautkan perangkat** → **Tautkan dengan nomor telepon** → masukkan kode.
5. Dashboard berubah menjadi **Terhubung**, menampilkan nama & JID bot.
6. Owner menambahkan bot ke grup (undang manual), grup muncul otomatis di dashboard.

**B. Mengaktifkan fitur grup**

1. Dashboard → **Grup** → pilih grup.
2. Tab **Penyambutan**: aktifkan welcome, tulis template, lihat preview, simpan.
3. Bot menerima konfigurasi baru dalam ≤ 10 detik, mengirim pesan selamat datang ke anggota berikutnya.

**C. Kejadian moderasi**

1. Member mengirim tautan judi.
2. Bot menghapus pesan, memberi peringatan, dan mencatat di `audit_log`.
3. Jika pelanggaran melewati ambang, bot mengeluarkan anggota dan mengirim laporan ke admin grup.

**D. Sesi bermasalah**

1. Host restart / internet putus → bot reconnect otomatis.
2. Jika logout permanen (mis. sesi dicabut dari HP), status berubah **Perlu Pairing Ulang**; kode pairing baru dapat diminta dari dashboard.

---

## 3. Lingkup Fitur

### 3.1 Prioritas P0 — wajib untuk rilis MVP

| ID | Fitur | Ringkasan |
| --- | --- | --- |
| FR-01 | Pairing via pair code | Minta kode, tampilkan, batalkan, ulangi; tanpa QR |
| FR-02 | Persistensi sesi & auto-reconnect | Reconnect setelah restart, backoff eksponensial |
| FR-03 | Status & heartbeat | Bot melapor kesehatan tiap 30 detik |
| FR-04 | Sinkronisasi grup | Daftar grup, metadata, jumlah anggota |
| FR-05 | Welcome & goodbye | Template dengan variabel, per grup |
| FR-06 | Command engine | Prefix `.` (dapat diubah), parser argumen, rate limit per user |
| FR-07 | Anti-link | Mode off/delete/kick, allowlist domain |
| FR-08 | Anti-spam | Batas pesan per jendela waktu, aksi delete/warn/mute |
| FR-09 | Admin tools | `.kick`, `.mute`, `.ping`, `.id`, info grup |
| FR-10 | XP & level | XP per pesan (buffered), level-up announce |
| FR-11 | Leaderboard | `.top` di grup, tabel di dashboard |
| FR-12 | Custom command CRUD | Buat command teks dari dashboard, sinkron ke bot |
| FR-13 | Dashboard | Overview, pairing wizard, grup, settings, log |
| FR-14 | Storage R2 | Unggah unduhan aset (stiker/ikon) + validasi |
| FR-15 | Audit log | Semua aksi admin & moderasi tercatat |

### 3.2 Prioritas P1 — setelah MVP stabil

| ID | Fitur | Ringkasan |
| --- | --- | --- |
| FR-16 | Poll native | `.poll "Pertanyaan" "Opsi A" "Opsi B"` |
| FR-17 | Stiker | Gambar/video pendek → WebP stiker |
| FR-18 | Mini-games | Tebak kata, truth-or-dare dengan skor tersimpan |
| FR-19 | Scheduler | Pengumuman/reminder terjadwal per grup |
| FR-20 | Live log dashboard | Realtime room untuk log & status (menggantikan polling) |

### 3.3 Prioritas P2 — opsional

- Export CSV member & leaderboard.
- Anti-forward, anti-sticker-spam, slow mode.
- Auto-responder berbasis regex.
- Multi-bot / multi-nomor.
- Papan peringkat lintas grup.

---

## 4. Arsitektur Sistem

### 4.1 Diagram

```
┌──────────────────────── HP anggota/admin ────────────────────────┐
│  WhatsApp app (grup)                                             │
└───────────────▲──────────────────────────────────┬──────────────┘
                │ pesan / event grup               │ pesan masuk
                │ (protokol WhatsApp Web, WSS)     │
┌───────────────┴──────────────────────────────────▼──────────────┐
│  DAEMON BOT — Node.js 20+ (VPS / PC selalu menyala)             │
│  ├─ Baileys socket (multi-device, pairing code)                 │
│  ├─ Auth state lokal (creds + signal keys, tanpa D1)            │
│  ├─ Message pipeline: parse → limit → command/moderasi → balas  │
│  ├─ Config cache (TTL 10 dtk) + buffer XP (flush 60 dtk)        │
│  └─ HTTP client ke API (Bearer BOT_API_KEY)                     │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS REST (polling 3–5 dtk, batch write)
┌───────────────▼─────────────────────────────────────────────────┐
│  CONTROL PLANE — Cloudflare Worker di *.freebuff.page           │
│  ├─ Dashboard (SPA, cookie session)                             │
│  ├─ REST API publik (dashboard) + /api/bot/* (Bearer)           │
│  ├─ D1: konfigurasi, grup, member, XP, log, statistik           │
│  └─ R2: aset & backup sesi terenkripsi                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Komponen dan tanggung jawab

| Komponen | Runtime | Tanggung jawab | Data yang dipegang |
| --- | --- | --- | --- |
| `apps/bot` | Node.js 20+ | Koneksi WhatsApp, eksekusi command, moderasi, cache config | Creds, signal keys, buffer XP, antrean retry |
| `apps/web` — Worker | Worker (ES module) | Dashboard, API, otorisasi, validasi, audit | Tidak menyimpan kredensial WhatsApp |
| D1 | SQLite terkelola | Sumber kebenaran konfigurasi & statistik | Semua tabel §6 |
| R2 | Object storage | Aset publik & backup sesi terenkripsi | Blob, tanpa kunci enkripsi |

### 4.3 Keputusan arsitektur (ADR ringkas)

**ADR-1 — Baileys di daemon Node.js, bukan di Worker.**
Baileys membutuhkan koneksi WebSocket jangka panjang, timer, penyimpanan state kredensial, dan proses yang hidup terus. Worker bersifat request-scoped, tanpa filesystem, dengan batas CPU (kuota Sites: 5.000.000 ms/bulan) dan tidak dirancang untuk sesi 24/7. Menjalankan Baileys di Worker akan sering terputus dan tidak dapat diandalkan.
*Alternatif ditolak:* Durable Object (tetap tanpa filesystem, tidak didukung Sites), cron trigger tiap menit (tidak bisa mempertahankan socket).

**ADR-2 — Komunikasi bot ↔ control plane memakai REST polling, bukan WebSocket.**
Polling 3–5 detik cukup untuk konfigurasi dan pairing; tahan terhadap putus jaringan, mudah di-debug, tanpa state koneksi. Setelah MVP stabil, realtime room dipakai hanya untuk **live log dashboard** (P1), bukan untuk jalur kontrol.

**ADR-3 — Auth state tidak pernah masuk D1.**
Creds adalah kunci akun. Auth state disimpan lokal di daemon (penulisan atomik, permission 600). Backup lintas host bersifat **opt-in** dan dienkripsi AES-256-GCM di daemon; Worker/R2 hanya menyimpan ciphertext + IV + tag tanpa kunci.

**ADR-4 — XP ditulis secara batch.**
Menulis 1 baris per pesan akan menghabiskan kuota D1 (100.000 write/bulan, 10.000/hari). Daemon mengagregasi XP di memori dan mengirim satu batch setiap 60 detik atau 50 anggota, mana lebih dulu.

**ADR-5 — D1 adalah sumber kebenaran konfigurasi; daemon hanya cache.**
Semua perubahan dashboard langsung tersimpan di D1. Daemon mengambil diff (`updated_at`) tiap 5 detik dan menyimpan cache dengan TTL 10 detik, sehingga perubahan berlaku ≤ 10 detik dan tidak hilang saat restart.

### 4.4 Alur data pesan grup

```
pesan masuk
  └─> normalisasi (JID, teks, media)
      └─> abaikan jika dari bot sendiri / status broadcast / grup nonaktif
          └─> rate limit per user (anti-spam)
              └─> moderasi (anti-link) → hapus / kick bila melanggar
                  └─> command terdeteksi? → eksekusi + balas
                      └─> jika bukan command → hitung XP (buffer)
                          └─> flush berkala: XP, statistik, audit, event
```

---

## 5. Alur Login Pair Code

### 5.1 Prinsip

- **Tanpa QR.** Kode 8 digit diminta oleh daemon, ditampilkan di dashboard.
- Nomor harus format internasional **digit saja** (`628123456789`), tanpa `+`, spasi, tanda kurung, atau strip.
- `requestPairingCode()` dipanggil **setelah** socket mencapai tahap siap (event `connecting` atau `qr`), bukan langsung setelah `makeWASocket`.
- Kode hanya bisa dipakai untuk **satu perangkat tertaut per nomor**. Jika nomor sudah punya sesi bot lain, pairing baru akan menggantikan sesi tersebut.

### 5.2 Langkah teknis

1. Dashboard `POST /api/pair-requests` dengan nomor → Worker validasi format, rate limit, buat baris `pair_requests` status `pending`.
2. Daemon polling `POST /api/bot/pair-requests/claim` setiap 3 detik → Worker mengembalikan permintaan `pending`, menandainya `dispatched`, menyertakan `id`, `phone_number`, `expires_at`.
3. Daemon memastikan tidak ada sesi aktif yang masih valid. Jika ada, ia menolak klaim dengan `error_code=session_active`.
4. Daemon `makeWASocket({ printQRInTerminal: false, auth: state })`, menunggu event `connecting`/`qr`.
5. Daemon memanggil `sock.requestPairingCode(phoneNumber)` → kode 8 digit.
6. Daemon `POST /api/bot/pair-requests/:id/code` dengan `{ code }` → status `code_ready`, `code_ready_at`, `expires_at = now + 120 dtk`.
7. Dashboard membaca `GET /api/pair-requests/:id` setiap 2 detik, menampilkan kode besar + hitung mundur + instruksi HP.
8. Pengguna memasukkan kode di HP. Saat `connection.update` menghasilkan `connection: 'open'`:
   - daemon menyimpan creds secara atomik,
   - daemon `POST /api/bot/pair-requests/:id/status` dengan `{ status: 'connected', phone_jid }`,
   - Worker menandai `bots.status='connected'`, `paired_at`, `phone_jid`, dan menghapus `code` (jangan simpan kode setelah sukses).
9. Bila WhatsApp menutup socket dengan **515 `restartRequired`** tepat setelah pairing, itu normal: daemon langsung reconnect memakai creds tersimpan dan **tidak** meminta kode baru.
10. Bila status `loggedOut` (401) atau kode kedaluwarsa/ salah: status `failed` dengan `error_code` (`code_expired`, `code_invalid`, `logged_out`, `timeout`), dashboard menampilkan tombol **Coba Lagi**.

### 5.3 State machine `pair_requests`

```
pending ──claim──> dispatched ──code──> code_ready ──open──> connected (final)
   │                   │                    │
   │                   │                    ├─ 120 dtk tanpa open ──> expired
   │                   │                    └─ error dari daemon ──> failed
   └─ dibatalkan owner ──────────────────────────────────────────> cancelled
```

Aturan transisi:

| Dari | Ke | Pemicu | Efek |
| --- | --- | --- | --- |
| `pending` | `dispatched` | Bot claim | `attempts += 1` |
| `dispatched` | `code_ready` | Daemon mengirim kode | `code`, `expires_at` diisi |
| `dispatched` | `failed` | Daemon gagal sebelum kode | `error_code` diisi |
| `code_ready` | `connected` | `connection: open` | `bots.status=connected`, kode dihapus |
| `code_ready` | `expired` | Lewat `expires_at` | Dashboard menawarkan regenerasi |
| `code_ready` | `failed` | `logged_out` / error | Perlu pairing ulang |
| `pending`/`dispatched`/`code_ready` | `cancelled` | Owner klik batal atau meminta kode baru | Socket ditutup daemon |

Batas waktu & pembatasan:

- TTL kode: **120 detik** (asumsi; validasi saat implementasi karena masa berlaku ditentukan server WhatsApp).
- Maksimal **3 permintaan pairing per 15 menit** per bot; permintaan ke-4 ditolak `429 pairing_rate_limited`.
- Cooldown **30 detik** antar permintaan; UI menonaktifkan tombol.
- Hanya satu `pair_requests` non-final per bot pada satu waktu (unique partial index).

### 5.4 Kebijakan reconnect

| Kondisi | Aksi daemon | Status dashboard |
| --- | --- | --- |
| Socket putus biasa (`connection: close`, 428/408) | Reconnect backoff 2s → 4s → 8s → … maks 60s + jitter | `disconnected` → `connected` |
| `restartRequired` (515) setelah pairing | Reconnect segera | `connecting` singkat |
| `loggedOut` (401) | Hapus creds lokal, jangan reconnect | `logged_out` |
| Creds hilang/rusak | Hentikan loop, minta pairing | `unpaired` |
| Heartbeat gagal 3× berturut | Tetap jalan, laporkan `api_unreachable` | `degraded` (banner) |

### 5.5 Keamanan auth state

- Direktori `data/auth/<botId>/` dengan permission `600`; penulisan `creds.json.tmp` lalu `rename` atomik.
- Tidak ada endpoint yang mengembalikan isi creds ke browser, dan tidak ada kolom creds di D1.
- Backup: `POST /api/bot/session-backup` mengirim `{ blob, iv, tag, version }`; blob adalah ciphertext AES-256-GCM dengan kunci dari `AUTH_ENCRYPTION_KEY` (hanya di daemon). R2 key: `sessions/<botId>/<timestamp>.bin`, retensi 3 versi terakhir.
- Log tidak boleh memuat nomor lengkap (mask: `62812••••789`), kode pairing, atau isi pesan.

---

## 6. Model Data (D1)

Semua timestamp memakai **epoch milidetik (INTEGER)**. Nama tabel snake_case, `PRAGMA foreign_keys = ON`.

```sql
-- 1. Bot (satu baris untuk MVP)
CREATE TABLE bots (
  id            TEXT PRIMARY KEY,
  phone_jid     TEXT UNIQUE,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'unpaired'
                CHECK (status IN ('unpaired','pairing','connected','disconnected','logged_out','error')),
  last_seen_at  INTEGER,
  paired_at     INTEGER,
  session_key   TEXT,               -- R2 key ciphertext, bukan kredensial
  app_version   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 2. Permintaan pairing
CREATE TABLE pair_requests (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  code          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','dispatched','code_ready','connected','expired','failed','cancelled')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,
  created_at    INTEGER NOT NULL,
  code_ready_at INTEGER,
  expires_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX idx_pair_status ON pair_requests(status, created_at DESC);
CREATE UNIQUE INDEX idx_pair_open ON pair_requests(bot_id)
  WHERE status IN ('pending','dispatched','code_ready');

-- 3. Grup
CREATE TABLE groups (
  jid            TEXT PRIMARY KEY,
  bot_id         TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  owner_jid      TEXT,
  member_count   INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  joined_at      INTEGER NOT NULL,
  last_synced_at INTEGER,
  last_active_at INTEGER
);
CREATE INDEX idx_groups_active ON groups(is_active, last_active_at DESC);

-- 4. Pengaturan per grup (1:1 dengan groups)
CREATE TABLE group_settings (
  group_jid         TEXT PRIMARY KEY REFERENCES groups(jid) ON DELETE CASCADE,
  prefix            TEXT NOT NULL DEFAULT '.',
  locale            TEXT NOT NULL DEFAULT 'id',
  welcome_enabled   INTEGER NOT NULL DEFAULT 1,
  welcome_template  TEXT NOT NULL DEFAULT 'Halo {mention}, selamat datang di *{group}*! 👋',
  goodbye_enabled   INTEGER NOT NULL DEFAULT 0,
  goodbye_template  TEXT NOT NULL DEFAULT '{name} keluar dari grup.',
  anti_link_mode    TEXT NOT NULL DEFAULT 'delete'
                    CHECK (anti_link_mode IN ('off','delete','kick')),
  link_allowlist    TEXT NOT NULL DEFAULT '[]',   -- JSON array domain
  anti_spam_enabled INTEGER NOT NULL DEFAULT 1,
  spam_max_msgs     INTEGER NOT NULL DEFAULT 8,
  spam_window_sec   INTEGER NOT NULL DEFAULT 10,
  spam_action       TEXT NOT NULL DEFAULT 'warn'
                    CHECK (spam_action IN ('warn','delete','mute')),
  xp_enabled        INTEGER NOT NULL DEFAULT 1,
  xp_per_message    INTEGER NOT NULL DEFAULT 5,
  level_up_announce INTEGER NOT NULL DEFAULT 1,
  message_log       INTEGER NOT NULL DEFAULT 0,   -- isi pesan TIDAK disimpan default
  updated_at        INTEGER NOT NULL
);

-- 5. Anggota & XP
CREATE TABLE members (
  group_jid      TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  user_jid       TEXT NOT NULL,
  push_name      TEXT,
  xp             INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 1,
  message_count  INTEGER NOT NULL DEFAULT 0,
  violations     INTEGER NOT NULL DEFAULT 0,
  joined_at      INTEGER,
  last_active_at INTEGER,
  PRIMARY KEY (group_jid, user_jid)
);
CREATE INDEX idx_members_xp ON members(group_jid, xp DESC);

-- 6. Custom command
CREATE TABLE commands (
  id          TEXT PRIMARY KEY,
  group_jid   TEXT REFERENCES groups(jid) ON DELETE CASCADE, -- NULL = global
  trigger     TEXT NOT NULL,                                  -- tanpa prefix
  response    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_cmd_unique ON commands(group_jid, trigger);

-- 7. Audit log aksi admin/moderasi
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  group_jid   TEXT,
  actor_jid   TEXT NOT NULL,
  action      TEXT NOT NULL,      -- kick | mute | welcome_on | setting_update | login | ...
  target_jid  TEXT,
  detail      TEXT,               -- JSON ringkas
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_group ON audit_log(group_jid, created_at DESC);

-- 8. Event teknis (retensi 7 hari)
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  scope      TEXT NOT NULL,       -- connection | command | api | media
  message    TEXT NOT NULL,
  meta       TEXT,                -- JSON tanpa PII mentah
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_time ON events(created_at DESC);

-- 9. Aset di R2
CREATE TABLE media_files (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('sticker','icon','audio','other')),
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  group_jid   TEXT,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- 10. Statistik harian (retensi 365 hari)
CREATE TABLE daily_stats (
  stat_date      TEXT NOT NULL,   -- YYYY-MM-DD (Asia/Jakarta)
  bot_id         TEXT NOT NULL,
  messages_in    INTEGER NOT NULL DEFAULT 0,
  commands_used  INTEGER NOT NULL DEFAULT 0,
  active_groups  INTEGER NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, bot_id)
);
```

Catatan model:

- `members` sengaja menyimpan `push_name` saja (bukan kontak/nomor tersimpan).
- Isi pesan **tidak** disimpan; `group_settings.message_log` default `0`, dan bila diaktifkan hanya menyimpan potongan 200 karakter dengan retensi 24 jam untuk debugging.
- Penghapusan grup (`ON DELETE CASCADE`) menghapus settings, member, command grup tersebut, tetapi tidak menghapus `audit_log` (jejak audit dipertahankan).

---

## 7. Kontrak API

### 7.1 Konvensi umum

- Base: `https://<site>.freebuff.page/api`
- Respons: `{ "ok": true, "data": ... }` atau `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- Autentikasi:
  - **Dashboard**: cookie sesi `wabot_session` (HttpOnly, Secure, SameSite=Lax) + header `X-CSRF-Token` untuk semua mutasi.
  - **Bot**: `Authorization: Bearer <BOT_API_KEY>`, hanya dari origin daemon (tanpa CORS).
- Semua response API privat: `Cache-Control: no-store`.
- Validasi input di Worker (bukan hanya di UI); tolak field tak dikenal pada PATCH.

### 7.2 Endpoint dashboard

| Method | Path | Fungsi |
| --- | --- | --- |
| POST | `/api/auth/login` | Login password → set cookie + CSRF |
| POST | `/api/auth/logout` | Hapus sesi |
| GET | `/api/session` | Info sesi & status bot |
| GET | `/api/overview` | Ringkasan: status, jumlah grup, pesan hari ini, kuota |
| POST | `/api/pair-requests` | Minta pairing `{ phone_number }` |
| GET | `/api/pair-requests/:id` | Polling status & kode |
| POST | `/api/pair-requests/:id/cancel` | Batalkan |
| POST | `/api/bot/logout` | Perintahkan daemon logout (hapus sesi) |
| GET | `/api/groups` | Daftar grup (`?q=&active=`) |
| GET | `/api/groups/:jid` | Detail + settings + statistik |
| PATCH | `/api/groups/:jid/settings` | Ubah pengaturan (subset field) |
| GET | `/api/groups/:jid/members` | `?sort=xp|level|last_active&limit=50` |
| GET | `/api/groups/:jid/commands` | Custom command grup |
| POST | `/api/groups/:jid/commands` | Tambah command |
| PATCH | `/api/commands/:id` | Ubah / enable / disable |
| DELETE | `/api/commands/:id` | Hapus |
| GET | `/api/groups/:jid/audit` | Audit log (`?limit=100`) |
| GET | `/api/events` | Log teknis (`?level=&limit=`) |
| POST | `/api/media` | Unggah aset (multipart/max 2 MB) → R2 |
| GET | `/api/media/:id` | Metadata + URL unduh |
| GET | `/api/export/groups.csv` | Export (P2) |

### 7.3 Endpoint bot (Bearer)

| Method | Path | Fungsi |
| --- | --- | --- |
| POST | `/api/bot/heartbeat` | `{ status, wa_state, version, reconnect_count, latency_ms }` |
| POST | `/api/bot/pair-requests/claim` | Ambil permintaan `pending` |
| POST | `/api/bot/pair-requests/:id/code` | `{ code }` |
| POST | `/api/bot/pair-requests/:id/status` | `{ status, error_code?, phone_jid? }` |
| GET | `/api/bot/config?since=<ts>` | Diff settings, command, grup aktif |
| POST | `/api/bot/groups/sync` | Upsert metadata grup (batch) |
| POST | `/api/bot/members/xp` | Batch XP `{ updates: [...] }` |
| POST | `/api/bot/audit` | Batch audit |
| POST | `/api/bot/events` | Batch event log |
| POST | `/api/bot/session-backup` | Simpan ciphertext sesi |
| GET | `/api/bot/session-backup` | Ambil ciphertext terbaru |

### 7.4 Contoh payload

**Minta pairing**

```http
POST /api/pair-requests
Content-Type: application/json
X-CSRF-Token: <token>

{ "phone_number": "628123456789" }
```

```json
{
  "ok": true,
  "data": {
    "id": "pr_01JCH3...",
    "status": "pending",
    "expires_at": 1762761234000
  }
}
```

**Kode siap**

```json
{
  "ok": true,
  "data": {
    "id": "pr_01JCH3...",
    "status": "code_ready",
    "code": "A1B2-C3D4",
    "phone_masked": "62812••••789",
    "expires_at": 1762761234000
  }
}
```

**Batch XP dari daemon**

```http
POST /api/bot/members/xp
Authorization: Bearer <BOT_API_KEY>
Idempotency-Key: batch-1762761234-bot1

{
  "bot_id": "bot_1",
  "updates": [
    { "group_jid": "1203630@g.us", "user_jid": "62811@s.whatsapp.net",
      "xp_delta": 25, "messages": 5, "last_active_at": 1762761234000 }
  ]
}
```

Worker menjalankan `UPSERT` dengan `xp = xp + excluded.xp_delta`, menghitung level (`level = floor(sqrt(xp/100)) + 1`), dan mencatat `Idempotency-Key` 24 jam untuk mencegah dobel.

### 7.5 Kode error standar

| HTTP | `code` | Arti |
| --- | --- | --- |
| 400 | `invalid_phone` | Format nomor salah |
| 401 | `unauthorized` | Cookie/API key tidak valid |
| 403 | `csrf_failed` | Token CSRF tidak cocok |
| 409 | `session_active` | Bot sudah tertaut |
| 409 | `pairing_in_progress` | Sudah ada permintaan berjalan |
| 410 | `code_expired` | Kode kedaluwarsa |
| 429 | `pairing_rate_limited` | Melebihi 3 permintaan/15 menit |
| 429 | `command_rate_limited` | Spam command |
| 503 | `bot_offline` | Tidak ada heartbeat ≤ 90 detik |

---

## 8. Spesifikasi Fungsional

### 8.1 Ringkasan acceptance criteria

| ID | Fitur | Prioritas | Acceptance criteria |
| --- | --- | --- | --- |
| FR-01 | Pairing pair code | P0 | Nomor valid → kode 8 digit muncul ≤ 10 dtk; salah format ditolak dengan pesan jelas; kode kedaluwarsa bisa diregenerasi; tidak ada QR di UI/log |
| FR-02 | Persistensi sesi | P0 | Restart daemon → reconnect ≤ 30 dtk tanpa kode baru; `loggedOut` mengubah status ke `logged_out` dan menghapus creds |
| FR-03 | Heartbeat | P0 | Status di dashboard ≤ 60 dtk dari perubahan nyata; heartbeat berhenti > 90 dtk → badge Offline |
| FR-04 | Sinkronisasi grup | P0 | Bot diundang ke grup → muncul ≤ 15 dtk; keluar grup → `is_active=0` ≤ 15 dtk |
| FR-05 | Welcome/goodbye | P0 | Anggota baru menerima pesan ≤ 3 dtk; variabel `{mention}`,`{group}` terisi; template kosong tidak mengirim apa pun |
| FR-06 | Command engine | P0 | `.ping` dibalas ≤ 2 dtk (p95); command tak dikenal diabaikan tanpa balasan; prefix konfigurasi berlaku setelah sinkron |
| FR-07 | Anti-link | P0 | Mode `delete` menghapus pesan berisi URL ≤ 2 dtk; domain di allowlist lolos; mode `kick` mengeluarkan pelanggar dan mencatat audit |
| FR-08 | Anti-spam | P0 | > 8 pesan/10 dtk memicu aksi sesuai setting; mute menahan pesan 5 menit; pelanggaran tercatat |
| FR-09 | Admin tools | P0 | `.kick @user` hanya bekerja untuk admin grup; non-admin mendapat pesan penolakan; bot tanpa hak admin memberi error jelas |
| FR-10 | XP & level | P0 | 5 pesan → +25 XP (default); level naik saat ambang tercapai; XP tidak hilang setelah restart ≤ 60 dtk data terakhir |
| FR-11 | Leaderboard | P0 | `.top` menampilkan 10 teratas dari D1; dashboard menampilkan tabel sama |
| FR-12 | Custom command | P0 | Command baru dari dashboard aktif ≤ 10 dtk; duplikat trigger ditolak 409; command nonaktif tidak dibalas |
| FR-13 | Dashboard | P0 | Semua halaman utama dapat dipakai di layar 360 px; state kosong/loading/error tersedia |
| FR-14 | Storage R2 | P0 | Unggah PNG ≤ 2 MB berhasil, > 2 MB ditolak 413; tipe selain gambar/webp ditolak; URL aset stabil |
| FR-15 | Audit log | P0 | Setiap kick/mute/ubah setting menghasilkan baris audit dengan aktor & target |
| FR-16 | Poll native | P1 | `.poll "Q" "A" "B"` membuat poll dengan 2+ opsi, votes dapat dipilih |
| FR-17 | Stiker | P1 | Balas gambar ≤ 5 MB dengan `.sticker` → stiker WebP terkirim ≤ 8 dtk |
| FR-18 | Mini-games | P1 | `.tebak` memulai ronde, jawaban benar memberi XP, timeout 60 dtk mengumumkan jawaban |
| FR-19 | Scheduler | P1 | Jadwal tersimpan di D1; terkirim ± 60 dtk dari waktu target; tidak dobel setelah restart |
| FR-20 | Live log | P1 | Event baru muncul ≤ 1 dtk di dashboard tanpa refresh penuh |

### 8.2 Daftar command MVP

| Command | Contoh | Perilaku |
| --- | --- | --- |
| `.menu` | `.menu` | Daftar command aktif (global + grup) |
| `.ping` | `.ping` | Balas latensi bot & uptime |
| `.id` | `.id` | Kirim JID grup & JID pengirim |
| `.welcome` | `.welcome on` / `off` | Admin saja; ubah `welcome_enabled` |
| `.setwelcome` | `.setwelcome Halo {mention}...` | Simpan template; validasi panjang ≤ 500 karakter |
| `.goodbye` | `.goodbye on` | Toggle pesan keluar |
| `.antilink` | `.antilink kick` | Mode `off`/`delete`/`kick`; admin saja |
| `.antispam` | `.antispam on` | Toggle anti-spam |
| `.kick` | `.kick @user [alasan]` | Keluarkan anggota; bot harus admin |
| `.mute` | `.mute @user 10m` | Batasi kirim pesan (bot menyimpan daftar mute di memori + D1) |
| `.promote` | `.promote @user` | Jadikan admin grup (P1) |
| `.level` | `.level` | XP, level, peringkat pengirim |
| `.top` | `.top` | 10 teratas grup |
| `.poll` | `.poll "Pilih" "A" "B"` | Poll native (P1) |
| `.sticker` | reply gambar | Stiker WebP (P1) |
| `.tebak` / `.jawab` | `.tebak` lalu `.jawab jakarta` | Mini-game (P1) |
| `.addcmd` | `.addcmd halo | Halo juga!` | Admin; command teks sederhana |
| `.delcmd` | `.delcmd halo` | Hapus command buatan |
| `.help` | `.help` | Sama dengan `.menu`, format ringkas |

Aturan eksekusi:

- Prefix default `.`, dapat diganti; command case-insensitive.
- Command admin hanya diterima dari JID yang terdaftar admin grup (dicek lewat metadata grup, cache 60 detik) atau owner bot.
- Rate limit command: 5 command/10 dtk per pengguna; kelebihan diabaikan dengan satu peringatan.
- Bot tidak pernah membalas pesan dari dirinya sendiri, pesan status, atau pesan langsung (DM) selain `.help`.

### 8.3 Template pesan

Variabel yang didukung: `{mention}`, `{name}`, `{group}`, `{memberCount}`, `{date}`, `{rules}`.

- Rendering gagal karena variabel tak dikenal → variabel dibiarkan apa adanya, tidak error.
- Pesan maksimum 1.000 karakter setelah render; jika lebih, dipotong dengan `…` dan dicatat sebagai `warn`.
- Markdown WhatsApp (`*bold*`, `_italic_`) diteruskan apa adanya.

---

## 9. Spesifikasi Dashboard

| Rute | Isi | Aksi utama |
| --- | --- | --- |
| `/login` | Form password tunggal | Login, pesan error generik, rate limit 5/menit |
| `/` | Kartu status bot, pesan hari ini, grup aktif, command terpakai, sparkline 7 hari | Menuju pairing/log |
| `/pair` | Wizard 3 langkah: nomor → kode → terhubung | Minta kode, salin kode, batalkan, ulangi |
| `/groups` | Tabel/pencarian grup, badge status | Buka detail |
| `/groups/:jid` | Tab: Umum, Penyambutan, Moderasi, XP, Command, Anggota, Audit | Simpan setting, preview template, kick manual (P2) |
| `/commands` | Daftar command global/grup | Tambah, edit, enable/disable, hapus |
| `/logs` | Event terbaru dengan filter level & scope | Muat ulang, unduh 100 baris JSON |
| `/settings` | Info bot, versi, rotasi API key, disclaimer risiko | Salin API key sekali tampil, logout bot |

Persyaratan UX:

- Responsif mulai 360 px; navigasi bawah pada mobile.
- Dark mode mengikuti sistem + toggle manual.
- Form dengan validasi inline, tombol disabled selama submit, toast sukses/gagal.
- Kode pairing ditampilkan dengan huruf monospace besar, tombol **Salin**, dan hitung mundur.
- Setiap halaman punya state: loading skeleton, kosong (dengan CTA), error (dengan retry).
- Tidak ada data sensitif di `localStorage`; token CSRF disimpan di memori + cookie non-HttpOnly.

---

## 10. Kebutuhan Non-Fungsional

### 10.1 Performa & keandalan

| Aspek | Target |
| --- | --- |
| Latensi balasan command | p95 ≤ 2 dtk, p99 ≤ 5 dtk |
| Latensi API dashboard | p95 ≤ 400 ms (region terdekat) |
| Waktu aktif bot | ≥ 99% per bulan (single host, systemd/pm2 auto-restart) |
| Polling interval daemon | 5 dtk (config), 3 dtk (pairing) |
| Ukuran bundle Worker | ≤ 3 MB terkompresi; tanpa dependensi Baileys |
| Kapasitas MVP | 1 bot, 50 grup, 5.000 anggota, 200 pesan/menit puncak |
| Retry API | 3× backoff (1s, 4s, 9s), idempotent untuk batch |

### 10.2 Keamanan

- Password dashboard disimpan sebagai hash PBKDF2-SHA256 (≥ 100.000 iterasi) + salt acak di secret Worker; verifikasi memakai Web Crypto.
- Sesi: cookie `HttpOnly; Secure; SameSite=Lax`, masa berlaku 7 hari, ditandatangani HMAC-SHA256; logout menghapus cookie dan menaikkan `session_version`.
- Mutasi wajib same-origin + `X-CSRF-Token`; tolak `Origin` asing dengan 403.
- `BOT_API_KEY` 32 byte acak, hanya ada di env daemon dan secret Worker; rotasi mendukung kunci aktif + sebelumnya (masa transisi 24 jam).
- Rate limit: login 5/menit/IP, pairing 3/15 menit, endpoint bot 120/menit, unggah media 10/jam.
- Validasi unggahan: whitelist MIME (`image/png`, `image/jpeg`, `image/webp`), cek magic bytes, maks 2 MB, nama file di-generate (tidak memakai nama dari klien).
- Header keamanan: `Content-Security-Policy` ketat (tanpa `unsafe-inline` untuk script), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal.
- Kredensial WhatsApp tidak pernah melewati Worker dalam bentuk plaintext.

### 10.3 Privasi

- Data yang disimpan: JID, push name, XP, statistik agregat. Tidak menyimpan kontak, riwayat chat, atau media anggota kecuali yang sengaja diunggah admin.
- Sesuai UU PDP: sediakan hapus data per grup (`POST /api/groups/:jid/purge`, P1) dan dokumentasi retensi.
- Retensi: `events` 7 hari, `audit_log` 90 hari, `daily_stats` 365 hari, backup sesi 3 versi.
- Log aplikasi tidak memuat nomor penuh, kode pairing, atau isi pesan.

### 10.4 Anggaran kuota freebuff.page (per bulan)

| Sumber daya | Kuota | Estimasi MVP | Status |
| --- | --- | --- | --- |
| Request situs | 100.000 | dashboard polling 5 dtk saat dibuka (~7.200/8 jam) + bot polling (~17.000) | aman |
| CPU Worker | 5.000.000 ms | ± 150.000 ms | aman |
| D1 storage | 100 MB | 50 grup × 500 member × 150 B ≈ 4 MB | aman |
| D1 baris dibaca | 50 jt | ± 3 jt | aman |
| D1 baris ditulis | 100.000 | XP batch 1/menit/anggota aktif + settings ≈ 40.000 | aman, dipantau |
| D1 write harian | 10.000 | ± 1.500 | aman |
| R2 storage | 1 GB | aset ≤ 50 MB, backup sesi 3 × 50 KB | aman |
| R2 Class A (tulis) | 25.000 | ± 1.000 | aman |
| R2 Class B (baca) | 250.000 | ± 10.000 | aman |

Mitigasi bila mendekati batas:

1. Naikkan interval polling config ke 15 dtk.
2. Flush XP tiap 120 dtk atau 100 anggota.
3. Agregasi statistik di daemon, kirim 1 baris `daily_stats` per jam.
4. Kurangi retensi `events` menjadi 3 hari.

---

## 11. Risiko dan Mitigasi

| # | Risiko | Dampak | Kemungkinan | Mitigasi |
| --- | --- | --- | --- | --- |
| 1 | Nomor bot diblokir WhatsApp karena Baileys bukan API resmi | Tinggi (bot mati) | Sedang | Gunakan nomor cadangan khusus bot; larang blast/broadcast; batasi kirim; disclaimer di dashboard; siapkan prosedur ganti nomor |
| 2 | Kode pairing kedaluwarsa sebelum dimasukkan | Rendah | Sedang | TTL ditampilkan jelas, tombol regenerasi, cooldown 30 dtk |
| 3 | WhatsApp menutup socket 515 setelah pairing | Rendah | Tinggi (normal) | Reconnect otomatis dengan creds, jangan minta kode baru |
| 4 | Sesi dicabut dari HP | Sedang | Sedang | Status `logged_out`, hapus creds, wizard pairing ulang |
| 5 | Host daemon mati (listrik/internet) | Sedang | Sedang | systemd/pm2 restart, healthcheck eksternal, banner Offline di dashboard |
| 6 | Kuota D1 write terlampaui karena XP | Sedang | Sedang | Batch + agregasi, alert di 70% kuota, fallback flush 5 menit |
| 7 | Tombol interaktif tidak tampil di sebagian akun | Rendah | Tinggi | Jangan andalkan tombol; pakai teks + poll; dokumentasikan batasan |
| 8 | Satu nomor hanya satu sesi; pairing ulang memutus sesi lama | Sedang | Sedang | Konfirmasi eksplisit di UI sebelum pairing |
| 9 | Kebocoran `BOT_API_KEY` | Tinggi | Rendah | Rotasi dua kunci, tidak di browser/log, rate limit, audit endpoint bot |
| 10 | Perubahan protokol WhatsApp mematahkan Baileys | Tinggi | Sedang | Pin versi teruji, update terkontrol, monitor channel rilis, staging dulu |
| 11 | Bot bukan admin grup → fitur moderasi gagal | Rendah | Tinggi | Deteksi status admin, tampilkan peringatan di dashboard & balasan command |
| 12 | Nomor bot dijadikan admin grup berbahaya | Sedang | Rendah | Batasi command destruktif ke owner bot, konfirmasi ganda |

**Batasan yang harus disampaikan ke pengguna di UI:**

> Wabot menggunakan protokol WhatsApp Web tidak resmi (Baileys). Penggunaan pada nomor utama berisiko pemblokiran oleh WhatsApp. Gunakan nomor khusus bot, hindari pengiriman massal, dan patuhi Ketentuan Layanan WhatsApp.

---

## 12. Milestone

| Milestone | Cakupan | Exit criteria |
| --- | --- | --- |
| **M1 — Fondasi control plane** (2 hari) | Situs Sites + Worker, skema D1, auth login, layout dashboard | Login/logout bekerja; migrasi D1 idempoten; healthcheck 200 |
| **M2 — Pairing & sesi** (3 hari) | Daemon Baileys, endpoint pairing, wizard UI, auth state, reconnect | Pairing end-to-end sukses dengan nomor uji; restart host reconnect ≤ 30 dtk; tidak ada QR |
| **M3 — Fitur grup inti** (4 hari) | Sync grup, welcome/goodbye, command engine, anti-link, anti-spam, admin tools, audit | Semua FR-04…FR-09, FR-15 lolos uji manual di 1 grup uji |
| **M4 — Data, dashboard, storage** (3 hari) | XP/level batch, leaderboard, custom command CRUD, unggah R2, halaman grup/log | FR-10…FR-14 lolos; kuota D1 terpantau; UI responsif 360 px |
| **M5 — Interaktif & hardening** (4 hari) | Poll, stiker, games, scheduler, live log, security review, pilot | FR-16…FR-20 (minimal poll + stiker) lolos; uji 3 grup nyata 7 hari tanpa disconnect tak tertangani |

Total estimasi: **16 hari kerja** untuk satu pengembang.

### Definisi selesai (rilis MVP)

1. Semua FR P0 lolos acceptance criteria.
2. Pairing dan reconnect diuji pada ≥ 2 nomor berbeda.
3. Tidak ada kredensial atau kode pairing di log, D1, atau respons API.
4. Dashboard dapat dipakai penuh di ponsel.
5. Kuota Sites tetap di bawah 50% setelah 7 hari pilot.
6. Disclaimer risiko ban terlihat sebelum pairing.

---

## 13. Lampiran

### A. Environment variable

**Worker (Sites secrets/variables)**

| Nama | Contoh | Keterangan |
| --- | --- | --- |
| `BOT_API_KEY` | 64 hex chars | Bearer untuk endpoint `/api/bot/*` |
| `BOT_API_KEY_PREVIOUS` | 64 hex chars | Untuk rotasi tanpa downtime |
| `DASHBOARD_PASSWORD_HASH` | `pbkdf2$...` | Hash + salt password dashboard |
| `SESSION_SECRET` | 64 hex chars | Penanda tangan cookie |
| `APP_ORIGIN` | `https://site-xxx.freebuff.page` | Validasi same-origin |
| `DB` | binding D1 | Database |
| `FILES` | binding R2 | Object storage |

**Daemon bot**

| Nama | Contoh | Keterangan |
| --- | --- | --- |
| `API_BASE_URL` | `https://site-xxx.freebuff.page/api` | Control plane |
| `BOT_API_KEY` | sama dengan Worker | Autentikasi bot |
| `BOT_ID` | `bot_1` | Identitas bot |
| `AUTH_DIR` | `./data/auth` | Lokasi auth state |
| `AUTH_ENCRYPTION_KEY` | 32 byte base64 | Enkripsi backup sesi (jangan di Worker) |
| `LOG_LEVEL` | `info` | Tingkat log |
| `POLL_INTERVAL_MS` | `5000` | Interval config |

### B. Struktur repo usulan

```
wabot/
├─ apps/
│  ├─ bot/                 # Node.js daemon
│  │  ├─ src/index.ts      # bootstrap, loop reconnect
│  │  ├─ src/socket.ts     # makeWASocket + pairing
│  │  ├─ src/auth-state.ts # auth state atomik + backup
│  │  ├─ src/pipeline.ts   # moderasi, command, XP
│  │  ├─ src/commands/     # satu file per command
│  │  └─ src/api-client.ts # retry, idempotency
│  └─ web/                 # Worker + dashboard
│     ├─ src/worker.ts     # router, middleware auth/CSRF
│     ├─ src/routes/       # auth, pairs, groups, commands, media, bot
│     ├─ src/db/           # query D1 + migrasi
│     └─ src/ui/           # halaman dashboard
├─ packages/shared/        # tipe & skema validasi bersama
├─ migrations/             # 0001_init.sql, dst.
└─ docs/PRD-wa-group-bot.md
```

### C. Format log (JSON satu baris)

```json
{"t":1762761234000,"level":"info","scope":"command","msg":"command_executed","botId":"bot_1","group":"1203630@g.us","cmd":"top","ms":142}
```

### D. Glosarium

| Istilah | Arti |
| --- | --- |
| Pair code | Kode 8 digit untuk menautkan perangkat WhatsApp tanpa QR |
| JID | ID internal WhatsApp (`628xx@s.whatsapp.net`, `12036xx@g.us`) |
| Daemon | Proses Node.js yang menjaga koneksi Baileys |
| Control plane | Worker + dashboard + D1 + R2 di `*.freebuff.page` |
| Batch flush | Pengiriman XP/event terkumpul untuk menghemat kuota tulis |

### E. Pertanyaan terbuka

1. Nomor WhatsApp mana yang dipakai untuk pilot, dan apakah tersedia VPS 1 vCPU/1 GB yang selalu menyala?
2. Apakah bot perlu dijadikan admin grup otomatis, atau admin menaikkan manual?
3. Bahasa default pesan bot: Indonesia saja atau perlu Inggris?
4. Apakah log isi pesan (opsional) dibutuhkan untuk debugging, mengingat risiko privasi?
5. Perlu multi-nomor (satu dashboard, beberapa bot) pada rilis pertama atau sesudah MVP?
6. Siapa pemegang `AUTH_ENCRYPTION_KEY` bila host diganti — owner atau operator?
