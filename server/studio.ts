import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import type {
  EditSettings,
  LoadedSession,
  MaterialSummary,
  PartSummary,
} from '../src/api-types.ts';
import { autoProfile } from '../src/auto-profile.ts';
import type { HumanoidProfile, PreparedHumanoid } from '../src/humanoid.ts';
import { importModel } from '../src/importer.ts';
import type { IntermediateModel } from '../src/model.ts';
import { assignParts, materialKeyMap } from '../src/parts.ts';
import { materialThumbnail } from '../src/material-thumbnail.ts';
import { normalizeSelection, selectionFingerprint, materialDisplayLabels } from '../src/selection.ts';
import { PackManager } from '../src/pack-manager.ts';
import type { ManagerConfig } from '../src/pack-manager.ts';
import type { PackMeta } from '../src/pack-types.ts';
import type { PreparedOptimization } from '../src/optimizer.ts';
import { buildPersonaRecipe } from '../src/persona-recipe.ts';
import {
  buildPreviewGlb,
  PREVIEW_TEXTURE_LIMIT,
} from '../src/preview-asset.ts';
import type { SkinPackFiles } from '../src/skin-pack-files.ts';
import {
  dataRoot,
  resolveManagerConfig,
  storage,
} from '../src/workspace-storage.ts';
import {
  listModels,
  rememberModel,
  updateModel,
} from './model-library.ts';
import { fileExists, pathExists, readFileBytes } from './fs.ts';
import { ownModel } from './source-archive.ts';

export type { LoadedSession } from '../src/api-types.ts';

export interface Preset {
  id: string;
  name: string;
  path: string;
  cache?: string;
  profile: string;
}

export type SessionMaterial = MaterialSummary;

export interface Session {
  modelId: string;
  model: IntermediateModel;
  preview: Uint8Array;
  profile: HumanoidProfile | null;
  name: string;
  materials: MaterialSummary[];
  parts: PartSummary[];
  fingerprint: string;
}

export interface Job {
  status: 'running' | 'done' | 'error';
  message: string;
  result?: unknown;
  files?: SkinPackFiles;
  texture?: Uint8Array;
  geometry?: unknown;
  key?: string;
  meta?: PackMeta;
}

export type PreparedState = {
  humanoid?: PreparedHumanoid;
  static?: PreparedOptimization;
};

const PRESETS: Preset[] = [
  {
    id: 'sample-b',
    name: '示例 B',
    path: process.env.FOURDGEN_SAMPLE_B ?? '.cache/models/sample-b/source.pmx',
    cache: '.cache/models/sample-b/diagnostic-source.glb',
    profile: 'profiles/sample-b.json',
  },
  {
    id: 'sample-a',
    name: '示例 A',
    path: process.env.FOURDGEN_SAMPLE_A ?? '.cache/models/sample-a/source.pmx',
    cache: '.cache/models/sample-a/diagnostic-source.glb',
    profile: 'profiles/sample-a.json',
  },
];

/**
 * Owns the long-lived studio state: model sessions, conversion jobs, the skin
 * pack manager, and preview/model caches. HTTP routing lives in `routes/`.
 */
export class Studio {
  readonly root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  readonly dist = resolve(
    process.env.FOURDGEN_WEB_DIST ?? resolve(this.root, '.cache/web-dist'),
  );
  readonly presets = PRESETS;
  readonly sessions = new Map<string, Session>();
  readonly jobs = new Map<string, Job>();
  readonly preparedModels = new Map<string, PreparedState>();
  readonly io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  readonly previewCacheDir = resolve(storage.cache, 'web-preview');
  readonly managerConfigPath = resolve(
    this.root,
    process.env.SKIN_MANAGER_CONFIG ?? 'skin-manager.local.json',
  );
  manager: PackManager | null = null;
  managerError = '';
  gameConfigured = false;
  busy = false;
  /** Coarse progress label for the long-running import/preview work. */
  activity: { label: string; startedAt: number } | null = null;

  private setActivity(label: string) {
    this.activity = { label, startedAt: Date.now() };
  }

  async initialize(): Promise<void> {
    await this.initializeManager();
    await this.ownKnownSources();
    await this.upgradeLibraryEntries();
  }

  requireManager(): PackManager {
    if (!this.manager) throw Error(this.managerError);
    return this.manager;
  }

  addJob(id: string, job: Job): void {
    // A finished job keeps its full pack and atlas buffers for downloads. Two
    // are enough for the current result plus one quick re-generation; older
    // jobs would otherwise pin hundreds of MB for the rest of the session.
    if (this.jobs.size >= 2) this.jobs.delete(this.jobs.keys().next().value!);
    this.jobs.set(id, job);
  }

