import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import {
  buildSkinPackCollection,
  randomUuid,
} from '../../src/skin-pack-files.ts';
import { zipSkinPackBlob } from '../../src/skin-pack-zip.ts';
import { zipFileName } from '../../web/shared/file-save.ts';
import { saveOrShare } from './download.ts';
import { importSkinPackZip } from './pack-import.ts';
import { deleteSkinPack, loadSkinPack, saveSkinPack } from './pack-store.ts';
import { DEFAULT_PACK_NAME, type SkinPack, type SkinSource, type StoredSkin } from './pack-types.ts';

export interface AddSkinInput {
  name: string;
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  triangles: number;
  source: SkinSource;
}

export interface AddSkinResult {
  createdPack: boolean;
  packName: string;
  count: number;
  skinName: string;
}

export interface ImportPackResult {
  createdPack: boolean;
  imported: number;
  skipped: string[];
  packName: string;
}

export interface PackContextValue {
  pack: SkinPack | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  createPack: (name: string) => Promise<void>;
  renamePack: (name: string) => Promise<void>;
  addSkin: (input: AddSkinInput) => Promise<AddSkinResult>;
  importPack: (file: File) => Promise<ImportPackResult>;
  renameSkin: (id: string, name: string) => Promise<void>;
  removeSkin: (id: string) => Promise<void>;
  clearPack: () => Promise<void>;
  exportPack: () => Promise<{ file: string; bytes: number }>;
}

const PackContext = createContext<PackContextValue | null>(null);

