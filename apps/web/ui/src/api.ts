export type BotStatus =
  | 'unpaired'
  | 'pairing'
  | 'connected'
  | 'disconnected'
  | 'logged_out'
  | 'error';

export type PairStatus =
  | 'pending'
  | 'dispatched'
  | 'code_ready'
  | 'connected'
  | 'expired'
  | 'failed'
  | 'cancelled';

export interface PairRequestData {
  id: string;
  status: PairStatus;
  phone_masked: string;
  code: string | null;
  error_code: string | null;
  attempts: number;
  created_at: number;
  code_ready_at: number | null;
  expires_at: number | null;
  completed_at: number | null;
}

export interface SessionData {
  authenticated: true;
  csrf_token: string;
  expires_at: number;
  bot: {
    status: BotStatus;
    last_seen_at: number | null;
    phone_masked: string | null;
  } | null;
  pair_request: PairRequestData | null;
}

export interface HealthData {
  service: string;
  version: string;
  status: 'ok' | 'degraded';
  database: 'ok' | 'unavailable';
  time: number;
}

interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    retry_after_seconds?: number;
  };
}

interface ApiSuccessPayload<T> {
  ok: true;
  data: T;
}

export type ApiBody<T> = ApiErrorPayload | ApiSuccessPayload<T>;

export interface ApiResult<T> {
  status: number;
  body: ApiBody<T> | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers
  });

  let body: ApiBody<T> | null = null;
  try {
    body = (await response.json()) as ApiBody<T>;
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

export function getSession(): Promise<ApiResult<SessionData>> {
  return request<SessionData>('/api/session');
}

export function login(password: string): Promise<
  ApiResult<{ authenticated: true; csrf_token: string; expires_at: number }>
> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password })
  });
}

export function logout(csrfToken: string): Promise<ApiResult<{ authenticated: false }>> {
  return request('/api/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  });
}

export function logoutAll(
  csrfToken: string
): Promise<ApiResult<{ authenticated: false; revoked_all: true }>> {
  return request('/api/auth/logout-all', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  });
}

export function getHealth(): Promise<ApiResult<HealthData>> {
  return request<HealthData>('/api/health');
}

export function createPairRequest(
  csrfToken: string,
  phoneNumber: string
): Promise<ApiResult<PairRequestData>> {
  return request<PairRequestData>('/api/pair-requests', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ phone_number: phoneNumber })
  });
}

export function getPairRequest(id: string): Promise<ApiResult<PairRequestData>> {
  return request<PairRequestData>(`/api/pair-requests/${encodeURIComponent(id)}`);
}

export function cancelPairRequest(
  csrfToken: string,
  id: string
): Promise<ApiResult<{ id: string; status: PairStatus }>> {
  return request(`/api/pair-requests/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  });
}

export interface GroupSummary {
  jid: string;
  jid_masked: string;
  name: string;
  member_count: number;
  is_active: number;
  joined_at: number;
  last_active_at: number | null;
}

export interface GroupDetail {
  jid: string;
  jid_masked: string;
  name: string;
  owner_jid_masked: string | null;
  member_count: number;
  is_active: number;
  joined_at: number;
  last_active_at: number | null;
}

export interface GroupSettings {
  prefix: string;
  locale: 'id' | 'en';
  welcome_enabled: number;
  welcome_template: string;
  goodbye_enabled: number;
  goodbye_template: string;
  anti_link_mode: 'off' | 'delete' | 'kick';
  link_allowlist: string;
  anti_spam_enabled: number;
  spam_max_msgs: number;
  spam_window_sec: number;
  spam_action: 'warn' | 'delete' | 'mute';
  xp_enabled: number;
  xp_per_message: number;
  level_up_announce: number;
  message_log: number;
}

export type GroupSettingsPatch = Partial<
  Omit<GroupSettings, 'link_allowlist'> & { link_allowlist: string[] }
>;

export function getGroups(
  q: string,
  active: 'all' | 'active' | 'inactive'
): Promise<ApiResult<{ groups: GroupSummary[] }>> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('active', active === 'all' ? 'all' : active === 'active' ? '1' : '0');
  return request<{ groups: GroupSummary[] }>(`/api/groups?${params.toString()}`);
}

export function getGroup(
  jid: string
): Promise<ApiResult<{ group: GroupDetail; settings: GroupSettings }>> {
  return request<{ group: GroupDetail; settings: GroupSettings }>(
    `/api/groups/${encodeURIComponent(jid)}`
  );
}

export function updateGroupSettings(
  csrfToken: string,
  jid: string,
  patch: GroupSettingsPatch
): Promise<ApiResult<{ group_jid: string; settings: GroupSettings }>> {
  return request<{ group_jid: string; settings: GroupSettings }>(
    `/api/groups/${encodeURIComponent(jid)}/settings`,
    {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(patch)
    }
  );
}
