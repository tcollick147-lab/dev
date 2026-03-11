import { useCallback, useEffect, useRef, useState } from "react";

export type AutoDartsStatus = {
  status?: string;
  event?: string;
  numThrows?: number;
};

export type AutoDartsSegment = {
  name?: string;        // e.g. "S20", "D16", "T19", "Bull", "M8"
  number?: number;      // 1..20 or 25
  bed?: string;         // "SingleInner" | "SingleOuter" | "Double" | "Triple" ...
  multiplier?: number;  // 1 | 2 | 3
};

export type AutoDartsThrow = {
  segment?: AutoDartsSegment;
  coords?: { x?: number; y?: number };
};

type Options = {
  /** AutoDarts websocket URL (see config/autodarts.ts AUTO_WS_URL) */
  url: string;

  /** Board Manager base URL for hard reset (see config/autodarts.ts AUTO_BASE_URL) */
  baseUrl: string;

  enabled?: boolean;

  /** Legacy: called for each newly detected dart as a string */
  onDart?: (dartCode: string) => void;

  /** NEW: called for each newly detected dart as the raw throw payload */
  onThrow?: (t: AutoDartsThrow) => void;

  /** Called when a turn should auto-commit (typically when 3 darts are present) */
  onTurnAutoCommit?: () => void;

  /** Optional: status updates */
  onStatus?: (s: AutoDartsStatus) => void;

  /** Debug logging toggle */
  debug?: boolean;
};

function segmentToCode(seg: AutoDartsSegment | undefined): string {
  if (!seg) return "MISS";

  const name = String(seg.name ?? "").trim();
  const bed = String(seg.bed ?? "").toLowerCase();
  const num = Number(seg.number ?? NaN);
  const mult = Number(seg.multiplier ?? NaN);

  // Miss near X: M8 => MISS
  if (name.toUpperCase().startsWith("M")) return "MISS";

  // Bulls
  if (name.toLowerCase() === "bull" || num === 25) {
    if (mult === 2 || bed.includes("double")) return "DB";
    return "SB";
  }

  // Already formatted like S20/D16/T19
  const m = name.match(/^([SDT])\s*(\d{1,2})$/i);
  if (m) return `${m[1].toUpperCase()}${Number(m[2])}`;

  // If numeric, infer with multiplier
  if (Number.isFinite(num) && num >= 1 && num <= 20) {
    if (mult === 3) return `T${num}`;
    if (mult === 2) return `D${num}`;
    return `S${num}`;
  }

  // Last resort: parse name as number
  const maybeNum = Number(name);
  if (Number.isFinite(maybeNum) && maybeNum >= 1 && maybeNum <= 20) {
    if (mult === 3) return `T${maybeNum}`;
    if (mult === 2) return `D${maybeNum}`;
    return `S${maybeNum}`;
  }

  return "MISS";
}

// Stable key for a throw (coords rounded to avoid jitter)
function throwKey(t: AutoDartsThrow) {
  const seg = t?.segment ?? {};
  const name = String(seg.name ?? "");
  const num = String(seg.number ?? "");
  const mult = String(seg.multiplier ?? "");
  const bed = String(seg.bed ?? "");

  const x = typeof t?.coords?.x === "number" ? t.coords!.x!.toFixed(2) : "";
  const y = typeof t?.coords?.y === "number" ? t.coords!.y!.toFixed(2) : "";

  return `${name}|${num}|${mult}|${bed}|${x},${y}`;
}

