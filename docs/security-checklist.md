# Checklist Keamanan Implementasi Wabot

Dokumen ini menurunkan 17 skill di [`security-skills-index.md`](./security-skills-index.md) dan requirement PRD bagian 10.2, 10.3, serta 12 menjadi kontrol yang bisa diperiksa. Checklist ini bukan klaim bahwa Wabot aman atau siap produksi.

## Cara pakai

- `[x]` hanya dipakai jika kontrol sudah diverifikasi dan buktinya ada di repo atau dijalankan ulang.
- `[ ]` dengan label **Sebagian** berarti sudah ada kode atau uji lokal, tetapi masih ada gap yang disebutkan.
- `[ ]` dengan label **Belum** berarti belum ada implementasi.
- **P0** memblokir rilis MVP. **P1** wajib sebelum pilot dengan data nyata. **P2** perbaikan lanjutan.
- Bukti lokal hanya berlaku untuk `wrangler dev` + D1 lokal. Item bertanda **Produksi** belum bisa ditutup tanpa deploy, secret produksi, dan uji di runtime Workers.
- Skill ofensif hanya dipakai pada sistem milik sendiri atau dengan izin tertulis.

## Ringkasan status

| Area | P0 | Selesai lokal | Sebagian | Belum |
| --- | ---: | ---: | ---: | ---: |
| Secret dan konfigurasi | 6 | 2 | 1 | 3 |
| Login dan sesi | 6 | 4 | 1 | 1 |
| CSRF dan header | 6 | 4 | 2 | 0 |
| API bot dan otorisasi | 6 | 1 | 0 | 5 |
| Pairing dan auth state | 7 | 4 | 0 | 3 |
| Rate limit | 6 | 3 | 1 | 2 |
| Input, D1, dan R2 | 7 | 1 | 2 | 4 |
| Dashboard dan XSS | 5 | 1 | 1 | 3 |
| Logging dan audit | 5 | 1 | 1 | 3 |
| Supply chain dan CI | 6 | 0 | 0 | 6 |
| Privasi dan retensi | 5 | 1 | 1 | 3 |
| Insiden dan operasi | 5 | 0 | 0 | 5 |
| **Total** | **70** | **22** | **10** | **38** |

Angka di atas adalah hitungan item pada dokumen ini, bukan skor keamanan.

## Gate rilis P0

Rilis MVP tidak boleh dijalankan sebelum semua gate ini lulus. Setiap gate merujuk item di bawah.

