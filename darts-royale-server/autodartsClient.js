/**
 * AutoDarts client: WebSocket connection for status + HTTP for reset/restart.
 * iPad app uses: POST /api/reset, PUT /api/start (no WebSocket command payloads).
 */

const WebSocket = require('ws');

const RECONNECT_INTERVAL_MS = 3000;

/**
 * Derive HTTP base URL from WebSocket URL (e.g. ws://host:3180/api/events -> http://host:3180).
 */
function wsUrlToBaseUrl(wsUrl) {
  if (!wsUrl || typeof wsUrl !== 'string') return '';
  const u = wsUrl.trim().replace(/^ws(s?):\/\//i, 'http$1://');
  const pathIdx = u.indexOf('/', 8); // after "http://host"
  return pathIdx > 0 ? u.slice(0, pathIdx) : u;
}

class AutoDartsClient {
  constructor(wsUrl, baseUrlOverride = '') {
    this.wsUrl = (wsUrl || '').trim();
    this.baseUrl = (baseUrlOverride || '').trim() || wsUrlToBaseUrl(this.wsUrl);
    this.ws = null;
    this.reconnectTimer = null;
    this._intentionalClose = false;
    this._httpOnly = !this.wsUrl && !!this.baseUrl;
    this._cachedStatus = null;
    this._cachedNumThrows = 0;
  }

  connect() {
    if (!this.wsUrl) {
      if (this._httpOnly) {
        console.log('[AutoDarts] HTTP-only mode: base URL', this.baseUrl);
      } else {
        console.log('[AutoDarts] No AUTODARTS_WS_URL or base URL configured');
      }
      return;
    }
    console.log('[AutoDarts] Connecting', this.wsUrl);
    this._intentionalClose = false;
    this._connect();
  }

  _connect() {
    if (this._intentionalClose || !this.wsUrl) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (e) {
      console.error('[AutoDarts] Error', e.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[AutoDarts] Connected');
      this._fetchInitialState();
    });

    this.ws.on('close', () => {
      this.ws = null;
      console.log('[AutoDarts] Closed (will retry)');
      if (!this._intentionalClose) this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[AutoDarts] Error', err.message);
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // AutoDarts format: { type: "state", data: { status: "Stopped", event: "Stopped", numThrows: 0, ... } }
        if (String(msg.type || '').toLowerCase() === 'state' && msg.data && typeof msg.data === 'object') {
          const d = msg.data;
          if (d.status != null) this._cachedStatus = String(d.status);
          const n = Number(d.numThrows ?? d.numDarts ?? 0);
          if (Number.isFinite(n)) this._cachedNumThrows = n;
        }
      } catch (_) {}
    });
  }

  _fetchInitialState() {
    if (!this.baseUrl) return;
    fetch(`${this.baseUrl}/api/state`)
      .then((r) => r.ok ? r.json() : null)
      .then((state) => {
        if (state && typeof state === 'object') {
          const d = state.data && typeof state.data === 'object' ? state.data : state;
          const status = d.status ?? d.Status ?? d.event ?? d.Event ?? state.status ?? state.Status ?? state.state ?? this._cachedStatus;
          const numThrows = Number(d.numThrows ?? d.numDarts ?? state.numThrows ?? state.numDarts ?? 0) || 0;
          if (status != null) this._cachedStatus = String(status);
          if (Number.isFinite(numThrows)) this._cachedNumThrows = numThrows;
        }
      })
      .catch(() => {});
  }

  /** Latest status from WebSocket state messages (Takeout, Stopped, Throw, etc.). */
  getCachedState() {
    return { status: this._cachedStatus, numThrows: this._cachedNumThrows };
  }

  /** Update cache (e.g. from HTTP /api/state response so remote gets status even if WS missed it). */
  setCachedState(status, numThrows) {
    if (status != null) this._cachedStatus = String(status);
    if (Number.isFinite(numThrows)) this._cachedNumThrows = numThrows;
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, RECONNECT_INTERVAL_MS);
  }

  disconnect() {
    this._intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    if (this._httpOnly) return !!this.baseUrl;
    return this.ws != null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send raw JSON over WebSocket (for future use if AutoDarts accepts WS commands).
   */
  sendRaw(jsonObj) {
    if (!this.isConnected()) return false;
    try {
      this.ws.send(JSON.stringify(jsonObj));
      return true;
    } catch (e) {
      console.error('[AutoDarts] sendRaw error:', e.message);
      return false;
    }
  }

  /**
   * GET /api/state — matches iPad app's ws.onopen fetch for verifying AutoDarts is alive.
   */
  async getState() {
    if (!this.baseUrl) throw new Error('No AutoDarts base URL');
    const url = `${this.baseUrl}/api/state`;
    const res = await fetch(url).catch((e) => {
      throw e;
    });
    if (!res.ok) throw new Error(`getState failed: HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Reset: POST /api/reset (same as iPad app).
   */
  async reset() {
    if (!this.baseUrl) throw new Error('No AutoDarts base URL');
    const url = `${this.baseUrl}/api/reset`;
    console.log('[AutoDarts] HTTP POST', url);
    const res = await fetch(url, { method: 'POST' }).catch((e) => {
      throw e;
    });
    if (!res.ok) throw new Error(`Reset failed: HTTP ${res.status}`);
    return { ok: true };
  }

  /**
   * Restart: PUT /api/start (same as iPad app — MatchGameScreen, GolfGameScreen).
   */
  async restart() {
    if (!this.baseUrl) throw new Error('No AutoDarts base URL');
    const url = `${this.baseUrl}/api/start`;
    console.log('[AutoDarts] restart() using PUT /api/start (verify if this is correct)');
    console.log('[AutoDarts] HTTP PUT', url);
    const res = await fetch(url, { method: 'PUT' }).catch((e) => {
      throw e;
    });
    if (!res.ok) throw new Error(`Restart failed: HTTP ${res.status}`);
    return { ok: true };
  }
}

function createClient(wsUrl, baseUrlOverride) {
  return new AutoDartsClient(wsUrl, baseUrlOverride);
}

module.exports = { createClient, AutoDartsClient, wsUrlToBaseUrl };
