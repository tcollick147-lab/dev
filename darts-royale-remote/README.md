# Darts Royale Remote

iPhone remote control app for Darts Royale. It only sends **RESET** and **RESTART** commands to your PC server over HTTP (no direct AutoDarts connection).

## How to run

1. Install dependencies (already done if you cloned/fresh-created):
   ```bash
   npm install
   ```

2. Start the Expo dev server:
   ```bash
   npm start
   ```

3. Open the project in **Expo Go** on your iPhone (scan the QR code or enter the URL). The app is intended for iPhone but will run in Expo Go on other devices.

## How to configure the server IP

1. Open the app. If no server IP is set, you’ll see **Settings** first.
2. In **Settings**:
   - **Server IP**: Your PC’s LAN IP (e.g. `192.168.0.50`).
   - **Port**: Server port (default `3000`).
3. Tap **Test Connection** to verify the server is reachable (it calls `GET /health`).
4. Tap **Save** to store the values and return to the Remote screen.

If an IP is already saved, the app opens on the **Remote** screen. Use the **Settings** link at the bottom to change IP/port.

## Server API expected by the app

Your PC server should expose:

- **GET** `/health` → `{ "ok": true, "serverTime": "..." }`
- **POST** `/remote/reset`  → body: `{ "source": "iphone-remote", "timestamp": <unixSeconds> }` → `{ "ok": true }` or `{ "ok": false, "message": "..." }`
- **POST** `/remote/restart` → same body/response

Connection status is shown on the Remote screen and is refreshed every 5 seconds. RESET and RESTART are only enabled when the app is connected.
