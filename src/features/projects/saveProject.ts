import type { PaintSession } from "../../engine/session";
import { track } from "../../lib/analytics";
import { saveProject } from "../../lib/projects";

export async function saveCurrentProject(session: PaintSession, baseName: string): Promise<string> {
  const snapshot = await session.serialize();
  if (!snapshot) throw new Error("Capture the camera frame first, then save.");
  const thumbnail = await session.thumbnail(360);
  const now = Date.now();
  const date = new Date(now).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const id = `p${now.toString(36)}`;
  await saveProject({ id, name: `${baseName} · ${date}`, createdAt: now, updatedAt: now, thumbnail, snapshot });
  track("project_saved", { surfaces: snapshot.surfaces.filter((s) => s.mask).length });
  return id;
}
