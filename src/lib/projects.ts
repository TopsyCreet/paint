import type { SessionSnapshot } from "../engine/session";

/** Saved paint projects in IndexedDB (photos are too large for localStorage). */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: string;
  snapshot: SessionSnapshot;
}

export type ProjectSummary = Omit<Project, "snapshot"> & { shades: string[] };

const DB = "colour-studio";
const STORE = "projects";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("Saving isn't available in this browser.")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open saved projects."));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Saved projects couldn't be read."));
        t.oncomplete = () => db.close();
      }),
  );
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<Project[]>("readonly", (s) => s.getAll() as IDBRequest<Project[]>);
  return all
    .map(({ snapshot, ...rest }) => ({ ...rest, shades: snapshot.surfaces.filter((x) => x.mask).map((x) => x.shadeId) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Promise<Project | undefined> {
  return tx<Project | undefined>("readonly", (s) => s.get(id) as IDBRequest<Project | undefined>);
}

export function saveProject(p: Project): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(p));
}

export function deleteProject(id: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}