export function SkinPackProvider({ children }: { children: ReactNode }) {
  const [pack, setPack] = useState<SkinPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packRef = useRef<SkinPack | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    loadSkinPack()
      .then((value) => {
        if (!active) return;
        packRef.current = value;
        setPack(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const commit = useCallback(async (next: SkinPack) => {
    next.updatedAt = Date.now();
    await saveSkinPack(next);
    packRef.current = next;
    setPack(next);
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const createPack = useCallback((name: string) => enqueue(async () => {
    if (packRef.current) throw new Error('只允许一个皮肤包，请先清空当前包');
    const now = Date.now();
    const packName = validateName(name, DEFAULT_PACK_NAME);
    await commit({
      version: 1,
      headerId: randomUuid(),
      moduleId: randomUuid(),
      name: packName,
      createdAt: now,
      updatedAt: now,
      skins: [],
    });
  }), [commit, enqueue]);

  const renamePack = useCallback((name: string) => enqueue(async () => {
    const current = packRef.current;
    if (!current) throw new Error('还没有皮肤包');
    await commit({ ...current, name: validateName(name, current.name) });
  }), [commit, enqueue]);

  const addSkin = useCallback((input: AddSkinInput) => enqueue(async () => {
    const now = Date.now();
    const createdPack = !packRef.current;
    const current: SkinPack = packRef.current ?? {
      version: 1,
      headerId: randomUuid(),
      moduleId: randomUuid(),
      // A first skin names its new pack, so the exported ZIP is not generically
      // called "我的 4D 皮肤包" when the user already typed a model name.
      name: validateName(input.name, DEFAULT_PACK_NAME),
      createdAt: now,
      updatedAt: now,
      skins: [],
    };
    const skinName = uniqueSkinName(current.skins, input.name);
    const skin: StoredSkin = {
      id: randomUuid(),
      name: skinName,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      triangles: input.triangles,
      geometry: input.geometry,
      png: new Uint8Array(input.png),
    };
    const next: SkinPack = { ...current, skins: [...current.skins, skin] };
    await commit(next);
    return { createdPack, packName: next.name, count: next.skins.length, skinName };
  }), [commit, enqueue]);

  const importPack = useCallback((file: File) => enqueue(async () => {
    const imported = await importSkinPackZip(file);
    const now = Date.now();
    const current: SkinPack = packRef.current ?? {
      version: 1,
      headerId: imported.headerId ?? randomUuid(),
      moduleId: imported.moduleId ?? randomUuid(),
      name: imported.name,
      createdAt: now,
      updatedAt: now,
      skins: [],
    };
    const createdPack = !packRef.current;
    const skins = [...current.skins];
    for (const skin of imported.skins) {
      skins.push({
        ...skin,
        name: uniqueSkinName(skins, skin.name),
        createdAt: now,
        updatedAt: now,
      });
    }
    const next: SkinPack = { ...current, skins };
    await commit(next);
    return {
      createdPack,
      imported: imported.skins.length,
      skipped: imported.skipped,
      packName: next.name,
    };
  }), [commit, enqueue]);

  const renameSkin = useCallback((id: string, name: string) => enqueue(async () => {
    const current = packRef.current;
    if (!current) throw new Error('还没有皮肤包');
    const trimmed = validateName(name, '未命名皮肤');
    if (current.skins.some((skin) => skin.id !== id && skin.name === trimmed))
      throw new Error('皮肤名称已存在');
    const next: SkinPack = {
      ...current,
      skins: current.skins.map((skin) =>
        skin.id === id ? { ...skin, name: trimmed, updatedAt: Date.now() } : skin),
    };
    await commit(next);
  }), [commit, enqueue]);

  const removeSkin = useCallback((id: string) => enqueue(async () => {
    const current = packRef.current;
    if (!current) return;
    await commit({ ...current, skins: current.skins.filter((skin) => skin.id !== id) });
  }), [commit, enqueue]);

  const clearPack = useCallback(() => enqueue(async () => {
    await deleteSkinPack();
    packRef.current = null;
    setPack(null);
  }), [enqueue]);

  const exportPack = useCallback(() => enqueue(async () => {
    const current = packRef.current;
    if (!current) throw new Error('还没有皮肤包');
    if (!current.skins.length) throw new Error('皮肤包里还没有皮肤');
    const collection = buildSkinPackCollection({
      packName: current.name,
      headerId: current.headerId,
      moduleId: current.moduleId,
      skins: current.skins.map((skin) => ({
        name: skin.name,
        geometry: skin.geometry,
        png: skin.png,
      })),
    });
    // Flat archive: every pack file is at the ZIP root, with no wrapper folder.
    const blob = await zipSkinPackBlob(collection.files);
    const file = zipFileName(current.name);
    await saveOrShare(blob, file, current.name);
    return { file, bytes: blob.size };
  }), [enqueue]);

  const withBusy = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } finally {
      setBusy(false);
    }
  }, []);

  const value: PackContextValue = {
    pack,
    loading,
    busy,
    error,
    createPack: (name) => withBusy(() => createPack(name)),
    renamePack: (name) => withBusy(() => renamePack(name)),
    addSkin: (input) => withBusy(() => addSkin(input)),
    importPack: (file) => withBusy(() => importPack(file)),
    renameSkin: (id, name) => withBusy(() => renameSkin(id, name)),
    removeSkin: (id) => withBusy(() => removeSkin(id)),
    clearPack: () => withBusy(() => clearPack()),
    exportPack: () => withBusy(() => exportPack()),
  };

  return <PackContext.Provider value={value}>{children}</PackContext.Provider>;
}

export function useSkinPack() {
  const context = useContext(PackContext);
  if (!context) throw new Error('useSkinPack must be used inside SkinPackProvider');
  return context;
}

function validateName(value: string, fallback: string) {
  const trimmed = value.trim() || fallback;
  if (trimmed.length > 128) throw new Error('名称不能超过 128 个字符');
  return trimmed;
}

function uniqueSkinName(skins: readonly StoredSkin[], value: string) {
  const base = validateName(value, '未命名皮肤').slice(0, 110);
  if (!skins.some((skin) => skin.name === base)) return base;
  let index = 2;
  let candidate = `${base} (${index})`;
  while (skins.some((skin) => skin.name === candidate)) {
    index++;
    candidate = `${base} (${index})`;
  }
  return candidate;
}
