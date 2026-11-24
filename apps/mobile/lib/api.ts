import Constants from 'expo-constants';

const API_PORT = 8002;

/**
 * EXPO_PUBLIC_API_URL wins when set: scripts/dev-remote.sh sets it to the
 * public tunnel so the phone works on any network.
 * Otherwise, on a phone, call the API on the same computer Expo Go connected to
 * (that follows the current Wi-Fi, so no LAN IP is stored).
 */
function apiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${API_PORT}`;
  }
  return process.env.EXPO_PUBLIC_API_URL ?? `http://127.0.0.1:${API_PORT}`;
}

/** Full URL for an API path, for uploads and downloads that can't use api(). */
export function apiUrl(path: string): string {
  return `${apiBase()}/api/v1${path}`;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: string;
  token?: string | null;
  body?: unknown;
};

/** The phone's time zone, so "today" on the server is the traveller's today, not UTC's. */
const deviceTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
})();

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (deviceTimeZone) headers['X-Timezone'] = deviceTimeZone;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/v1${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(normalizeAmounts(options.body)),
    });
  } catch {
    throw new ApiError(0, 'Travel OS is unreachable. Start the API and try again.');
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readableError(payload, response.status);
    throw new ApiError(response.status, detail);
  }
  return payload as T;
}

export async function uploadDocument(
  token: string,
  file: { uri: string; name: string; type: string },
  travelSpaceId?: string,
): Promise<{ status: string; detail: string; booking_id: string | null }> {
  const body = new FormData();
  body.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  if (travelSpaceId) body.append('travel_space_id', travelSpaceId);
  const response = await fetch(`${apiBase()}/api/v1/documents`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : 'Could not import that file.';
    throw new ApiError(response.status, detail);
  }
  return payload;
}

export function optionalDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(422, 'Dates use YYYY-MM-DD.');
  }
  return trimmed;
}

export function optionalDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T12:00:00`;
  if (!Number.isNaN(Date.parse(trimmed))) return new Date(trimmed).toISOString();
  throw new ApiError(422, 'Times use YYYY-MM-DD or a full timestamp.');
}


/**
 * Turn a server error into a sentence a traveller can act on.
 * FastAPI validation errors arrive as a list of {loc, msg, type}; name the field and what it needs.
 */
function readableError(payload: unknown, status: number): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { loc?: (string | number)[]; msg?: string; type?: string };
    const raw = String(first.loc?.[first.loc.length - 1] ?? 'value');
    const field = raw.replaceAll('_', ' ').replace(/\b(on|at)$/, '').trim();
    const type = first.type ?? '';
    if (/decimal|float|int|number/.test(type)) return `Enter ${field} as a number, like 1000 or 24.50.`;
    if (/date/.test(type)) return `Pick a valid date for ${field}.`;
    if (type === 'missing') return `Add the ${field}.`;
    if (/too_short|string_too_short/.test(type)) return `The ${field} is too short.`;
    if (/too_long|string_too_long/.test(type)) return `The ${field} is too long.`;
    if (/greater_than/.test(type)) return `The ${field} must be more than zero.`;
    return first.msg ? `${field}: ${first.msg}` : 'Check the details and try again.';
  }
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  if (status === 401) return 'Sign in again.';
  if (status === 404) return 'That item no longer exists.';
  return 'Check the details and try again.';
}


const AMOUNT_KEYS = new Set(['amount', 'price_amount']);

/**
 * Money typed on a phone keypad can be "24,50" (European decimal comma) or "1 000".
 * Send it the way the server reads numbers; anything else is left for the server to reject clearly.
 */
function normalizeAmounts(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (!AMOUNT_KEYS.has(key) || typeof value !== 'string') continue;
    let text = value.replace(/[\s\u00a0']/g, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replaceAll(',', '');
    else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
    out[key] = text;
  }
  return out;
}
