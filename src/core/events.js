// Tiny synchronous event bus. See ARCHITECTURE.md §Events for the event catalogue.
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { let s = this.map.get(name); if (!s) this.map.set(name, s = new Set()); s.add(fn); return () => s.delete(fn); }
  once(name, fn) { const off = this.on(name, (p) => { off(); fn(p); }); return off; }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, payload) {
    const s = this.map.get(name); if (!s) return;
    for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error(`event handler for "${name}" threw`, e); } }
  }
}
