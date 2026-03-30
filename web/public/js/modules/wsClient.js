/**
 * WebSocket Client Module
 * Manages real-time communication with server
 */

export class WSClient {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        console.log('[WS] Connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'connected') {
            this.clientId = data.clientId;
            console.log('[WS] Client ID:', this.clientId);
            resolve(this.clientId);
            return;
          }

          // Emit to listeners
          const handlers = this.listeners.get(data.type) || [];
          handlers.forEach(fn => fn(data));

          // Also emit to wildcard listeners
          const wildcardHandlers = this.listeners.get('*') || [];
          wildcardHandlers.forEach(fn => fn(data));
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
          console.log(`[WS] Reconnecting in ${delay}ms...`);
          setTimeout(() => this.connect(), delay);
        }
      };

      setTimeout(() => reject(new Error('WS connection timeout')), 5000);
    });
  }

  on(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  off(type, handler) {
    const handlers = this.listeners.get(type);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx > -1) handlers.splice(idx, 1);
    }
  }

  getClientId() {
    return this.clientId;
  }
}
