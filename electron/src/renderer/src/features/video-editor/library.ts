/**
 * The editor's project library: every project is its own storage entry, and
 * an index lists them with what the library shows (name, format, when it was
 * last opened). The first editor release kept one project under
 * `voicestudio.editor.v1`; the first time the library is read that project is
 * copied in, and the old entry is left as it was.
 */
import {
  PROJECT_KEY,
  emptyProject,
  newId,
  parseProject,
  safeStorage,
  serializeProject,
  type EditorProject,
  type EditorShape,
} from './project';

export const LIBRARY_KEY = 'voicestudio.editor.library.v1';
export const projectKey = (id: string): string => `voicestudio.editor.project.${id}`;

export interface ProjectSummary {
  id: string;
  name: string;
  shape: EditorShape;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  openedAt: number;
}

export interface Library {
  version: 1;
  /** The project the editor opens with. */
  current: string | null;
  projects: ProjectSummary[];
}

export type LibraryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A project opened from the library: its id travels with it, so a save never lands on another project. */
export interface OpenProject {
  id: string;
  project: EditorProject;
}

const emptyLibrary = (): Library => ({ version: 1, current: null, projects: [] });

function summaryOf(id: string, project: EditorProject, now: number, created = now): ProjectSummary {
  return { id, name: project.name, shape: project.shape, createdAt: created, updatedAt: now, openedAt: now };
}

function parseLibrary(raw: string | null): Library | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<Library>;
    if (saved.version !== 1 || !Array.isArray(saved.projects)) return null;
    const projects = saved.projects.filter(
      (item): item is ProjectSummary => !!item && typeof item.id === 'string' && typeof item.name === 'string',
    );
    const current = projects.some((item) => item.id === saved.current) ? (saved.current as string) : null;
    return { version: 1, current, projects };
  } catch {
    return null;
  }
}

/** Writes the index; false when storage refused it (full or blocked). */
function writeLibrary(storage: LibraryStorage | null, library: Library): boolean {
  try {
    storage?.setItem(LIBRARY_KEY, JSON.stringify(library));
    return !!storage;
  } catch {
    return false;
  }
}

function writeProject(storage: LibraryStorage | null, id: string, project: EditorProject): boolean {
  try {
    storage?.setItem(projectKey(id), serializeProject(project));
    return !!storage;
  } catch {
    return false;
  }
}

/**
 * The library, created on first use. A project from the first editor release
 * becomes the library's first project; its old entry is never removed, so
 * reading the library again (or going back to an older build) loses nothing.
 */
export function readLibrary(storage: LibraryStorage | null = safeStorage(), now = Date.now()): Library {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(LIBRARY_KEY) ?? null;
  } catch {
    return emptyLibrary();
  }
  const saved = parseLibrary(raw);
  if (saved) return saved;
  const library = emptyLibrary();
  let legacy: EditorProject | null = null;
  try {
    legacy = parseProject(storage?.getItem(PROJECT_KEY));
  } catch {
    legacy = null;
  }
  if (legacy) {
    const id = newId();
    if (writeProject(storage, id, legacy)) {
      library.projects.push(summaryOf(id, legacy, now));
      library.current = id;
    }
  }
  writeLibrary(storage, library);
  return library;
}

/** Projects with the most recently opened first. */
export function recentProjects(library: Library): ProjectSummary[] {
  return [...library.projects].sort((a, b) => b.openedAt - a.openedAt || b.updatedAt - a.updatedAt);
}

export function readProject(storage: LibraryStorage | null, id: string): EditorProject | null {
  try {
    return parseProject(storage?.getItem(projectKey(id)));
  } catch {
    return null;
  }
}

/** A new empty project, added to the library and opened. */
export function createProject(
  storage: LibraryStorage | null = safeStorage(),
  now = Date.now(),
  base: EditorProject = emptyProject(),
): { library: Library; opened: OpenProject; saved: boolean } {
  const library = readLibrary(storage, now);
  const id = newId();
  const saved = writeProject(storage, id, base);
  const next: Library = { ...library, current: id, projects: [...library.projects, summaryOf(id, base, now)] };
  return { library: next, opened: { id, project: base }, saved: writeLibrary(storage, next) && saved };
}

/**
 * Opens a project: the library remembers it as the current one. Falls back to
 * the most recent project, or a new one, when `id` is gone.
 */
export function openProject(
  storage: LibraryStorage | null = safeStorage(),
  id: string | null = null,
  now = Date.now(),
): { library: Library; opened: OpenProject } {
  const library = readLibrary(storage, now);
  const candidates = [id ?? library.current, ...recentProjects(library).map((item) => item.id)].filter(
    (item): item is string => !!item,
  );
  for (const candidate of candidates) {
    const project = readProject(storage, candidate);
    if (!project) continue;
    const next: Library = {
      ...library,
      current: candidate,
      projects: library.projects.map((item) => (item.id === candidate ? { ...item, openedAt: now } : item)),
    };
    writeLibrary(storage, next);
    return { library: next, opened: { id: candidate, project } };
  }
  const created = createProject(storage, now);
  return { library: created.library, opened: created.opened };
}

/** Saves a project under its own id and refreshes its library entry; false when storage refused it. */
export function saveLibraryProject(
  storage: LibraryStorage | null,
  opened: OpenProject,
  now = Date.now(),
): { library: Library; saved: boolean } {
  const library = readLibrary(storage, now);
  const saved = writeProject(storage, opened.id, opened.project);
  const known = library.projects.find((item) => item.id === opened.id);
  const summary = known
    ? { ...known, name: opened.project.name, shape: opened.project.shape, updatedAt: now }
    : summaryOf(opened.id, opened.project, now);
  const next: Library = {
    ...library,
    projects: known
      ? library.projects.map((item) => (item.id === opened.id ? summary : item))
      : [...library.projects, summary],
  };
  return { library: next, saved: writeLibrary(storage, next) && saved };
}

export function renameProject(
  storage: LibraryStorage | null,
  id: string,
  name: string,
  now = Date.now(),
): Library {
  const project = readProject(storage, id);
  if (!project) return readLibrary(storage, now);
  return saveLibraryProject(storage, { id, project: { ...project, name } }, now).library;
}

/**
 * A copy of a project under `name`. Both point at the same uploaded files,
 * which is why deleting a project never deletes its media.
 */
export function duplicateProject(
  storage: LibraryStorage | null,
  id: string,
  name: string,
  now = Date.now(),
): { library: Library; copyId: string | null } {
  const project = readProject(storage, id);
  const before = readLibrary(storage, now);
  if (!project) return { library: before, copyId: null };
  const created = createProject(storage, now, { ...structuredClone(project), name });
  // Duplicating does not open the copy: the current project stays current.
  const next = { ...created.library, current: before.current };
  writeLibrary(storage, next);
  return { library: next, copyId: created.opened.id };
}

/** Removes a project from the library. Its uploaded files stay: other projects may use them. */
export function deleteProject(storage: LibraryStorage | null, id: string, now = Date.now()): Library {
  const library = readLibrary(storage, now);
  try {
    storage?.removeItem(projectKey(id));
  } catch {
    // The index below no longer lists it either way.
  }
  const projects = library.projects.filter((item) => item.id !== id);
  const next: Library = {
    ...library,
    projects,
    current: library.current === id ? (recentProjects({ ...library, projects })[0]?.id ?? null) : library.current,
  };
  writeLibrary(storage, next);
  return next;
}
