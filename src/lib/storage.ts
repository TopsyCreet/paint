/** Safe localStorage helpers: storage can be missing or throw (private mode, blocked). */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function removeKey(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
