/**
 * AutoDarts / Board Manager connection config.
 * Change AUTO_BASE_URL here to point at your board server (e.g. your PC's LAN IP).
 */

/** HTTP base URL for Board Manager API (reset, etc.) */
export const AUTO_BASE_URL = "http://192.168.1.18:3180";

/** WebSocket URL for live dart events (derived from base) */
export const AUTO_WS_URL = AUTO_BASE_URL.replace(/^http/, "ws") + "/api/events";