  retainPrepared(key: string, state: PreparedState): void {
    // Prepared models are only reusable for the current geometry key. Keeping
    // more than one pins another full document (including source textures).
    if (!this.preparedModels.has(key) && this.preparedModels.size >= 1)
      this.preparedModels.delete(this.preparedModels.keys().next().value!);
    this.preparedModels.set(key, state);
  }

  /** Drop a workbench session and its finished conversion buffers. */
  releaseSession(id: string): boolean {
    const removed = this.sessions.delete(id);
    this.preparedModels.clear();
    for (const [jobId, job] of this.jobs)
      if (job.status !== 'running') this.jobs.delete(jobId);
    return removed;
  }

  previewCachePath(key: string): string {
    return resolve(this.previewCacheDir, key + '.glb');
  }

  async previewCacheKey(source: string): Promise<string> {
    const info = await stat(source).catch(() => null);
    const dependencies: string[] = [];
    const scan = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const file = resolve(folder, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (/\.(png|jpe?g|tga|bmp|webp|dds|bin|mtl)$/i.test(file)) {
          const item = await stat(file);
          dependencies.push(`${file}:${item.size}:${item.mtimeMs}`);
        }
      }
    };
    await scan(dirname(source));
    return createHash('sha1')
      .update(
        `${source}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}:${PREVIEW_TEXTURE_LIMIT}:${dependencies.sort().join(';')}:v3`,
      )
      .digest('hex');
  }

  async readPreviewCache(file: string): Promise<Uint8Array | null> {
    return (await fileExists(file)) ? readFileBytes(file) : null;
  }

  async writePreviewCache(file: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.previewCacheDir, { recursive: true });
    await writeFile(file, bytes).catch(() => {});
  }

  /** Preview caches are keyed by source version; drop ones no longer reachable. */
  async cleanPreviewCache(maxAgeMs = 14 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    for (const name of await readdir(this.previewCacheDir).catch(
      () => [] as string[],
    )) {
      if (!name.endsWith('.glb')) continue;
      const file = resolve(this.previewCacheDir, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff)
        await rm(file, { force: true }).catch(() => {});
    }
  }

  /** Preview generation is expensive only on the first load of a source file. */
  async buildPreview(
    document: IntermediateModel['document'],
  ): Promise<Uint8Array> {
    try {
      return await buildPreviewGlb(document, this.io);
    } catch (error) {
      console.warn(
        '预览优化失败，回退到原始 GLB：',
        error instanceof Error ? error.message : String(error),
      );
      return new Uint8Array(await this.io.writeBinary(document));
    }
  }

  async load(
    path: string,
    name: string,
    profile: HumanoidProfile | null,
    options: {
      cache?: string;
      cachePreview?: boolean;
      existingId?: string;
    } = {},
  ): Promise<LoadedSession> {
    try {
      return await this.loadInternal(path, name, profile, options);
    } finally {
      this.activity = null;
    }
  }

  private async loadInternal(
    path: string,
    name: string,
    profile: HumanoidProfile | null,
    options: {
      cache?: string;
      cachePreview?: boolean;
      existingId?: string;
    } = {},
  ): Promise<LoadedSession> {
    const { cache, cachePreview = true, existingId } = options;
    path = await ownModel(path);
    // Only the active workbench session is needed: its preview and conversion
    // requests use this id. Dropping the previous session releases the full
    // imported document (including source textures) instead of keeping four.
    if (this.sessions.size >= 1)
      this.sessions.delete(this.sessions.keys().next().value!);
    this.preparedModels.clear();
    const source =
      cache && (await fileExists(resolve(this.root, cache)))
        ? resolve(this.root, cache)
        : path;
    this.setActivity('正在检查模型缓存…');
    const modelKey = await this.previewCacheKey(source);
    const modelCache = resolve(storage.cache, 'web-models', modelKey);
    let model: IntermediateModel;
    try {
      const meta = JSON.parse(await readFile(modelCache + '.json', 'utf8'));
      model = { ...meta, document: await this.io.read(modelCache + '.glb') };
    } catch {
      this.setActivity('正在解析模型…');
      model = await importModel(source, {
        backend: 'wasm',
        onStage: (stage) => this.setActivity(stage),
      });
      this.setActivity('正在保存模型缓存…');
      await mkdir(resolve(modelCache, '..'), { recursive: true });
      await writeFile(
        modelCache + '.glb',
        await this.io.writeBinary(model.document),
      );
      await writeFile(
        modelCache + '.json',
        JSON.stringify({ source: model.source, warnings: model.warnings }),
      );
    }
    profile ??= autoProfile(model.document);
    let preview: Uint8Array | null = null;
    const cacheFile = cachePreview ? this.previewCachePath(modelKey) : null;
    if (cacheFile) preview = await this.readPreviewCache(cacheFile);
    if (!preview) {
      this.setActivity('正在生成预览…');
      preview = await this.buildPreview(model.document);
      if (cacheFile) await this.writePreviewCache(cacheFile, preview);
    }
    this.setActivity('正在整理材质…');
    const instances: import('@gltf-transform/core').Mesh[] = [];
    (
      model.document.getRoot().getDefaultScene() ??
      model.document.getRoot().listScenes()[0]
    )?.traverse((node) => {
      if (node.getMesh()) instances.push(node.getMesh()!);
    });
    // Assign ids once so every later stage sees the same part identity.
    const parts: PartSummary[] = assignParts(model.document).map((part) => ({
      id: part.id,
      name: part.name,
      nodeIndex: part.nodeIndex,
      node: part.node,
      mesh: part.mesh,
      primitive: part.primitive,
      materialKey: part.materialKey,
      materialName: part.materialName,
      triangles: part.triangles,
      vertices: part.vertices,
      instancePart: part.instancePart,
    }));
    const keys = materialKeyMap(model.document);
    const labels = materialDisplayLabels(
      model.document
        .getRoot()
        .listMaterials()
        .map((material) => ({
          key: keys.get(material) ?? '',
          name: material.getName() || '(默认)',
        })),
    );
    const materials = await Promise.all(
      model.document
        .getRoot()
        .listMaterials()
        .map(async (material) => {
          const name = material.getName() || '(默认)';
          const thumbnail = await materialThumbnail(material);
          return {
            key: keys.get(material) ?? `m:${material.getName() || '(default)'}#1`,
            label: labels.get(keys.get(material) ?? '') ?? name,
            name: material.getName(),
            alpha: material.getBaseColorFactor()[3],
            doubleSided: material.getDoubleSided(),
            transparent: material.getAlphaMode() === 'BLEND',
            ...(thumbnail ? { thumbnail } : {}),
            partIds: parts
              .filter((part) => part.materialKey === keys.get(material))
              .map((part) => part.id),
            triangles: instances
              .flatMap((mesh) => mesh.listPrimitives())
              .filter((primitive) => primitive.getMaterial() === material)
              .reduce(
                (sum, primitive) =>
                  sum +
                  (primitive.getIndices()?.getCount() ??
                    primitive.getAttribute('POSITION')!.getCount()) /
                    3,
                0,
              ),
          };
        }),
    );
    const fingerprint = selectionFingerprint(materials, parts);
    const selectionWarnings: string[] = [];
    let settings: EditSettings | null = null;
    const id = crypto.randomUUID();
    const defaultProfile = profile ? { ...profile, shoulderOutset: 0 } : null;
    this.setActivity('正在保存模型…');
    const remember = await rememberModel(
      path,
      name,
      {
        profile: defaultProfile,
        previewKey: modelKey,
        stats: {
          triangles: materials.reduce(
            (sum, material) => sum + material.triangles,
            0,
          ),
          materials: materials.length,
          bytes: (await stat(path)).size,
        },
      },
      existingId,
    );
    settings = remember.settings ?? null;
    if (settings) {
      const normalized = normalizeSelection(materials, parts, {
        excluded: settings.excluded,
        materialWeights: settings.materialWeights,
        ...(settings.includedParts ? { includedParts: settings.includedParts } : {}),
        ...(settings.fingerprint ? { fingerprint: settings.fingerprint } : {}),
      });
      if (normalized.structureChanged)
        selectionWarnings.push('模型结构已变化，已重置材质与部件选择。');
      else if (normalized.unmatched.length)
        selectionWarnings.push(
          `已忽略 ${normalized.unmatched.length} 项与当前模型不匹配的材质或部件选择。`,
        );
      if (normalized.migrated.length)
        selectionWarnings.push(
          `已迁移 ${normalized.migrated.length} 项旧版按名称保存的选择。`,
        );
      const { includedParts: _legacyParts, ...rest } = settings;
      settings = {
        ...rest,
        excluded: normalized.excluded,
        materialWeights: normalized.materialWeights,
        ...(normalized.includedParts !== null
          ? { includedParts: normalized.includedParts }
          : {}),
        fingerprint,
      };
    }
    this.sessions.set(id, {
      modelId: remember.id,
      model,
      preview,
      profile: defaultProfile,
      name: remember.name,
      materials,
      parts,
      fingerprint,
    });
    return {
      id,
      modelId: remember.id,
      name: remember.name,
      settings,
      profile: defaultProfile,
      materials,
      parts,
      fingerprint,
      selectionWarnings,
      warnings: [...model.warnings, ...selectionWarnings],
    };
  }

  /** Precompute preset previews in the background so the first click is instant. */
  async warmPresetPreviews(): Promise<void> {
    // Warm the persona catalogue too: the first /api/packs request otherwise
    // pays for scanning the Marketplace cache.
    if (this.manager && this.gameConfigured)
      void buildPersonaRecipe({ skinPacksRoot: this.manager.config.skinPacksRoot }).catch(() => {});
    await this.cleanPreviewCache();
    for (const preset of this.presets) {
      try {
        const source =
          preset.cache &&
          (await fileExists(resolve(this.root, preset.cache)))
            ? resolve(this.root, preset.cache)
            : resolve(this.root, preset.path);
        if (!(await fileExists(source))) continue;
        const cacheFile = this.previewCachePath(
          await this.previewCacheKey(source),
        );
        if (await fileExists(cacheFile)) continue;
        const model = await importModel(source, { backend: 'wasm' });
        await this.writePreviewCache(
          cacheFile,
          await this.buildPreview(model.document),
        );
      } catch (error) {
        console.warn(
          `预览预热失败（${preset.id}）：`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  async setGameDirectory(path: string): Promise<string> {
    if (this.busy || (await pathExists(resolve(storage.skins, 'operation.lock'))))
      throw Error('正在处理任务，请稍后修改目录');
    if (
      !isAbsolute(path) ||
      !(await stat(path)
        .then((info) => info.isDirectory())
        .catch(() => false))
    )
      throw Error('请输入存在的 skin_packs 文件夹绝对路径');
    const config: ManagerConfig = {
      version: 1,
      skinPacksRoot: resolve(path),
      stateDir: storage.skins,
      slots: { custom: { manifestFormat: 2 } },
    };
    const next = new PackManager(config);
    await next.initializePresetSources();
    const temp = this.managerConfigPath + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(config, null, 2));
    await rename(temp, this.managerConfigPath);
    this.manager = next;
    this.gameConfigured = true;
    this.managerError = '';
    return config.skinPacksRoot;
  }

  private async initializeManager(): Promise<void> {
    try {
      const config = JSON.parse(
        await readFile(this.managerConfigPath, 'utf8'),
      ) as ManagerConfig;
      this.manager = new PackManager(
        await resolveManagerConfig(config, this.managerConfigPath),
      );
      this.gameConfigured = true;
    } catch (error) {
      this.managerError =
        `未找到或无法读取皮肤包管理配置 ${this.managerConfigPath}：` +
        (error instanceof Error ? error.message : String(error));
    }
    if (!this.manager)
      this.manager = new PackManager({
        libraryOnly: true,
        version: 1,
        skinPacksRoot: resolve(dataRoot, 'game-targets'),
        stateDir: storage.skins,
        slots: {
          custom: { manifestFormat: 2 },
          persona: { manifestFormat: 1 },
        },
      });
    if (this.gameConfigured) await this.manager.initializePresetSources();
  }

  /** Keep sources independent of Downloads; rewrite entries that moved. */
  private async ownKnownSources(): Promise<void> {
    for (const entry of await listModels()) {
      try {
        const path = await ownModel(entry.path);
        if (path !== entry.path) await updateModel(entry.id, { path });
      } catch (error) {
        console.warn('源模型归档未完成：', entry.name, String(error));
      }
    }
  }

  /** Upgrade previous library entries from parsed-model caches, without re-importing. */
  private async upgradeLibraryEntries(): Promise<void> {
    for (const entry of await listModels()) {
      if (entry.previewKey && entry.stats && entry.profile !== undefined)
        continue;
      for (const file of await readdir(
        resolve(storage.cache, 'web-models'),
      ).catch(() => [] as string[])) {
        if (!file.endsWith('.json')) continue;
        try {
          const meta = JSON.parse(
            await readFile(resolve(storage.cache, 'web-models', file), 'utf8'),
          );
          if (meta.source?.path !== entry.path) continue;
          const key = file.slice(0, -5);
          const document = await this.io.read(
            resolve(storage.cache, 'web-models', key + '.glb'),
          );
          let triangles = 0;
          for (const mesh of document.getRoot().listMeshes())
            for (const primitive of mesh.listPrimitives())
              triangles +=
                (primitive.getIndices()?.getCount() ??
                  primitive.getAttribute('POSITION')!.getCount()) / 3;
          await rememberModel(entry.path, entry.name, {
            profile: autoProfile(document),
            previewKey: key,
            stats: {
              triangles,
              materials: document.getRoot().listMaterials().length,
              bytes: (await stat(entry.path)).size,
            },
          });
          break;
        } catch (error) {
          console.warn('模型库缓存升级失败：', entry.name, String(error));
        }
      }
    }
  }
}
