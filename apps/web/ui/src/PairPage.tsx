import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  cancelPairRequest,
  createPairRequest,
  getPairRequest,
  type PairRequestData,
  type SessionData
} from './api';

type Step = 'phone' | 'confirm' | 'code';

const POLL_MS = 2500;

function formatPhoneInput(value: string): string {
  return value.replace(/[^\d]/g, '').slice(0, 15);
}

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function splitCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function errorText(body: { error: { code: string; message: string } } | null, fallback: string): string {
  if (!body) return fallback;

  switch (body.error.code) {
    case 'pairing_rate_limited':
    case 'pairing_cooldown':
      return body.error.message;
    case 'pairing_in_progress':
      return 'Masih ada permintaan pairing yang berjalan. Tunggu hingga selesai atau batalkan.';
    case 'session_active':
      return 'Bot sudah tertaut. Putuskan sesi lebih dulu dari halaman pengaturan.';
    case 'invalid_phone':
      return 'Nomor harus diawali kode negara tanpa + atau spasi, misalnya 628123456789.';
    default:
      return body.error.message || fallback;
  }
}

interface PairPageProps {
  session: SessionData;
  onSessionRefresh: () => void;
}

export function PairPage({ session, onSessionRefresh }: PairPageProps) {
  const [step, setStep] = useState<Step>(() => (session.pair_request ? 'code' : 'phone'));
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [request, setRequest] = useState<PairRequestData | null>(session.pair_request);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = request && !['connected', 'expired', 'failed', 'cancelled'].includes(request.status);

  const poll = useCallback(async () => {
    if (!request) return;

    try {
      const result = await getPairRequest(request.id);
      if (result.status === 200 && result.body?.ok) {
        setRequest(result.body.data);
        if (result.body.data.status === 'connected') onSessionRefresh();
      } else if (result.status === 404) {
        setError('Permintaan pairing tidak ditemukan lagi.');
        setRequest(null);
        setStep('phone');
      }
    } catch {
      // Polling berikutnya mencoba lagi; gangguan jaringan sesaat bukan kegagalan pairing.
    }
  }, [request, onSessionRefresh]);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [active, poll]);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const msLeft = request?.expires_at ? request.expires_at - now : 0;
  const codeReady = request?.status === 'code_ready' && request.code && msLeft > 0;

  async function handlePhoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      setError('Masukkan nomor format internasional, digit saja, misalnya 628123456789.');
      return;
    }

    setStep('confirm');
  }

  async function handleCreate() {
    if (!agreed) {
      setError('Centang pernyataan risiko sebelum melanjutkan.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await createPairRequest(session.csrf_token, phone);

      if (result.status === 201 && result.body?.ok) {
        setRequest(result.body.data);
        setStep('code');
        setNow(Date.now());
        return;
      }

      if (result.status === 409 && result.body && !result.body.ok && result.body.error.code === 'pairing_in_progress') {
        const existing = (result.body.error as { pair_request_id?: string }).pair_request_id;
        if (existing) {
          const resumed = await getPairRequest(existing);
          if (resumed.status === 200 && resumed.body?.ok) {
            setRequest(resumed.body.data);
            setStep('code');
            return;
          }
        }
      }

      setError(
        errorText(
          result.body && !result.body.ok ? result.body : null,
          'Tidak bisa meminta kode pairing. Coba lagi.'
        )
      );
    } catch {
      setError('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!request) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await cancelPairRequest(session.csrf_token, request.id);
      if (result.status === 200) {
        setRequest(null);
        setStep('phone');
        setAgreed(false);
        onSessionRefresh();
        return;
      }

      setError(
        errorText(
          result.body && !result.body.ok ? result.body : null,
          'Tidak bisa membatalkan permintaan. Coba lagi.'
        )
      );
    } catch {
      setError('Tidak bisa menghubungi server. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setRequest(null);
    setError(null);
    setStep('phone');
    onSessionRefresh();
  }

  async function handleCopy() {
    if (!request?.code) return;

    try {
      await navigator.clipboard.writeText(request.code);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Browser menolak akses clipboard. Salin kode secara manual.');
    }
  }

  return (
    <main className="app-main pair-main">
      <p className="section-kicker">Pairing</p>
      <h1>Hubungkan nomor bot.</h1>
      <p className="lead">
        Masukkan nomor WhatsApp bot, lalu tautkan lewat kode 8 digit. Tidak perlu memindai QR.
      </p>

      <ol className="step-list" aria-label="Langkah pairing">
        {(
          [
            ['phone', 'Nomor'],
            ['confirm', 'Konfirmasi'],
            ['code', 'Kode']
          ] as const
        ).map(([key, label], index) => (
          <li
            key={key}
            className="step-item"
            aria-current={step === key ? 'step' : undefined}
            data-done={['phone', 'confirm', 'code'].indexOf(step) > index}
          >
            <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {error ? (
        <p className="form-error page-error" role="alert">
          {error}
        </p>
      ) : null}

      {step === 'phone' ? (
        <section className="pair-panel" aria-labelledby="pair-phone-title">
          <h2 id="pair-phone-title">Nomor bot</h2>
          <form className="login-form" onSubmit={handlePhoneSubmit} noValidate>
            <label htmlFor="phone">Nomor WhatsApp</label>
            <div className="input-row">
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="628123456789"
                value={phone}
                onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                aria-describedby="phone-help"
              />
            </div>
            <p id="phone-help" className="field-help">
              Format internasional tanpa +, spasi, atau tanda hubung. Nomor ini akan menjadi
              nomor bot, bukan nomor pribadi Anda.
            </p>

            {session.bot?.status === 'connected' ? (
              <p className="notice-line">
                Bot sudah tertaut{session.bot.phone_masked ? ` ke ${session.bot.phone_masked}` : ''}.
                Pairing baru akan menggantikan sesi tersebut.
              </p>
            ) : null}

            <button type="submit" className="primary-button">
              Lanjut ke konfirmasi
            </button>
          </form>
        </section>
      ) : null}

      {step === 'confirm' ? (
        <section className="pair-panel" aria-labelledby="pair-confirm-title">
          <h2 id="pair-confirm-title">Konfirmasi nomor</h2>
          <dl className="status-list">
            <div className="status-row">
              <dt>Nomor</dt>
              <dd className="mono-value">{phone}</dd>
            </div>
            <div className="status-row">
              <dt>Masa berlaku</dt>
              <dd>Kode berlaku 120 detik setelah diterbitkan</dd>
            </div>
          </dl>

          <div className="risk-box">
            <h3>Risiko yang perlu dipahami</h3>
            <p>
              Wabot memakai protokol WhatsApp Web tidak resmi (Baileys). WhatsApp dapat
              memblokir nomor yang dipakai, terutama untuk pengiriman massal. Gunakan nomor
              khusus bot, bukan nomor utama.
            </p>
            <label className="check-row" htmlFor="agree">
              <input
                id="agree"
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span>Saya memakai nomor khusus bot dan memahami risiko pemblokiran.</span>
            </label>
          </div>

          <div className="button-row">
            <button type="button" className="ghost-button" onClick={() => setStep('phone')} disabled={submitting}>
              Kembali
            </button>
            <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={submitting}>
              {submitting ? 'Meminta kode...' : 'Minta kode pairing'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 'code' ? (
        <section className="pair-panel" aria-labelledby="pair-code-title">
          <h2 id="pair-code-title">Kode pairing</h2>

          {request?.status === 'connected' ? (
            <>
              <p className="pair-outcome ok">
                Nomor {request.phone_masked} sudah tertaut. Bot akan menyambung otomatis setelah
                kode diterima.
              </p>
              <button type="button" className="primary-button" onClick={handleRetry}>
                Pairing nomor lain
              </button>
            </>
          ) : request?.status === 'failed' ? (
            <>
              <p className="pair-outcome fail">
                Pairing gagal
                {request.error_code === 'logged_out'
                  ? ': sesi WhatsApp berakhir sebelum kode dipakai.'
                  : request.error_code === 'code_expired'
                    ? ': kode kedaluwarsa sebelum dimasukkan.'
                    : request.error_code === 'code_invalid'
                      ? ': kode ditolak WhatsApp.'
                      : ': daemon tidak menyelesaikan pairing.'}
              </p>
              <button type="button" className="primary-button" onClick={handleRetry}>
                Coba lagi
              </button>
            </>
          ) : request?.status === 'expired' ? (
            <>
              <p className="pair-outcome fail">Kode kedaluwarsa sebelum dimasukkan.</p>
              <button type="button" className="primary-button" onClick={handleRetry}>
                Minta kode baru
              </button>
            </>
          ) : request?.status === 'cancelled' ? (
            <>
              <p className="pair-outcome fail">Permintaan dibatalkan.</p>
              <button type="button" className="primary-button" onClick={handleRetry}>
                Mulai lagi
              </button>
            </>
          ) : (
            <>
              {codeReady && request?.code ? (
                <>
                  <p className="pair-label">Masukkan di WhatsApp, Perangkat Tertaut, Tautkan dengan nomor telepon.</p>
                  <p className="pair-code" aria-live="polite">
                    {splitCode(request.code)}
                  </p>
                  <p className="pair-timer" data-low={msLeft < 30000}>
                    Berlaku {countdownLabel(msLeft)}
                  </p>
                  <div className="button-row">
                    <button type="button" className="ghost-button" onClick={() => void handleCopy()}>
                      {copied ? 'Tersalin' : 'Salin kode'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => void handleCancel()} disabled={submitting}>
                      Batalkan
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="loading-line" aria-hidden="true" />
                  <p className="pair-wait">
                    {request?.status === 'dispatched'
                      ? 'Daemon sedang membuat kode dari WhatsApp.'
                      : 'Menunggu daemon mengambil permintaan pairing.'}
                  </p>
                  <p className="field-help">
                    Halaman ini memeriksa status otomatis setiap beberapa detik. Biarkan tab
                    tetap terbuka.
                  </p>
                  <button type="button" className="ghost-button" onClick={() => void handleCancel()} disabled={submitting}>
                    Batalkan permintaan
                  </button>
                </>
              )}
              <p className="microcopy">
                Nomor {request?.phone_masked ?? phone}. Kode hanya ditampilkan di halaman ini dan
                dihapus setelah terhubung.
              </p>
            </>
          )}
        </section>
      ) : null}

      <p className="disclaimer app-disclaimer">
        Wabot memakai protokol WhatsApp Web tidak resmi. Penggunaan pada nomor utama berisiko
        pemblokiran. Gunakan nomor khusus bot dan hindari pengiriman massal.
      </p>
    </main>
  );
}
