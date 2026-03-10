# Darts Royale Server

Express server for the Darts Royale Remote iPhone app. Exposes health check and remote reset/restart. Connects to AutoDarts (Board Manager) so the iPad app does not need to be running for remote control.

## Install

```bash
npm install
```

## Configuration (env)

Create a `.env` file in the project root (or set env vars):

- **PORT** – Server port (default `3000`).
- **AUTODARTS_WS_URL** – AutoDarts WebSocket URL, e.g. `ws://192.168.0.18:3180/api/events`. Used for connection status; the HTTP base URL is derived for reset/restart (`POST /api/reset`, `PUT /api/start`).
- **AUTODARTS_BASE_URL** – Optional. AutoDarts HTTP base, e.g. `http://192.168.0.18:3180`. If you set this and not `AUTODARTS_WS_URL`, the server runs in HTTP-only mode (no WebSocket; commands still work).

Copy `.env.example` to `.env` and fill in your AutoDarts host/port.

## Start the server

```bash
node server.js
```

Or:

```bash
npm start
```

The server listens on `0.0.0.0` so other devices (e.g. iPhone) can reach it. You should see:

- `Darts Royale Server running on port 3000`
- `[AutoDarts] WebSocket connected to ...` or `[AutoDarts] HTTP-only mode: base URL ...` when AutoDarts is configured.

## Test endpoints

**Health (browser or curl):**

```bash
curl http://localhost:3000/health
```

Expected: `{"ok":true,"serverTime":"2025-03-02T12:00:00.000Z"}`

**Reset (requires AutoDarts configured):**

```bash
curl -X POST http://localhost:3000/remote/reset -H "Content-Type: application/json" -d "{\"source\":\"iphone-remote\",\"timestamp\":12345}"
```

**Restart:**

```bash
curl -X POST http://localhost:3000/remote/restart -H "Content-Type: application/json" -d "{\"source\":\"iphone-remote\",\"timestamp\":12345}"
```

If AutoDarts is not connected or not configured, reset/restart return **503** `{"ok":false,"message":"AutoDarts not connected"}`.

## TESTING (Windows PowerShell)

Test from the PC without using the phone:

**Start server:**

```powershell
cd C:\dev\darts-royale-server
node server.js
```

**Check server health:**

```powershell
Invoke-RestMethod http://localhost:3000/health
```

**Check AutoDarts status:**

```powershell
Invoke-RestMethod http://localhost:3000/autodarts/status
```

**Trigger reset:**

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/remote/reset -Body "{}" -ContentType "application/json"
```

**Trigger restart:**

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/remote/restart -Body "{}" -ContentType "application/json"
```

**Note:** AutoDarts is expected at `http://192.168.1.18:3180` and `ws://192.168.1.18:3180/api/events` (same as the main project config). If requests fail, check Windows firewall and that the Board Manager (AutoDarts) is running.

## Windows firewall

If other devices cannot connect, allow inbound TCP on the server port (default 3000):

1. **Windows Defender Firewall** → **Advanced settings** → **Inbound Rules** → **New Rule** → **Port** → TCP `3000` → Allow.
2. Or (run as Administrator):  
   `netsh advfirewall firewall add rule name="Darts Royale Server" dir=in action=allow protocol=TCP localport=3000`
