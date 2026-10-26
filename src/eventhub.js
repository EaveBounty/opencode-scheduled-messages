import { log } from "./util.js";

/**
 * One upstream SSE connection, fanned out to every browser. OpenCode does not
 * replay missed events, so clients refetch state after reconnecting.
 */
export class EventHub {
  constructor({ client, logger = log } = {}) {
    this.client = client;
    this.logger = logger;
    this.listeners = new Set();
    this.running = false;
    this.connecting = false;
    this.abort = null;
    this.retryTimer = null;
    this.retryMs = 1_000;
    this.connected = false;
    this.lastEventAt = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.connected = false;
    this.abort?.abort();
    this.abort = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger("debug", "SSE listener failed", { error: error.message });
      }
    }
  }

  async connect() {
    if (!this.running || this.connecting) return;
    this.connecting = true;
    this.abort = new AbortController();
    try {
      for await (const event of this.client.eventStream({ signal: this.abort.signal })) {
        if (!this.connected) {
          this.connected = true;
          this.retryMs = 1_000;
          this.broadcast({ type: "upstream.connected", at: Date.now() });
          this.logger("info", "Subscribed to OpenCode event stream");
        }
        this.lastEventAt = Date.now();
        this.broadcast(event);
      }
      throw new Error("event stream ended");
    } catch (error) {
      if (!this.running) return;
      this.connected = false;
      this.broadcast({ type: "upstream.disconnected", error: error.message, at: Date.now() });
      this.logger("warn", "OpenCode event stream disconnected; reconnecting", {
        error: error.message,
        inMs: this.retryMs,
      });
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryTimer.unref?.();
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    } finally {
      this.connecting = false;
    }
  }

  status() {
    return {
      connected: this.connected,
      lastEventAt: this.lastEventAt,
    };
  }
}