1. Tidak ada secret di repo, bundle, log, atau respons API ([SEC-02](#secret-dan-konfigurasi), [LOG-02](#logging-dan-audit)).
2. Login, sesi, dan logout lulus uji lokal dan produksi, termasuk pencabutan sesi ([AUTH-05](#login-dan-sesi)).
3. Semua mutasi menolak Origin asing dan CSRF salah ([WEB-02](#csrf-dan-header)).
4. `/api/bot/*` menolak request tanpa Bearer valid, dan setiap query discope ke bot yang berhak ([API-01](#api-bot-dan-otorisasi)).
5. Pair code tidak pernah masuk log atau D1 dalam bentuk yang bisa dipakai ulang ([PAIR-04](#pairing-dan-auth-state)).
6. Rate limit login, pairing, dan bot teruji dengan request berurutan ([RL-01](#rate-limit)).
7. Semua query D1 memakai parameter binding, tanpa interpolasi input ([DATA-01](#input-d1-dan-r2)).
8. Migrasi idempoten, diuji dua kali berturut-turut, dan bootstrap database kosong hanya aktif saat diperlukan ([DATA-06](#input-d1-dan-r2)).
9. Retensi events, audit, dan statistik berjalan otomatis ([PRV-03](#privasi-dan-retensi)).
10. Runbook rotasi kunci dan insiden tersedia ([INC-01](#insiden-dan-operasi)).

## Secret dan konfigurasi

Rujukan skill: `implementing-api-key-security-controls`, `securing-serverless-functions`.

- [x] **SEC-01 (P0, Selesai lokal)** Secret dev dipisahkan dari kode. `.dev.vars` di-ignore dan hanya berisi hash password, `SESSION_SECRET`, dan `APP_ORIGIN`.
  Bukti: `.gitignore`, `.dev.vars.example`. Periksa: `git check-ignore -v .dev.vars`.
- [x] **SEC-02 (P0, Selesai lokal)** Tidak ada password, hash, atau kunci yang dikirim ke browser. Login hanya mengembalikan `csrf_token` dan `expires_at`.
  Bukti: `apps/web/src/worker.ts` handler `/api/auth/login`; `apps/web/src/worker.test.ts`.
- [ ] **SEC-03 (P0, Belum)** `BOT_API_KEY` 32 byte acak (64 hex), disimpan hanya sebagai secret Worker dan env daemon, tidak pernah di `wrangler.jsonc` atau bundle UI.
  Verifikasi: `rg -n "BOT_API_KEY" dist apps/web/ui` tidak menemukan nilai; secret dipasang lewat dashboard Sites.
- [ ] **SEC-04 (P0, Belum)** Rotasi dua kunci: `BOT_API_KEY` aktif + `BOT_API_KEY_PREVIOUS`, masa transisi 24 jam, lalu kunci lama dicabut.
  Verifikasi: uji dua kunci pada `/api/bot/heartbeat`, lalu pastikan kunci lama 401 setelah transisi.
- [ ] **SEC-05 (P0, Belum)** `SESSION_SECRET` dan hash password produksi berbeda dari nilai dev, dibuat acak, dan didokumentasikan tanggal rotasinya.
  Verifikasi: catat sidik jari SHA-256 nilai (bukan nilainya) di runbook; bandingkan dengan dev.
- [x] **SEC-06 (P0, Selesai)** Same-origin tidak berasal dari header `Host`: acuan utamanya origin request, ditambah `APP_ORIGIN` bila variabel itu ada, dan fallback localhost hanya untuk hostname loopback.
  Bukti: `isSameOrigin()` di `worker.ts`; uji `worker.test.ts` menolak `Origin: https://evil.example` dengan `403` baik saat `APP_ORIGIN` diisi maupun kosong. Terverifikasi pada preview Sites: origin asing `403`, origin situs `200`.
- [x] **SEC-07 (P1, Selesai)** Secret produksi dipasang lewat Sites Secrets, bukan file yang ikut terunggah. Tidak ada nilai secret di chat, tiket, atau screenshot.
  Bukti: `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, dan `SCHEMA_BOOTSTRAP` dipasang lewat `sites_set_secret` dari berkas di `.secrets/` (gitignored); manifest deploy hanya berisi `worker.js`, dua modul SQL sebagai teks, dan aset UI.
- [ ] **SEC-08 (P1, Belum)** Kunci enkripsi backup sesi (`AUTH_ENCRYPTION_KEY`) hanya ada di daemon, tidak pernah menjadi binding Worker.
  Verifikasi: `rg -n "AUTH_ENCRYPTION_KEY" apps/web wrangler.jsonc` tidak menemukan apa pun.

## Login dan sesi

Rujukan skill: `testing-api-authentication-weaknesses`, `hunting-credential-stuffing-attacks`.

- [x] **AUTH-01 (P0, Selesai lokal)** Password diverifikasi dengan PBKDF2-SHA256 100.000 iterasi dan salt acak. Angka itu adalah batas maksimum PBKDF2 di Cloudflare Workers; hash dengan iterasi lebih tinggi gagal diverifikasi saat runtime (terbukti pada deploy preview pertama). Parameter minimum 100.000 dan maksimum 1.000.000 divalidasi sebelum derivasi.
  Bukti: `apps/web/src/auth.ts`; `auth.test.ts`.
- [x] **AUTH-02 (P0, Selesai lokal)** Perbandingan hash dan CSRF memakai perbandingan waktu konstan.
  Bukti: `constantTimeEqual`, `constantTimeEqualText`; `auth.test.ts`.
- [x] **AUTH-03 (P0, Selesai lokal)** Cookie `wabot_session` memakai `HttpOnly`, `SameSite=Lax`, `Path=/`, dan `Secure` saat request HTTPS.
  Bukti: `setSessionCookie()` di `worker.ts`; uji curl lokal menunjukkan `HttpOnly; SameSite=Lax` tanpa `Secure` pada HTTP. Verifikasi produksi: respons `Set-Cookie` harus memuat `Secure`.
- [x] **AUTH-04 (P0, Selesai lokal)** Sesi ditandatangani HMAC-SHA256, berisi `sub`, `iat`, `exp`, `csrf`, dan ditolak setelah 7 hari.
  Bukti: `signSession()`, `verifySession()`; `auth.test.ts`.
- [ ] **AUTH-05 (P0, Sebagian)** Logout menghapus cookie, tetapi belum menaikkan `session_version`. Sesi lama yang sudah disalin tetap valid sampai `exp`.
  Gap: tambah tabel atau kolom versi sesi, sertakan di payload, dan tolak sesi dengan versi lama. Uji dengan dua cookie: setelah logout, cookie lama harus 401.
- [ ] **AUTH-06 (P0, Belum)** Tidak ada endpoint yang membocorkan keberadaan sesi. Semua respons privat 401 dengan envelope yang sama, tanpa membedakan pengguna.
  Verifikasi: bandingkan `/api/session` tanpa cookie dan dengan cookie rusak; keduanya 401 `unauthorized`.
- [ ] **AUTH-07 (P1, Belum)** Sesi kedaluwarsa diuji dengan jam mundur dan cookie yang dimodifikasi. Tidak ada sesi yang diterima setelah `exp` atau setelah tanda tangan diubah.
  Verifikasi: ubah satu karakter payload dan signature; keduanya harus 401.
- [ ] **AUTH-08 (P1, Belum)** Tidak ada session fixation: token dibuat ulang setelah login, dan token pra-login tidak diterima.
  Verifikasi: kirim cookie acak saat login; respons tetap membuat token baru.

## CSRF dan header

Rujukan skill: `performing-web-application-penetration-test`, `securing-serverless-functions`.

- [x] **WEB-01 (P0, Selesai lokal)** Login dan logout menolak `Origin` asing dengan 403 sebelum memproses body atau sesi.
  Bukti: `isSameOrigin()`; uji curl `Origin: https://evil.example` menghasilkan 403; `worker.test.ts`.
- [x] **WEB-02 (P0, Selesai lokal)** Logout mutasi membutuhkan `X-CSRF-Token` yang cocok dengan token di sesi.
  Bukti: logout tanpa CSRF 403, dengan CSRF 200. Catatan: setiap mutasi baru wajib memakai pemeriksaan yang sama.
- [x] **WEB-03 (P0, Selesai lokal)** Token CSRF disimpan di memori UI, bukan `localStorage` atau `sessionStorage`.
  Bukti: `apps/web/ui/src/App.tsx`; periksa dengan `rg -n "localStorage|sessionStorage" apps/web/ui/src` tidak menemukan token.
- [x] **WEB-04 (P0, Selesai lokal)** Header keamanan dasar selalu diset: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal.
  Bukti: middleware `securityHeaders`; `worker.test.ts` memeriksa CSP dan nosniff.
- [ ] **WEB-05 (P0, Sebagian)** CSP melarang script inline (`script-src 'self'`), tetapi masih mengizinkan `style-src 'unsafe-inline'`. PRD hanya melarang unsafe-inline untuk script, jadi ini dapat diterima untuk MVP jika tidak ada HTML yang disisipkan dari input pengguna.
  Verifikasi: `rg -n "dangerouslySetInnerHTML|innerHTML" apps/web/ui/src` tidak menemukan penggunaan.
- [ ] **WEB-06 (P0, Sebagian)** HSTS belum diset. Wajib ditambahkan untuk respons HTTPS produksi setelah domain final diketahui.
  Verifikasi produksi: `Strict-Transport-Security: max-age=31536000; includeSubDomains` pada respons HTTPS.
- [ ] **WEB-07 (P1, Belum)** Semua respons API privat memakai `Cache-Control: no-store`, termasuk 401, 403, dan 500.
  Bukti: middleware sudah menset untuk path `/api/`, tetapi belum ada uji untuk respons error. Tambahkan uji 401 dan 403.
- [ ] **WEB-08 (P1, Belum)** `Content-Type: application/json` wajib untuk mutasi JSON, dan body dengan tipe lain ditolak 415.
  Verifikasi: kirim `text/plain` ke login; harus 415, bukan diproses.

## API bot dan otorisasi

Rujukan skill: `testing-api-for-broken-object-level-authorization`, `implementing-api-key-security-controls`, `conducting-api-security-testing`.

- [ ] **API-01 (P0, Belum)** Semua `/api/bot/*` memakai middleware Bearer yang membandingkan hash kunci secara waktu konstan dan menolak request tanpa header dengan 401.
  Verifikasi: tanpa header, header kosong, dan kunci acak harus 401; kunci valid harus masuk handler.
- [ ] **API-02 (P0, Belum)** `bot_id` diambil dari kunci atau konteks server, bukan dari body klien. Body yang menyebut bot lain ditolak 403.
  Verifikasi: kirim `bot_id: bot_2` dengan kunci `bot_1`; harus 403.
- [ ] **API-03 (P0, Belum)** Setiap query grup dan anggota discope ke `bot_id` yang berhak. `group_jid` dari request tidak dipercaya sebagai bukti kepemilikan.
  Verifikasi: buat dua bot dan dua grup; akses silang harus 404 atau 403, bukan data bot lain.
- [ ] **API-04 (P0, Belum)** Endpoint bot tidak mengembalikan kredensial, isi pesan, atau nomor penuh. `phone_jid` dimasking sebelum keluar dari server.
  Verifikasi: `rg -n "creds|password|phone_jid" apps/web/src/routes` dan tinjau setiap respons.
- [ ] **API-05 (P0, Belum)** Batch XP dan audit idempoten: `Idempotency-Key` disimpan minimal 24 jam dan pengulangan tidak menambah XP dua kali.
  Verifikasi: kirim batch yang sama dua kali; `xp` hanya bertambah sekali.
- [x] **API-06 (P0, Selesai lokal)** Tidak ada CORS untuk `/api/bot/*`. Header `Access-Control-Allow-Origin` tidak muncul pada respons bot.
  Verifikasi: `curl -i` dengan `Origin` asing; tidak ada header ACAO dan request tetap diproses hanya dengan Bearer valid. Teruji juga di origin preview: respons 401 tanpa header ACAO.
- [ ] **API-07 (P1, Belum)** Validasi skema body per endpoint: field tak dikenal ditolak, angka dibatasi, dan array dibatasi ukurannya.
- [ ] **API-08 (P1, Belum)** Uji BOLA otomatis mencakup minimal satu endpoint baca dan satu endpoint tulis lintas bot.

## Pairing dan auth state

Rujukan skill: `testing-api-authentication-weaknesses`, `implementing-api-rate-limiting-and-throttling`, `containing-active-breach`.

- [x] **PAIR-01 (P0, Selesai lokal)** Hanya satu `pair_requests` non-final per bot, ditegakkan oleh unique partial index dan dicek sebelum insert.
  Bukti skema: `idx_pair_open` di `migrations/0001_init.sql`. Handler `POST /api/pair-requests` di `worker.ts`; uji duplikat open di `pairing.worker.test.ts`; diverifikasi lokal dan di origin preview.
- [x] **PAIR-02 (P0, Selesai lokal)** Kode pairing tidak pernah dikembalikan ke browser selain pada respons polling yang berhak, tidak masuk log, dan dihapus saat status final.
  Bukti: `pairPayload()` menyembunyikan kode sebelum `code_ready` dan mengosongkannya pada status final; `worker.test.ts` dan `pairing.worker.test.ts` menguji masking dan transisi. Kode tidak dicetak ke log di manapun.
- [x] **PAIR-03 (P0, Selesai lokal)** Nomor telepon divalidasi format E.164 Indonesia (awalan `+` tunggal, hanya digit, tanpa pemisah), dinormalisasi sebelum disimpan, dan dimasking di semua tampilan dashboard.
  Bukti: `normalizePhone()` dan `maskPhone()` di `pairing.ts`; `pairing.test.ts` mencakup `+62…`, pemisah ditolak, dan masking `62812••••789`. Teruji end-to-end lokal dan di origin preview: `phone_masked` dalam respons sesi.
- [x] **PAIR-04 (P0, Selesai lokal)** Kode kedaluwarsa pada 120 detik, cooldown 30 detik, dan maksimal 3 permintaan per 15 menit per bot.
  Bukti: konstanta dan helper di `pairing.ts`; `expireStalePairRequest` ditulis saat baca; `consumeRateLimit` key `pair:<botId>`. Uji `pairing.test.ts` dan uji endpoint lokal/preview: `code_ready` dengan `expires_at` 120 detik, request ke-4 dalam window 429, cooldown ditolak.
- [ ] **PAIR-05 (P0, Belum)** Kredensial WhatsApp tidak pernah melewati Worker dalam bentuk plaintext. Hanya ciphertext backup sesi yang boleh masuk R2.
  Verifikasi: tinjau `/api/bot/session-backup`; payload wajib `{ blob, iv, tag, version }` dan tidak ada field plaintext.
- [ ] **PAIR-06 (P0, Belum)** Auth state daemon memakai permission `600`, penulisan `.tmp` lalu rename atomik, dan tidak ada endpoint yang mengembalikan isi creds.
- [ ] **PAIR-07 (P0, Belum)** Status `logged_out` menghapus creds lokal, mencabut sesi, dan menampilkan wizard pairing ulang tanpa loop reconnect.
- [ ] **PAIR-08 (P1, Belum)** Backup sesi menyimpan maksimal 3 versi terakhir di R2 dan versi lama dihapus setelah backup baru berhasil.
- [ ] **PAIR-09 (P1, Belum)** Uji pairing end-to-end pada nomor uji, termasuk kode kedaluwarsa, kode salah, dan reconnect setelah restart.

## Rate limit

Rujukan skill: `implementing-api-rate-limiting-and-throttling`, `hunting-credential-stuffing-attacks`.

- [x] **RL-01 (P0, Selesai lokal)** Login dibatasi 5 percobaan per menit per IP. Percobaan ke-6 menghasilkan 429 dengan `retry_after_seconds`.
  Bukti: `consumeRateLimit()` di `auth.ts`; uji curl lokal; `worker.test.ts`.
- [x] **RL-02 (P0, Selesai lokal)** Penghitung rate limit memakai upsert atomik di D1, bukan baca-lalu-tulis di aplikasi.
  Bukti: `INSERT ... ON CONFLICT ... RETURNING` di `auth.ts`; `migrations/0002_auth_rate_limits.sql`.
- [ ] **RL-03 (P0, Sebagian)** Kunci rate limit memakai `CF-Connecting-IP`, dengan fallback `local`. Di produksi, fallback ini akan menggabungkan semua klien menjadi satu kunci jika header hilang.
  Gap: tolak request tanpa `CF-Connecting-IP` di produksi, atau gunakan header tepercaya lain hanya jika Worker berada di belakang Cloudflare.
- [ ] **RL-04 (P0, Belum)** Endpoint bot dibatasi 120 request per menit per kunci. Uji burst 121 request; request ke-121 harus 429.
- [ ] **RL-05 (P0, Belum)** Command dibatasi 5 per 10 detik per pengguna, dan kelebihan hanya memicu satu peringatan, bukan balasan berulang.
- [ ] **RL-06 (P0, Belum)** Unggah media dibatasi 10 per jam per pengguna, dan penolakan tidak menulis objek ke R2.
- [x] **RL-07 (P1, Selesai lokal)** Pairing dibatasi 3 per 15 menit per bot dan 30 detik cooldown, terpisah dari rate limit login.
  Bukti: `consumeRateLimit(db, \`pair:${botId}\`, 3, 15*60*1000)` di handler pairing dan cooldown `pair:<botId>:cooldown` 30 detik di `worker.ts`; diuji pada `pairing.worker.test.ts` dan endpoint lokal.
- [ ] **RL-08 (P1, Belum)** Pembersihan baris `rate_limits` yang kedaluwarsa berjalan berkala agar D1 tidak tumbuh tanpa batas.

## Input, D1, dan R2

Rujukan skill: `exploiting-sql-injection-vulnerabilities`, `securing-serverless-functions`, `performing-serverless-function-security-review`, `implementing-api-schema-validation-security`.

- [x] **DATA-01 (P0, Selesai lokal)** Semua query D1 yang ada memakai parameter binding (`?1`, `?2`), tanpa interpolasi input pengguna ke SQL.
  Bukti: `apps/web/src/auth.ts`, `worker.ts`. Verifikasi: `rg -n "prepare\(` dan tinjau setiap query.
- [ ] **DATA-02 (P0, Sebagian)** Validasi input login membatasi panjang password 200 karakter dan body 4 KB. Validasi untuk endpoint lain belum ada.
  Gap: skema validasi bersama untuk pairing, settings, command, dan upload.
- [ ] **DATA-03 (P0, Belum)** `PATCH` menolak field tak dikenal dan hanya mengizinkan subset field yang didokumentasikan. Uji dengan field `bot_id` atau `group_jid` yang disisipkan.
- [ ] **DATA-04 (P0, Belum)** Unggah media: whitelist MIME `image/png`, `image/jpeg`, `image/webp`, cek magic bytes, maksimum 2 MB, dan nama file dibuat server (tidak memakai nama klien).
  Verifikasi: unggah file `.png` yang berisi teks; harus 415. Unggah 2 MB + 1 byte; harus 413.
- [ ] **DATA-05 (P0, Belum)** Kunci R2 dibuat dari ID acak, bukan dari nama file atau JID. Objek privat, tanpa akses langsung tanpa otorisasi.
- [x] **DATA-06 (P0, Selesai)** Migrasi idempoten dan bisa dijalankan pada database kosong dari dalam Worker.
  Bukti: `migrations/0001_init.sql`, `0002_auth_rate_limits.sql`; `ensureSchema` mencatat versi di `schema_migrations` dan menerapkan semuanya dalam satu `db.batch()`. Diuji pada D1 lokal kosong lewat `wrangler dev` dengan `SCHEMA_BOOTSTRAP=true`: `/api/health` `schema: missing` → login `200` → `schema: ok` → pemanggilan kedua `applied: []`; 12 tabel terbentuk dan `schema_migrations` berisi versi 1 dan 2. Tanpa flag, login menjawab `503 schema_missing`; tanpa sesi `401`; origin asing `403`. Sudah diverifikasi juga pada D1 Sites sungguhan (environment preview): `schema: missing` → login `200` → `schema: ok` dengan 12 tabel dan versi 1–2 tercatat; flag dimatikan setelah bootstrap.
- [ ] **DATA-07 (P0, Belum)** `PRAGMA foreign_keys = ON` aktif dan penghapusan grup mengosongkan settings, member, dan command tanpa menghapus audit.
  Verifikasi: hapus grup uji; hitung baris anak dan `audit_log` sebelum serta sesudah.
- [ ] **DATA-08 (P1, Belum)** Data pairing dan sesi tidak masuk `localStorage`; tidak ada dump D1 yang memuat kode aktif.

## Dashboard dan XSS

Rujukan skill: `performing-web-application-penetration-test`, `conducting-api-security-testing`.

- [x] **UI-01 (P0, Selesai lokal)** React merender teks dari server sebagai teks, tanpa `dangerouslySetInnerHTML` atau `innerHTML`.
  Bukti: `apps/web/ui/src/App.tsx`; verifikasi `rg -n "dangerouslySetInnerHTML|innerHTML" apps/web/ui/src` tidak menemukan apa pun.
- [ ] **UI-02 (P0, Sebagian)** Layout responsif 360 px dan tap target 44 px sudah diperiksa untuk halaman login dan status. Halaman grup, command, dan log belum ada.
  Bukti: uji browser lokal pada 360 px; `apps/web/ui/src/styles.css`.
- [ ] **UI-03 (P0, Belum)** Semua halaman baru punya state loading, kosong, dan error, serta tidak menampilkan data contoh sebagai data nyata.
- [ ] **UI-04 (P0, Belum)** Template pesan dan nama grup di-escape saat ditampilkan; tidak ada URL `javascript:` yang bisa dirender dari input pengguna.
- [ ] **UI-05 (P0, Belum)** Disclaimer risiko WhatsApp tidak resmi tampil sebelum pairing, bukan hanya di halaman pengaturan.
- [ ] **UI-06 (P1, Belum)** Tidak ada dead control atau navigasi ke fitur yang belum ada. Setiap tombol punya handler dan setiap tautan mengarah ke rute nyata.
- [ ] **UI-07 (P1, Belum)** Uji XSS tersimpan pada nama grup, push name, template, dan nama file yang diunggah.

## Logging dan audit

Rujukan skill: `analyzing-api-gateway-access-logs`, `containing-active-breach`, `performing-serverless-function-security-review`.

- [x] **LOG-01 (P0, Selesai lokal)** Error handler tidak mengirim detail internal ke klien dan hanya mencatat nama error.
  Bukti: `app.onError()` di `worker.ts` mengembalikan `internal_error` tanpa stack atau pesan asli.
- [ ] **LOG-02 (P0, Sebagian)** Belum ada jaminan log tidak memuat nomor penuh, kode pairing, isi pesan, cookie, atau token. `console.error` saat ini hanya nama error, tetapi log request dan daemon belum ada.
  Gap: redaksi terpusat dan uji log untuk setiap jalur.
- [ ] **LOG-03 (P0, Belum)** Setiap kick, mute, ubah setting, dan rotasi kunci menghasilkan baris `audit_log` dengan aktor, target, aksi, dan waktu.
  Verifikasi: lakukan aksi di grup uji, lalu baca `audit_log`; jumlah baris harus bertambah satu per aksi.
- [ ] **LOG-04 (P0, Belum)** Audit log tidak bisa diubah atau dihapus dari API dashboard. Hanya penambahan yang diizinkan.
- [ ] **LOG-05 (P0, Belum)** Akses `/api/bot/*` yang ditolak dicatat dengan kunci yang dimasking dan alasan penolakan, tanpa mencatat kunci asli.
- [ ] **LOG-06 (P1, Belum)** Event log memakai level dan scope yang konsisten, serta dapat difilter tanpa memuat isi pesan.
- [ ] **LOG-07 (P1, Belum)** Alert sederhana untuk lonjakan 401/403/429 dan kegagalan login berulang, minimal lewat tinjauan log harian.

## Supply chain dan CI

Rujukan skill: `detecting-malicious-npm-packages`, `performing-sca-dependency-scanning-with-snyk`, `implementing-devsecops-security-scanning`.

- [ ] **SC-01 (P0, Belum)** Lockfile di-commit dan instalasi memakai `npm ci` di CI, bukan `npm install`.
  Verifikasi: `git ls-files package-lock.json` menghasilkan satu baris; CI gagal jika lockfile berubah.
- [ ] **SC-02 (P0, Belum)** Dependensi baru ditinjau sebelum dipasang: nama paket, maintainer, install script, dan reputasi. `npm install --ignore-scripts` dipakai saat menambah paket yang tidak membutuhkan postinstall.
- [ ] **SC-03 (P0, Belum)** Secret scanning berjalan di pre-commit atau CI dan gagal jika menemukan pola kunci, hash, atau cookie.
  Verifikasi: commit percobaan berisi string acak panjang harus ditolak; jangan commit nilai asli.
- [ ] **SC-04 (P0, Belum)** SCA berjalan di CI untuk lockfile dan gagal pada CVE kritis yang sudah punya perbaikan.
- [ ] **SC-05 (P0, Belum)** SAST ringan mencakup pola `dangerouslySetInnerHTML`, `eval`, `new Function`, query SQL yang diinterpolasi, dan `child_process`.
- [ ] **SC-06 (P0, Belum)** Build CI menjalankan `typecheck`, `test`, dan `build` pada Node versi yang dipin, dengan exit status yang tidak ditelan pipeline.
- [ ] **SC-07 (P1, Belum)** Baileys dipin ke versi teruji dan pembaruan dilakukan lewat PR terpisah dengan catatan perubahan.
- [ ] **SC-08 (P1, Belum)** Dependensi yang tidak terpakai dihapus, dan jumlah dependensi produksi ditinjau setiap rilis.

## Privasi dan retensi

Rujukan skill: `performing-privacy-impact-assessment`.

- [x] **PRV-01 (P0, Selesai lokal)** Skema tidak menyimpan isi pesan secara default: `group_settings.message_log` bernilai `0` dan `members` hanya menyimpan `push_name`.
  Bukti: `migrations/0001_init.sql`.
- [ ] **PRV-02 (P0, Sebagian)** Retensi baru ditetapkan di PRD, belum dijalankan: `events` 7 hari, `audit_log` 90 hari, `daily_stats` 365 hari, backup sesi 3 versi.
  Gap: job pembersihan dan uji bahwa data lebih lama benar-benar terhapus.
- [ ] **PRV-03 (P0, Belum)** Job retensi berjalan terjadwal dan idempoten, dengan jumlah baris yang dihapus dicatat tanpa memuat data pribadi.
- [ ] **PRV-04 (P0, Belum)** Tersedia `POST /api/groups/:jid/purge` (P1 di PRD, tetapi P0 untuk pilot) yang menghapus settings, member, command, dan media grup, serta mencatat audit penghapusan.
- [ ] **PRV-05 (P0, Belum)** PIA ringkas mendokumentasikan aliran data: apa yang dikumpulkan, dasar pemrosesan, masa retensi, siapa yang dapat mengakses, dan cara menghapus.
- [ ] **PRV-06 (P1, Belum)** Dokumentasi retensi tersedia untuk pengguna dan menyebut UU PDP, bukan hanya GDPR.
- [ ] **PRV-07 (P1, Belum)** Tidak ada data pribadi di URL, query string, atau nama objek R2. Gunakan ID acak.

## Insiden dan operasi

Rujukan skill: `containing-active-breach`, `analyzing-api-gateway-access-logs`.

- [ ] **INC-01 (P0, Belum)** Runbook rotasi `BOT_API_KEY`, `SESSION_SECRET`, dan pencabutan sesi tertulis dan diuji minimal sekali di lingkungan lokal.
- [ ] **INC-02 (P0, Belum)** Prosedur `logged_out` atau kredensial WhatsApp bocor: hentikan daemon, hapus auth state, cabut sesi, rotasi kunci, lalu pairing ulang.
- [ ] **INC-03 (P0, Belum)** Kontak dan jalur eskalasi insiden tersedia, termasuk kewajiban notifikasi pelanggaran data sesuai UU PDP.
- [ ] **INC-04 (P0, Belum)** Backup sesi dapat dipulihkan dan diuji; pemulihan tidak memerlukan kode pairing baru jika creds masih valid.
- [ ] **INC-05 (P0, Belum)** Healthcheck eksternal dan alert untuk daemon mati lebih dari 90 detik sudah ada sebelum pilot.
- [ ] **INC-06 (P1, Belum)** Latihan tabletop singkat untuk kebocoran kunci dan kompromi nomor bot, dengan catatan hasil.

## Matriks 17 skill

| # | Skill | ID checklist |
| ---: | --- | --- |
| 1 | `testing-api-authentication-weaknesses` | AUTH-01..08, PAIR-01..05, PAIR-09 |
| 2 | `implementing-api-key-security-controls` | SEC-03..05, API-01..06 |
| 3 | `testing-api-for-broken-object-level-authorization` | API-02..04, API-07..08 |
| 4 | `implementing-api-rate-limiting-and-throttling` | RL-01..08, PAIR-04 |
| 5 | `securing-serverless-functions` | SEC-06..08, WEB-04..08, DATA-02..05 |
| 6 | `hunting-credential-stuffing-attacks` | RL-01..03, RL-07..08, LOG-07 |
| 7 | `conducting-api-security-testing` | API-01..08, WEB-01..03 |
| 8 | `performing-web-application-penetration-test` | WEB-01..08, UI-01..07 |
| 9 | `exploiting-sql-injection-vulnerabilities` | DATA-01..03, DATA-06..07 |
| 10 | `analyzing-api-gateway-access-logs` | LOG-01..07, INC-05 |
| 11 | `performing-serverless-function-security-review` | DATA-03..08, LOG-01..05, SC-05 |
| 12 | `detecting-malicious-npm-packages` | SC-01..02, SC-07..08 |
| 13 | `performing-sca-dependency-scanning-with-snyk` | SC-01, SC-04, SC-06 |
| 14 | `implementing-devsecops-security-scanning` | SC-03..06 |
| 15 | `performing-privacy-impact-assessment` | PRV-01..07 |
| 16 | `containing-active-breach` | PAIR-05..07, LOG-05, INC-01..06 |
| 17 | `implementing-api-schema-validation-security` | DATA-02..03, API-07 |

## Batas angka yang harus diuji

| Kontrol | Batas | Sumber |
| --- | --- | --- |
| Login | 5 per menit per IP | PRD 10.2, RL-01 |
| Pairing | 3 per 15 menit per bot, cooldown 30 detik | PRD 5.3, PAIR-04 |
| TTL kode pairing | 120 detik | PRD 5.3, PAIR-04 |
| Endpoint bot | 120 per menit | PRD 10.2, RL-04 |
| Command | 5 per 10 detik per pengguna | PRD 8.2, RL-05 |
| Unggah media | 10 per jam, maks 2 MB | PRD 10.2, DATA-04, RL-06 |
| Sesi | 7 hari | PRD 10.2, AUTH-04 |
| Retensi events | 7 hari | PRD 10.3, PRV-02 |
| Retensi audit | 90 hari | PRD 10.3, PRV-02 |
| Retensi statistik | 365 hari | PRD 10.3, PRV-02 |
| Backup sesi | 3 versi | PRD 10.3, PAIR-08 |

## Perintah verifikasi lokal

Jalankan dari root repo, satu per satu, dan periksa exit status.

```bash
npm run typecheck
npm test
npm run build
npm run build:ui
npm run db:migrate:local
npm run db:migrate:local
```

Uji API lokal (server `npm run dev` di port 8787):

```bash
curl -i http://localhost:8787/api/health
curl -i -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example' \
  -d '{"password":"salah"}'
curl -i -X POST http://localhost:8787/api/auth/logout \
  -H 'Origin: http://localhost:8787'
```

Yang harus terlihat: health 200 dengan `Cache-Control: no-store`; origin asing 403; logout tanpa cookie 401; tidak ada `Secure` pada cookie HTTP lokal.

## Yang belum diverifikasi

- Runtime produksi Workers, D1 remote, dan R2 belum ada. Semua item **Produksi** masih terbuka.
- `BOT_API_KEY` sudah dipasang sebagai secret environment preview dan endpoint `/api/bot/*` serta pairing teruji di origin preview. Produksi belum.
- `session_version` belum ada, sehingga logout belum mencabut sesi yang sudah disalin.
- HSTS, `Secure` cookie produksi, dan keandalan `CF-Connecting-IP` baru bisa diuji setelah deploy produksi.
- Uji ofensif (BOLA, SQLi, XSS, credential stuffing) belum dijalankan. Skill terkait hanya dipakai pada sistem sendiri dan dengan izin.
- Belum ada PIA, runbook insiden, atau latihan rotasi kunci.

## Riwayat

- 2026-11-10: versi awal. Status mengacu pada implementasi M1 lokal dan PRD, bukan hasil audit produksi.
- 2026-11-10: DATA-06 selesai. Bootstrap skema dari dalam Worker diuji pada D1 lokal kosong; migrasi dibaca dari `migrations/` sebagai modul teks dan dicatat di `schema_migrations`.
- 2026-11-10: tambah skill ke-17, `implementing-api-schema-validation-security`, untuk menutup DATA-02 dan DATA-03. Pencarian memastikan tidak ada skill khusus Hono, Workers, Wrangler, Miniflare, atau D1 di koleksi ini.
- 2026-11-10: milestone pairing selesai. PAIR-01..04, API-06, dan RL-07 ditandai selesai terverifikasi lokal dan di origin preview. Endpoint `/api/pair-requests`, `/api/bot/pair-requests/*`, dan halaman `/pair` diuji dengan workerd lokal dan deploy preview.