export function useAutoDarts(options: Options) {
  const { url, baseUrl, enabled = true, debug = true } = options;
  const [connected, setConnected] = useState(false);

  // ✅ Keep latest callbacks in refs so WS does NOT reconnect every render
  const onDartRef = useRef<Options["onDart"]>(options.onDart);
  const onThrowRef = useRef<Options["onThrow"]>(options.onThrow);
  const onTurnAutoCommitRef = useRef<Options["onTurnAutoCommit"]>(options.onTurnAutoCommit);
  const onStatusRef = useRef<Options["onStatus"]>(options.onStatus);

  useEffect(() => {
    onDartRef.current = options.onDart;
    onThrowRef.current = options.onThrow;
    onTurnAutoCommitRef.current = options.onTurnAutoCommit;
    onStatusRef.current = options.onStatus;
  }, [options.onDart, options.onThrow, options.onTurnAutoCommit, options.onStatus]);

  const seenThrowKeysRef = useRef<Set<string>>(new Set());
  const lastNumThrowsRef = useRef<number>(0);
  const committedThisTurnRef = useRef<boolean>(false);

  // Keep the latest baseUrl in a ref for stable callbacks
  const baseUrlRef = useRef(baseUrl);
  useEffect(() => {
    baseUrlRef.current = baseUrl;
  }, [baseUrl]);

  /**
   * HARD reset (real Board Manager reset).
   * This is the same call the browser UI makes:
   *   POST http://<board-ip>:3180/api/reset
   */
  const forceBoardReset = useCallback(async () => {
    const root = String(baseUrlRef.current ?? "").replace(/\/+$/, "");
    const resetUrl = `${root}/api/reset`;

    if (debug) console.log("[AutoDarts] forceBoardReset", resetUrl);

    try {
      const res = await fetch(resetUrl, { method: "POST" });

      if (!res.ok) {
        debug && console.log("[AutoDarts] forceBoardReset failed", res.status);
      }
    } catch (err) {
      debug && console.log("[AutoDarts] forceBoardReset error", err);
    } finally {
      // Clear local tracking so next state/throws are processed cleanly
      seenThrowKeysRef.current = new Set();
      lastNumThrowsRef.current = 0;
      committedThisTurnRef.current = false;
    }
  }, [debug]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    activeRef.current = true;

    function connect() {
      if (!activeRef.current) return;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;

      if (debug) console.log("[AutoDarts] connect", url);

      ws.onopen = () => {
        setConnected(true);
        // Sync current board state (e.g. Takeout + 3 darts) so UI is correct after app restart
        const root = String(baseUrlRef.current ?? "").replace(/\/+$/, "");
        fetch(`${root}/api/state`)
          .then((r) => r.json())
          .then((data: any) => {
            const status = data?.status;
            const numThrows = Number(data?.numThrows ?? data?.numDarts ?? 0);
            if (status != null || Number.isFinite(numThrows)) {
              onStatusRef.current?.({ status: status ?? "", numThrows });
            }
          })
          .catch(() => {});
      };
      ws.onerror = () => {
        setConnected(false);
        if (!activeRef.current) return;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!activeRef.current) return;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg?.type !== "state") return;

        const data = msg?.data ?? {};
        const numThrows = Number(data.numThrows ?? 0);
        const throws: AutoDartsThrow[] = Array.isArray(data.throws) ? data.throws : [];

        // Debug: log every state update with throws so coords are visible in terminal
        if (throws.length > 0) {
          console.log("[AutoDarts] state numThrows=" + numThrows + " throws=" + throws.length);
          throws.forEach((t, i) => {
            const c = t?.coords;
            console.log("[AutoDarts] coords[" + i + "] x=" + (c?.x ?? "—") + " y=" + (c?.y ?? "—"));
          });
        }

        onStatusRef.current?.({ status: data.status, event: data.event, numThrows });

        const statusStr = String(data.status ?? "").toLowerCase();
        const isTakeoutInProgress = statusStr.includes("takeout") && statusStr.includes("progress");
        if (isTakeoutInProgress) return; // User removing darts; never emit throws from this status

        // Clear/reset detection (state moved backwards or cleared)
        const cleared = numThrows <= 0 || throws.length === 0;
        if (cleared) {
          lastNumThrowsRef.current = 0;
          committedThisTurnRef.current = false;
          return;
        }
        // Count dropped (e.g. 3 → 1): board was cleared, this message has darts from the next round (e.g. CtB with 4+ players)
        if (numThrows < lastNumThrowsRef.current) {
          lastNumThrowsRef.current = numThrows;
          committedThisTurnRef.current = false;
          if (throws.length === 0) return;
          // Fall through to emit the new throw(s)
        } else {
          lastNumThrowsRef.current = numThrows;
        }

        // Emit only truly new throws
        for (const t of throws) {
          const k = throwKey(t);
          if (seenThrowKeysRef.current.has(k)) continue;

          seenThrowKeysRef.current.add(k);

          if (debug) console.log("[AutoDarts][throw]", JSON.stringify(t));
          const c = t?.coords;
          if (c && (typeof c.x === "number" || typeof c.y === "number")) {
            console.log("[AutoDarts] coords", { x: c.x, y: c.y });
          } else {
            console.log("[AutoDarts] coords", "none");
          }

          onThrowRef.current?.(t);

          const dartCode = segmentToCode(t?.segment);
          onDartRef.current?.(dartCode);
        }

        // Commit once when reaching 3
        if (!committedThisTurnRef.current && (numThrows >= 3 || throws.length >= 3)) {
          committedThisTurnRef.current = true;
          onTurnAutoCommitRef.current?.();
        }
      } catch (err) {
        debug && console.log("[AutoDarts] parse error", err);
      }
    };
    }

    connect();

    return () => {
      activeRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnected(false);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [url, enabled, debug]);

  return { forceBoardReset, connected };
}
