/**
 * Remote API for Darts Royale PC server.
 * GET /health, POST /remote/reset, POST /remote/restart.
 */

const DEFAULT_TIMEOUT_MS = 3000;

export type ApiResult = { ok: true; message?: string } | { ok: false; message: string };

export function buildBaseUrl(ip: string, port: string | number): string {
  const p = String(port).trim() || "3000";
  const base = String(ip).trim().replace(/\/+$/, "");
  if (!base) return "";
  return `http://${base}:${p}`;
}

function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...fetchOptions,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
}

export async function healthCheck(baseUrl: string): Promise<ApiResult> {
  if (!baseUrl) return { ok: false, message: "No server URL" };
  const url = `${baseUrl}/health`;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 3000 });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) {
      return { ok: true, message: data.serverTime ? `Server time: ${data.serverTime}` : undefined };
    }
    return { ok: false, message: data?.message || `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.includes("abort") ? "Connection timed out" : msg };
  }
}

function remoteBody(): { source: string; timestamp: number } {
  return { source: "iphone-remote", timestamp: Math.floor(Date.now() / 1000) };
}

export async function sendReset(baseUrl: string): Promise<ApiResult> {
  if (!baseUrl) return { ok: false, message: "No server URL" };
  const url = `${baseUrl}/remote/reset`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remoteBody()),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) return { ok: true };
    return { ok: false, message: data?.message || `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.includes("abort") ? "Connection timed out" : msg };
  }
}

export async function sendRestart(baseUrl: string): Promise<ApiResult> {
  if (!baseUrl) return { ok: false, message: "No server URL" };
  const url = `${baseUrl}/remote/restart`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remoteBody()),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok === true) return { ok: true };
    return { ok: false, message: data?.message || `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.includes("abort") ? "Connection timed out" : msg };
  }
}

export type AutoDartsState = { status: string | null; numThrows?: number };

export async function getAutoDartsState(baseUrl: string): Promise<AutoDartsState> {
  if (!baseUrl) return { status: null, numThrows: 0 };
  const url = `${baseUrl}/autodarts/state`;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 3000 });
    const data = await res.json().catch(() => ({}));
    return {
      status: data?.status ?? null,
      numThrows: data?.numThrows ?? 0,
    };
  } catch {
    return { status: null, numThrows: 0 };
  }
}
