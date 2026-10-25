import { useCallback, useEffect, useState } from "react";
import { useStore } from "../../app/store";
import { deleteProject, getProject, listProjects, saveProject, type ProjectSummary } from "../../lib/projects";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/toast";
import { saveCurrentProject } from "./saveProject";

export function ProjectsPanel({ visible }: { visible: boolean }) {
  const { session, shade, setTab } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listProjects());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saved projects couldn't be loaded.");
      setItems([]);
    }
  }, []);
  useEffect(() => { if (visible) void refresh(); }, [visible, refresh]);

  const open = async (id: string) => {
    if (!session) return;
    const p = await getProject(id);
    if (!p) { toast("That project no longer exists."); void refresh(); return; }
    await session.restore(p.snapshot);
    setTab("paint");
    toast(`Opened ${p.name}.`);
  };

  const rename = async (id: string, name: string) => {
    const p = await getProject(id);
    if (p && name.trim()) await saveProject({ ...p, name: name.trim(), updatedAt: Date.now() });
    setEditing(null);
    void refresh();
  };

  const saveNow = async () => {
    if (!session) return;
    try {
      await saveCurrentProject(session, "My room");
      toast("Saved.");
      void refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The project couldn't be saved.");
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="eyebrow">Saved</span>
          <h2>Your rooms</h2>
        </div>
        <button type="button" className="btn primary small" onClick={() => void saveNow()}><Icon name="save" />Save current</button>
      </div>
      {error && <p className="fine" style={{ color: "var(--bad)" }}>{error}</p>}
      {items && items.length === 0 && !error && <p className="empty">Nothing saved yet. Paint a room and tap Save to keep it on this device.</p>}
      <div className="projects">
        {items?.map((p) => (
          <article key={p.id} className="project">
            <button type="button" onClick={() => void open(p.id)} style={{ padding: 0, border: 0, background: "none" }} aria-label={`Open ${p.name}`}>
              <img src={p.thumbnail} alt="" loading="lazy" />
            </button>
            <div className="info">
              {editing === p.id ? (
                <form onSubmit={(e) => { e.preventDefault(); void rename(p.id, (e.currentTarget.elements.namedItem("name") as HTMLInputElement).value); }}>
                  <label className="sr" htmlFor={`pn-${p.id}`}>Project name</label>
                  <input id={`pn-${p.id}`} name="name" className="input" defaultValue={p.name} autoFocus onBlur={(e) => void rename(p.id, e.target.value)} />
                </form>
              ) : (
                <span className="pname">{p.name}</span>
              )}
              <span className="dots">{p.shades.slice(0, 6).map((id, i) => <i key={i} style={{ background: shade(id)?.hex ?? "#ccc" }} title={shade(id)?.name} />)}</span>
              {confirmDelete === p.id ? (
                <div className="row">
                  <button type="button" className="btn small" style={{ color: "var(--bad)" }} onClick={async () => { await deleteProject(p.id); setConfirmDelete(null); void refresh(); }}>Delete</button>
                  <button type="button" className="btn small ghost" onClick={() => setConfirmDelete(null)}>Keep</button>
                </div>
              ) : (
                <div className="row">
                  <button type="button" className="btn small ghost" aria-label={`Rename ${p.name}`} onClick={() => setEditing(p.id)}><Icon name="edit" /></button>
                  <button type="button" className="btn small ghost" aria-label={`Delete ${p.name}`} onClick={() => setConfirmDelete(p.id)}><Icon name="trash" /></button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="fine">Projects are stored on this device only. Clearing your browser data removes them.</p>
    </div>
  );
}
