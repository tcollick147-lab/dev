require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('./autodartsClient');

const app = express();
const PORT = process.env.PORT || 3000;

const autodartsWsUrl = (process.env.AUTODARTS_WS_URL || '').trim();
const autodartsBaseUrl = (process.env.AUTODARTS_BASE_URL || '').trim();
const autodarts = createClient(autodartsWsUrl, autodartsBaseUrl);

app.use(cors());
app.use(express.json());

// GET /health
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
  });
});

// GET /autodarts/status
app.get('/autodarts/status', (req, res) => {
  res.json({
    connected: autodarts.isConnected(),
    wsUrl: autodartsWsUrl || null,
    baseUrl: autodarts.baseUrl || null,
  });
});

// GET /autodarts/state — always fetch from Board Manager HTTP /api/state so remote gets current status
function parseStateResponse(state) {
  if (state == null || typeof state !== 'object') return { status: null, numThrows: 0 };
  const d = state.data && typeof state.data === 'object' ? state.data : state;
  const status =
    d.status ?? d.Status ?? d.state ?? d.State ?? d.event ?? d.Event ??
    state.status ?? state.Status ?? state.state ?? null;
  const numThrows = Number(d.numThrows ?? d.numDarts ?? state.numThrows ?? state.numDarts ?? 0) || 0;
  return { status: status != null ? String(status) : null, numThrows };
}

app.get('/autodarts/state', (req, res) => {
  if (!autodarts.isConnected()) {
    return res.status(200).json({ status: null, numThrows: 0 });
  }
  // Prefer WebSocket cache (same source as iPad) so remote sees Stopped/Takeout/Throw
  const cached = autodarts.getCachedState();
  if (cached.status != null) {
    return res.json({ status: cached.status, numThrows: cached.numThrows });
  }
  // Fallback: fetch from Board Manager HTTP /api/state (may use different shape)
  autodarts
    .getState()
    .then((state) => {
      const out = parseStateResponse(state);
      if (out.status != null) autodarts.setCachedState(out.status, out.numThrows);
      res.json(out);
    })
    .catch((err) => {
      console.error('[AutoDarts] getState failed:', err.message);
      res.status(200).json({ status: null, numThrows: 0 });
    });
});

// POST /remote/reset
app.post('/remote/reset', (req, res) => {
  console.log('[REMOTE] RESET request', JSON.stringify(req.body));
  if (!autodarts.isConnected()) {
    console.log('[REMOTE] RESET rejected: AutoDarts not connected');
    return res.status(503).json({ ok: false, message: 'AutoDarts not connected' });
  }
  autodarts
    .reset()
    .then(() => {
      console.log('[REMOTE] RESET sent to AutoDarts');
      res.json({ ok: true });
    })
    .catch((err) => {
      console.error('[REMOTE] RESET failed:', err.message);
      res.status(502).json({
        ok: false,
        message: 'AutoDarts reset failed',
        error: err.message,
      });
    });
});

// POST /remote/restart
app.post('/remote/restart', (req, res) => {
  console.log('[REMOTE] RESTART request', JSON.stringify(req.body));
  if (!autodarts.isConnected()) {
    console.log('[REMOTE] RESTART rejected: AutoDarts not connected');
    return res.status(503).json({ ok: false, message: 'AutoDarts not connected' });
  }
  autodarts
    .restart()
    .then(() => {
      console.log('[REMOTE] RESTART sent to AutoDarts');
      res.json({ ok: true });
    })
    .catch((err) => {
      console.error('[REMOTE] RESTART failed:', err.message);
      res.status(502).json({
        ok: false,
        message: 'AutoDarts restart failed',
        error: err.message,
      });
    });
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Darts Royale Server running on port ${PORT}`);
  if (autodartsWsUrl) {
    autodarts.connect();
  } else if (autodartsBaseUrl) {
    autodarts.connect();
  } else {
    console.log('[AutoDarts] No AUTODARTS_WS_URL or AUTODARTS_BASE_URL set; remote reset/restart will return 503');
  }
});
