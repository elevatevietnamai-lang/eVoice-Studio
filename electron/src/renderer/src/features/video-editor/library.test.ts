import { describe, expect, it } from 'vitest';
import {
  LIBRARY_KEY,
  createProject,
  deleteProject,
  duplicateProject,
  openProject,
  projectKey,
  readLibrary,
  readProject,
  recentProjects,
  renameProject,
  saveLibraryProject,
} from './library';
import { PROJECT_KEY, emptyProject, saveProject, type EditorMedia, type EditorProject } from './project';
import { addCaptions, insertMedia, setKeepPitch, setKeyframe, setSpeed } from './timeline-ops';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

const clip: EditorMedia = {
  id: 'm1',
  kind: 'video',
  name: 'a.mp4',
  url: '/promo/media/m1',
  duration: 6,
  width: 1920,
  height: 1080,
  has_audio: true,
};

/** A project as the first editor release saved it: keyframes, captions and a sped-up clip. */
function firstReleaseProject(): EditorProject {
  const placed = insertMedia({ ...emptyProject(), name: 'Holiday' }, clip, 0);
  let project = setKeyframe(placed.project, placed.ref, 'opacity', 1, 0.5);
  // The first release sped clips up without keeping their pitch.
  project = setKeepPitch(setSpeed(project, placed.ref, 2), placed.ref, false);
  return addCaptions(project, [{ start: 0.5, end: 1.5, text: 'Hello there' }], { width: 1080, height: 1920 });
}

describe('project library', () => {
  it('copies the first release project in without touching the old entry', () => {
    const storage = memoryStorage();
    const legacy = firstReleaseProject();
    saveProject(legacy, storage);
    const raw = storage.store.get(PROJECT_KEY);

    const library = readLibrary(storage, 100);
    expect(library.projects).toHaveLength(1);
    expect(library.projects[0]).toMatchObject({ name: 'Holiday', shape: 'vertical' });
    expect(library.current).toBe(library.projects[0].id);
    const migrated = readProject(storage, library.projects[0].id)!;
    expect(migrated).toEqual(legacy);
    // Keyframes, captions and the old speed (pitch not kept) all survive as saved.
    const main = migrated.tracks.main.elements[0];
    expect(main.animations).toEqual(legacy.tracks.main.elements[0].animations);
    expect('retime' in main && main.retime).toEqual({ rate: 2, maintainPitch: false });
    expect(migrated.tracks.overlay[0].elements[0]).toMatchObject({ type: 'text', name: 'Hello there' });
    expect(storage.store.get(PROJECT_KEY)).toBe(raw);
  });

  it('migrates once: reading again keeps one copy', () => {
    const storage = memoryStorage();
    saveProject(firstReleaseProject(), storage);
    const first = readLibrary(storage, 100);
    const again = readLibrary(storage, 200);
    expect(again).toEqual(first);
    expect([...storage.store.keys()].filter((key) => key.startsWith('voicestudio.editor.project.'))).toHaveLength(1);
  });

  it('starts empty without an old project, and with a broken one', () => {
    expect(readLibrary(memoryStorage(), 1).projects).toEqual([]);
    expect(readLibrary(memoryStorage({ [PROJECT_KEY]: '{broken' }), 1).projects).toEqual([]);
  });

  it('opens the current project, or creates one when there is none', () => {
    const storage = memoryStorage();
    const { opened, library } = openProject(storage, null, 5);
    expect(opened.project).toEqual(emptyProject());
    expect(library.current).toBe(opened.id);
    expect(openProject(storage, null, 6).opened.id).toBe(opened.id);
  });

  it('saves each project under its own id', () => {
    const storage = memoryStorage();
    const a = createProject(storage, 1).opened;
    const b = createProject(storage, 2).opened;
    saveLibraryProject(storage, { id: a.id, project: { ...a.project, name: 'A' } }, 3);
    saveLibraryProject(storage, { id: b.id, project: { ...b.project, name: 'B', shape: 'square' } }, 4);
    expect(readProject(storage, a.id)!.name).toBe('A');
    expect(readProject(storage, b.id)).toMatchObject({ name: 'B', shape: 'square' });
    const summaries = readLibrary(storage).projects;
    expect(summaries.find((item) => item.id === b.id)).toMatchObject({ name: 'B', shape: 'square', updatedAt: 4 });
  });

  it('lists the most recently opened first', () => {
    const storage = memoryStorage();
    const a = createProject(storage, 1).opened;
    const b = createProject(storage, 2).opened;
    openProject(storage, a.id, 3);
    expect(recentProjects(readLibrary(storage)).map((item) => item.id)).toEqual([a.id, b.id]);
  });

  it('renames, duplicates and deletes', () => {
    const storage = memoryStorage();
    const source = firstReleaseProject();
    const a = createProject(storage, 1, source).opened;
    renameProject(storage, a.id, 'Trip', 2);
    expect(readProject(storage, a.id)!.name).toBe('Trip');

    const { library, copyId } = duplicateProject(storage, a.id, 'Trip copy', 3);
    expect(library.current).toBe(a.id);
    const copy = readProject(storage, copyId!)!;
    expect(copy).toEqual({ ...readProject(storage, a.id)!, name: 'Trip copy' });

    const after = deleteProject(storage, a.id, 4);
    expect(after.projects.map((item) => item.id)).toEqual([copyId]);
    expect(after.current).toBe(copyId);
    expect(storage.store.has(projectKey(a.id))).toBe(false);
    // The copy still points at the shared upload.
    expect(readProject(storage, copyId!)!.media).toEqual([clip]);
  });

  it('reports a save that storage refused', () => {
    const storage = memoryStorage();
    const opened = createProject(storage, 1).opened;
    const full = {
      ...storage,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(saveLibraryProject(full, opened, 2).saved).toBe(false);
    expect(saveLibraryProject(storage, opened, 2).saved).toBe(true);
  });

  it('ignores an index it cannot read and keeps the old project', () => {
    const storage = memoryStorage();
    saveProject(firstReleaseProject(), storage);
    storage.store.set(LIBRARY_KEY, 'nonsense');
    expect(readLibrary(storage, 1).projects).toHaveLength(1);
  });
});
