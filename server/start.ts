import { autoProfile } from "../src/auto-profile.ts";
import { importLocal, rememberModel, listModels, updateModel, removeModel } from "./model-library.ts";
import { build } from "vite";
import { resolve, basename, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile, readFile, realpath, readdir, rm } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cloneDocument } from "@gltf-transform/functions";
import JSZip from "jszip";
import { importModel } from "../src/importer.ts";
import { exportHumanoid } from "../src/humanoid.ts";
import type { HumanoidProfile } from "../src/humanoid.ts";
import { optimizeModel } from "../src/optimizer.ts";
import { bindStatic } from "../src/bone-mapper.ts";
import { exportBedrockGeometry } from "../src/bedrock-exporter.ts";
import { buildSkinPack, zipSkinPack } from "../src/skin-pack.ts";
import type { SkinPackFiles } from "../src/skin-pack.ts";
import { PackManager } from "../src/pack-manager.ts";
import type { ManagerConfig, PackMeta } from "../src/pack-manager.ts";
import { buildPreviewGlb, PREVIEW_TEXTURE_LIMIT } from "../src/preview-asset.ts";
import { MeshoptEncoder } from "meshoptimizer";
import type { IntermediateModel } from "../src/model.ts";

const root = resolve(import.meta.dir, ".."),
  dist = resolve(root, ".cache/web-dist");
await build({
  root: resolve(root, "web"),
  configFile: false,
  logLevel: "warn",
  build: { outDir: dist, emptyOutDir: true },
});
const presets = [
  {
    id: "rin",
    name: "样本 B",
    path: ".cache/models/sample-b/样本 Bfashion2/样本 Bfasion2.pmx",
    cache: ".cache/models/sample-b/diagnostic-source.glb",
    profile: "profiles/sample-b.json",
  },
  {
    id: "sample-a",
    name: "样本 A",
    path: ".cache/models/sample-a/样本 A.pmx",
    profile: "profiles/sample-a.json",
  },
];
type Session = {
  modelId: string;
  model: IntermediateModel;
  preview: Uint8Array;
  profile: HumanoidProfile | null;
  name: string;
  materials: {
    name: string;
    triangles: number;
    alpha: number;
    doubleSided: boolean;
    transparent: boolean;
  }[];
};
const sessions = new Map<string, Session>();
type Job = {
  status: "running" | "done" | "error";
  message: string;
  result?: unknown;
  files?: SkinPackFiles;
  texture?: Uint8Array;
  geometry?: unknown;
  key?: string;
  meta?: PackMeta;
};
const jobs = new Map<string, Job>();
// Bounded, pre-atlas models retain source textures/UVs for repeated texture tuning.
const preparedModels = new Map<string, {humanoid?:import('../src/humanoid.ts').PreparedHumanoid; static?:import('../src/optimizer.ts').PreparedOptimization}>();
function retainPrepared(key:string, value: {humanoid?:import('../src/humanoid.ts').PreparedHumanoid; static?:import('../src/optimizer.ts').PreparedOptimization}) {
  if (!preparedModels.has(key) && preparedModels.size >= 2) preparedModels.delete(preparedModels.keys().next().value!);
  preparedModels.set(key,value);
}
let busy = false;
const json = (v: unknown, status = 200) => Response.json(v, { status });
const stableJson = (value: unknown) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const previewCacheDir = resolve(root, ".cache/web-preview");
function previewCachePath(key: string) {
  return resolve(previewCacheDir, key + ".glb");
}
async function previewCacheKey(source: string) {
  const info = await stat(source).catch(() => null);
  const dependencies: string[] = [];
  async function scan(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (/\.(png|jpe?g|tga|bmp|webp|dds|bin|mtl)$/i.test(file)) {
        const item = await stat(file);
        dependencies.push(`${file}:${item.size}:${item.mtimeMs}`);
      }
    }
  }
  await scan(dirname(source));
  return createHash("sha1")
    .update(`${source}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}:${PREVIEW_TEXTURE_LIMIT}:${dependencies.sort().join(";")}:v3`)
    .digest("hex");
}
async function readPreviewCache(file: string) {
  const handle = Bun.file(file);
  return (await handle.exists()) ? new Uint8Array(await handle.arrayBuffer()) : null;
}
async function writePreviewCache(file: string, bytes: Uint8Array) {
  await mkdir(previewCacheDir, { recursive: true });
  await writeFile(file, bytes).catch(() => {});
}
/** Preview caches are keyed by source version; drop ones no longer reachable. */
async function cleanPreviewCache(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const name of await readdir(previewCacheDir).catch(() => [] as string[])) {
    if (!name.endsWith(".glb")) continue;
    const file = resolve(previewCacheDir, name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < cutoff) await rm(file, { force: true }).catch(() => {});
  }
}
/** Preview generation is expensive only on the first load of a source file. */
async function buildPreview(source: string, document: IntermediateModel["document"]) {
  try {
    return await buildPreviewGlb(document, io);
  } catch (error) {
    console.warn(
      "预览优化失败，回退到原始 GLB：",
      error instanceof Error ? error.message : String(error),
    );
    return new Uint8Array(await io.writeBinary(document));
  }
}
/** Local skin pack library, backed by the same manager the CLI uses. */
const managerConfigPath = resolve(
  root,
  process.env.SKIN_MANAGER_CONFIG ?? "skin-manager.local.json",
);
let manager: PackManager | null = null;
let managerError = "";
try {
  const config = JSON.parse(
    await readFile(managerConfigPath, "utf8"),
  ) as ManagerConfig;
  manager = new PackManager({
    ...config,
    skinPacksRoot: resolve(dirname(managerConfigPath), config.skinPacksRoot),
    stateDir: resolve(dirname(managerConfigPath), config.stateDir),
  });
} catch (error) {
  managerError =
    `未找到或无法读取皮肤包管理配置 ${managerConfigPath}：` +
    (error instanceof Error ? error.message : String(error));
}
if (manager) await manager.initializePresetSources();
function requireManager() {
  if (!manager) throw Error(managerError);
  return manager;
}
function safeName(name: string) {
  const parts = name.replaceAll("\\", "/").split("/");
  if (
    parts.some((p) => !p || p === "." || p === ".." || /[:\x00-\x1f]/.test(p))
  )
    throw Error("文件路径无效");
  return parts.join("/");
}
async function load(
  path: string,
  name: string,
  profile: HumanoidProfile | null,
  cache?: string,
  cachePreview = true,
  existingId?: string,
) {
  if (sessions.size >= 4) sessions.delete(sessions.keys().next().value!);
  const source =
    cache && (await Bun.file(resolve(root, cache)).exists())
      ? resolve(root, cache)
      : path;
  const modelKey = await previewCacheKey(source);
  const modelCache = resolve(root, ".cache/web-models", modelKey);
  let model: IntermediateModel;
  try {
    const meta = JSON.parse(await readFile(modelCache + ".json", "utf8"));
    model = { ...meta, document: await io.read(modelCache + ".glb") };
  } catch {
    model = await importModel(source, { backend: "wasm" });
    await mkdir(dirname(modelCache), { recursive: true });
    await writeFile(modelCache + ".glb", await io.writeBinary(model.document));
    await writeFile(modelCache + ".json", JSON.stringify({ source: model.source, warnings: model.warnings }));
  }
  profile ??= autoProfile(model.document);
  let preview: Uint8Array | null = null;
  const cacheFile = cachePreview
    ? previewCachePath(await previewCacheKey(source))
    : null;
  if (cacheFile) preview = await readPreviewCache(cacheFile);
  if (!preview) {
    preview = await buildPreview(source, model.document);
    if (cacheFile) await writePreviewCache(cacheFile, preview);
  }
  const instances: import("@gltf-transform/core").Mesh[] = [];
  (
    model.document.getRoot().getDefaultScene() ??
    model.document.getRoot().listScenes()[0]
  )?.traverse((node) => {
    if (node.getMesh()) instances.push(node.getMesh()!);
  });
  const materials = model.document
    .getRoot()
    .listMaterials()
    .map((m) => ({
      name: m.getName(),
      alpha: m.getBaseColorFactor()[3],
      doubleSided: m.getDoubleSided(),
      transparent: m.getAlphaMode() === "BLEND",
      triangles: instances
        .flatMap((x) => x.listPrimitives())
        .filter((p) => p.getMaterial() === m)
        .reduce(
          (s, p) =>
            s +
            (p.getIndices()?.getCount() ??
              p.getAttribute("POSITION")!.getCount()) /
              3,
          0,
        ),
    }));
  const id = crypto.randomUUID();
  const defaultProfile = profile ? { ...profile, shoulderOutset: 0 } : null;
  const entry = await rememberModel(path, name, { profile: defaultProfile, previewKey: modelKey, stats: { triangles: materials.reduce((sum, m) => sum + m.triangles, 0), materials: materials.length, bytes: (await stat(path)).size } }, existingId);
  sessions.set(id, {
    modelId: entry.id,
    model,
    preview,
    profile: defaultProfile,
    name: entry.name,
    materials,
  });
  return {
    id,
    modelId: entry.id,
    name: entry.name,
    settings: entry.settings ?? null,
    profile: defaultProfile,
    materials,
    warnings: model.warnings,
  };
}
/** Precompute preset previews in the background so the first click is instant. */
async function warmPresetPreviews() {
  await cleanPreviewCache();
  for (const p of presets) {
    try {
      const cached = "cache" in p ? p.cache : undefined;
      const source =
        cached && (await Bun.file(resolve(root, cached)).exists())
          ? resolve(root, cached)
          : resolve(root, p.path);
      if (!(await Bun.file(source).exists())) continue;
      const cacheFile = previewCachePath(await previewCacheKey(source));
      if (await Bun.file(cacheFile).exists()) continue;
      const model = await importModel(source, { backend: "wasm" });
      await writePreviewCache(cacheFile, await buildPreview(source, model.document));
    } catch (error) {
      console.warn(
        `预览预热失败（${p.id}）：`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
// Upgrade previous library entries from existing parsed-model caches, without importing sources again.
for (const entry of await listModels()) {
  if (entry.previewKey && entry.stats && entry.profile !== undefined) continue;
  for (const file of await readdir(resolve(root, ".cache/web-models")).catch(() => [] as string[])) {
    if (!file.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(await readFile(resolve(root, ".cache/web-models", file), "utf8"));
      if (meta.source?.path !== entry.path) continue;
      const key = file.slice(0, -5);
      const doc = await io.read(resolve(root, ".cache/web-models", key + ".glb"));
      let triangles = 0;
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) triangles += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3;
      await rememberModel(entry.path, entry.name, { profile: autoProfile(doc), previewKey: key, stats: { triangles, materials: doc.getRoot().listMaterials().length, bytes: (await stat(entry.path)).size } });
      break;
    } catch (error) { console.warn("模型库缓存升级失败：", entry.name, String(error)); }
  }
}
const port = Number(process.env.PORT ?? 4173);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  maxRequestBodySize: 256 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url),
      parts = url.pathname.split("/").filter(Boolean);
    try {
      if (
        req.headers.get("host") !== `127.0.0.1:${port}` &&
        req.headers.get("host") !== `localhost:${port}`
      )
        return json({ error: "Invalid host" }, 403);
      if (req.method !== "GET" && req.headers.get("origin") !== url.origin)
        return json({ error: "同源请求校验失败" }, 403);
      if (url.pathname === "/api/models" && req.method === "GET")
        return json(await listModels());
      if (url.pathname === "/api/models/update" && req.method === "POST") {
        const body = await req.json() as { id: string; name?: string; settings?: import("./model-library.ts").EditSettings; packId?: string };
        let packIds: string[] | undefined;
        if (body.packId) {
          if (!(await requireManager().list()).some(p => p.id === body.packId)) throw Error("皮肤版本不存在");
          const entries = await listModels();
          if (entries.some(e => e.id !== body.id && e.packIds?.includes(body.packId!))) throw Error("该皮肤版本已关联其他模型");
          packIds = [...new Set([...(entries.find(e => e.id === body.id)?.packIds ?? []), body.packId])];
        }
        return json(await updateModel(body.id, { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.settings ? { settings: body.settings } : {}), ...(packIds ? { packIds } : {}) }));
      }
      if (url.pathname === "/api/models/relink" && req.method === "POST") {
        const body = await req.json() as { id: string; path: string };
        return json(await updateModel(body.id, {path: body.path}));
      }
      if (url.pathname === "/api/models/delete" && req.method === "POST") {
        const body = await req.json() as { id: string };
        await removeModel(body.id);
        return json({ removed: true });
      }
      if (parts[0] === "api" && parts[1] === "models" && parts[3] === "preview" && req.method === "GET") {
        const entry = (await listModels()).find(m => m.id === parts[2]);
        if (!entry?.previewKey) throw Error("请先打开模型生成预览");
        return new Response(Bun.file(previewCachePath(entry.previewKey)), { headers: { "Content-Type": "model/gltf-binary" } });
      }
      if ((url.pathname === "/api/local-import" || url.pathname === "/api/models/open") && req.method === "POST") {
        if (busy) return json({ error: "已有任务正在运行" }, 409);
        busy = true;
        try {
          const body = await req.json() as { path?: string; id?: string; main?: string };
          const entry = body.id ? (await listModels()).find(m => m.id === body.id) : null;
          if (body.id && !entry) throw Error("模型库条目不存在");
          const candidates = entry ? [entry.path] : await importLocal(String(body.path ?? ""));
          if (!candidates.length) throw Error("没有找到模型文件");
          if (candidates.length > 1 && !body.main) return json({ local: body.path, candidates });
          const main = body.main ?? candidates[0]!;
          if (!candidates.includes(main)) throw Error("请选择包内模型");
          return json(await load(main, entry?.name ?? basename(main), null, undefined, true, entry?.id));
        } finally { busy = false; }
      }
      if (url.pathname === "/api/presets") {
        const available = [];
        for (const p of presets)
          if (await Bun.file(resolve(root, p.path)).exists())
            available.push({ id: p.id, name: p.name });
        return json(available);
      }
      if (url.pathname === "/api/load" && req.method === "POST") {
        if (busy) return json({ error: "已有任务正在运行" }, 409);
        busy = true;
        try {
          const body = (await req.json()) as { preset: string };
          const p = presets.find((p) => p.id === body.preset);
          if (!p) throw Error("未知示例");          return json(
            await load(
              resolve(root, p.path),
              p.name,
              JSON.parse(
                await readFile(resolve(root, p.profile), "utf8"),
              ) as HumanoidProfile,
              "cache" in p ? p.cache : undefined,
              true,
            ),
          );
        } finally {
          busy = false;
        }
      }
      if (url.pathname === "/api/upload" && req.method === "POST") {
        if (busy) return json({ error: "已有任务正在运行" }, 409);
        busy = true;
        try {
          const form = await req.formData(),
            files = form.getAll("files"),
            names = form.getAll("paths");
          const uploadHash = createHash("sha256");
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!(file instanceof File)) throw Error("缺少模型文件");
            uploadHash.update(JSON.stringify([String(names[i] ?? file.name), file.size]));
            uploadHash.update(new Uint8Array(await file.arrayBuffer()));
          }
          const digest = uploadHash.digest("hex");
          const uploadId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,36)}`;
          const folder = resolve(root, ".cache/web-uploads", uploadId);
          await mkdir(folder, { recursive: true });
          let total = 0;
          const paths: string[] = [];
          async function save(name: string, bytes: Uint8Array) {
            total += bytes.length;
            if (total > 256 * 1024 * 1024) throw Error("解压内容超过 256 MB");
            if (paths.length >= 2000) throw Error("文件过多");
            const clean = safeName(name),
              path = resolve(folder, clean);
            if (paths.includes(path)) throw Error("重复文件路径");
            await mkdir(resolve(path, ".."), { recursive: true });
            if (!(await Bun.file(path).exists())) await writeFile(path, bytes, { flag: "wx" });
            paths.push(path);
          }
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!(file instanceof File)) throw Error("缺少模型文件");
            if (file.name.toLowerCase().endsWith(".zip")) {
              const zip = await JSZip.loadAsync(await file.arrayBuffer());
              for (const entry of Object.values(zip.files)) {
                if (entry.dir) continue;
                const n =
                  (entry as typeof entry & { unsafeOriginalName?: string })
                    .unsafeOriginalName ?? entry.name;
                safeName(n);
                await save(n, await entry.async("uint8array"));
              }
            } else
              await save(
                String(names[i] ?? file.name),
                new Uint8Array(await file.arrayBuffer()),
              );
          }
          const candidates = paths.filter((p) =>
            /\.(pmx|vrm|glb|gltf|obj|fbx|dae|stl|ply)$/i.test(p),
          );
          if (!candidates.length)
            throw Error("没有找到可导入的模型文件（PMX / VRM / GLB / OBJ…）");
          if (candidates.length > 1)
            return json({
              pending: basename(folder),
              candidates: candidates.map((path) => relative(folder, path)),
            });
          return json(
            await load(candidates[0]!, basename(candidates[0]!), null),
          );
        } finally {
          busy = false;
        }
      }
      if (url.pathname === "/api/upload/select" && req.method === "POST") {
        if (busy) return json({ error: "已有任务正在运行" }, 409);
        busy = true;
        try {
          const body = (await req.json()) as { pending?: string; main?: string };
          const id = String(body.pending ?? "");
          if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("上传会话无效或已过期");
          const folder = resolve(root, ".cache/web-uploads", id);
          const main = resolve(folder, safeName(String(body.main ?? "")));
          if (!main.startsWith(folder + "\\") && !main.startsWith(folder + "/"))
            throw Error("模型路径无效");
          if (!/\.(pmx|vrm|glb|gltf|obj|fbx|dae|stl|ply)$/i.test(main))
            throw Error("请选择模型文件");
          if (!(await Bun.file(main).exists())) throw Error("模型文件不存在");
          return json(await load(main, basename(main), null));
        } finally {
          busy = false;
        }
      }
      if (
        parts[0] === "api" &&
        parts[1] === "session" &&
        parts[3] === "preview"
      ) {
        const s = sessions.get(parts[2]!);
        if (!s) throw Error("模型会话不存在");
        return new Response(s.preview as BodyInit, {
          headers: { "Content-Type": "model/gltf-binary" },
        });
      }
      if (url.pathname === "/api/convert" && req.method === "POST") {
        if (busy) return json({ error: "已有任务正在运行" }, 409);
        const b = (await req.json()) as {
          session: string;
          excluded: string[];
          materialWeights?: Record<string, number>;
          binding: string;
          ratio: number;
          maxError: number;
          height: number;
          profile: HumanoidProfile | null;
        };
        const s = sessions.get(b.session);
        if (!s) throw Error("模型会话不存在");
        if (
          !["static", "humanoid"].includes(b.binding) ||
          !Number.isFinite(b.ratio) ||
          b.ratio <= 0 ||
          b.ratio > 1 ||
          !Number.isFinite(b.maxError) ||
          b.maxError < 0 ||
          b.maxError > 1 ||
          !Number.isFinite(b.height) ||
          b.height < 1 ||
          b.height > 128 ||
          !Array.isArray(b.excluded) ||
          b.excluded.some((n) => typeof n !== "string")
        )
          throw Error("转换参数无效");
        const key = stableJson({
          session: b.session,
          excluded: [...b.excluded].sort(),
          binding: b.binding,
          ratio: b.ratio,
          maxError: b.maxError,
          height: b.height,
          profile: b.profile,
          materialWeights: b.materialWeights ?? {},
        });
        const geometryKey = stableJson({session:b.session, excluded:[...b.excluded].sort(), binding:b.binding, ratio:b.ratio, maxError:b.maxError, height:b.height, profile:b.profile});
        const preparedModel = preparedModels.get(geometryKey);
        const cached = [...jobs].find(
          ([, job]) => job.key === key && job.status === "done",
        );
        await updateModel(s.modelId, { settings: { binding: b.binding, ratio: b.ratio, maxError: b.maxError, height: b.height, excluded: b.excluded, materialWeights: b.materialWeights ?? {}, profile: b.profile } });
        if (cached) return json({ id: cached[0], cached: true });
        const id = crypto.randomUUID(),
          job: Job = {
            key,
            status: "running",
            message: preparedModel ? "复用模型，仅更新纹理与 UV…" : "正在绑定、减面并生成 128×128 图集…",
            meta: {
              source: s.name,
              modelId: s.modelId,
              materialWeights: b.materialWeights ?? {},
              binding: b.binding,
              ratio: b.ratio,
              maxError: b.maxError,
              height: b.height,
              excluded: b.excluded,
              profile: b.profile,
            },
          };
        if (jobs.size >= 8) jobs.delete(jobs.keys().next().value!);
        jobs.set(id, job);
        busy = true;
        void (async () => {
          try {
            const model = preparedModel ? s.model : {
              ...s.model,
              document: cloneDocument(s.model.document),
            };
            if (!preparedModel) {
            for (const mesh of model.document.getRoot().listMeshes())
              for (const p of [...mesh.listPrimitives()])
                if (b.excluded.includes(p.getMaterial()?.getName() ?? "")) {
                  mesh.removePrimitive(p);
                  p.dispose();
                }
            for (const mesh of [...model.document.getRoot().listMeshes()])
              if (!mesh.listPrimitives().length) {
                for (const node of model.document.getRoot().listNodes())
                  if (node.getMesh() === mesh) node.setMesh(null);
                mesh.dispose();
              }
            }
            const started = performance.now();
            let exported;
            let details: unknown;
            if (b.binding === "humanoid") {
              const r = await exportHumanoid(model, {
                prepared:preparedModel?.humanoid,
                onPrepared:state => retainPrepared(geometryKey, {humanoid:state}),
                height: b.height,
                onStage: (phase) => {
                  job.message =
                    (
                      {
                        rig: "准备骨骼与材质…",
                        pose: "冻结调整后的姿势…",
                        reduction: "按误差限制减面…",
                        atlas: "裁切贴图并分配图集…",
                        export: "导出六个玩家部位…",
                        done: "几何导出完成…",
                      } as Record<string, string>
                    )[phase] ?? phase;
                },
                textureSize: 256,
                ...(b.materialWeights
                  ? { materialWeights: b.materialWeights }
                  : {}),
                ...(b.profile ? { profile: b.profile } : {}),
                reduction: { ratio: b.ratio, maxError: b.maxError },
              });
              exported = r;
              details = r.binding;
            } else {
              const r = await optimizeModel(model, {
                prepared:preparedModel?.static,
                onPrepared:state => retainPrepared(geometryKey, {static:state}),
                prepare: {
                  height: b.height,
                  center: "ground",
                  rotation: [0, b.profile?.rotationYDegrees ?? 0, 0],
                },
                mesh: { ratio: b.ratio, maxError: b.maxError },
                texture: {
                  compactSize: 128,
                  padding: 1,
                  ...(b.materialWeights
                    ? { materialWeights: b.materialWeights }
                    : {}),
                },
              });
              exported = await exportBedrockGeometry(bindStatic(r.model), {
                identifier: "geometry.skin0",
                skinTextureSize: 128,
              });
              details = r.report;
            }
            job.message = "正在校验皮肤包…";
            const files = buildSkinPack({
              geometry: exported.file,
              png: exported.png,
              identifier: "geometry.skin0",
              packName: s.name + " / 本地工作台",
            });
            job.files = files;
            job.texture = exported.png;
            job.geometry = exported.file;
            job.result = {
              report: exported.report,
              details,
              excluded: b.excluded,
              conversionMs: Math.round(performance.now() - started),
              textureOnly: !!preparedModel,
              settings: {
                ratio: b.ratio,
                maxError: b.maxError,
                binding: b.binding,
                excluded: b.excluded,
              },
            };
            job.status = "done";
            job.message = "转换完成";
          } catch (e) {
            job.status = "error";
            job.message = e instanceof Error ? e.message : String(e);
          } finally {
            busy = false;
          }
        })();
        return json({ id });
      }
      if (parts[0] === "api" && parts[1] === "job") {
        const j = jobs.get(parts[2]!);
        if (!j) throw Error("任务不存在");
        const asset = parts[3];
        if (!asset)
          return json({
            status: j.status,
            message: j.message,
            result: j.result,
          });
        if (j.status !== "done") throw Error("任务尚未完成");
        if (asset === "download") return new Response(await zipSkinPack(j.files!) as BodyInit, {
          headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="skin.mcpack"' },
        });
        if (asset === "geometry") return json(j.geometry);
        if (asset === "texture")
          return new Response(j.texture as BodyInit, {
            headers: { "Content-Type": "image/png" },
          });
      }
      if (url.pathname === "/api/packs") {
        if (!manager)
          return json({ configured: false, configPath: managerConfigPath, error: managerError });
        const [status, library] = await Promise.all([
          manager.status(),
          manager.ensureStats(),
        ]);
        return json({
          configured: true,
          configPath: managerConfigPath,
          root: manager.config.skinPacksRoot,
          stateDir: manager.config.stateDir,
          slots: manager.config.slots,
          status,
          library: library.sort((a, b) => b.imported.localeCompare(a.imported)),
        });
      }
      if (
        parts[0] === "api" &&
        parts[1] === "packs" &&
        parts[3] === "icon" &&
        req.method === "GET"
      ) {
        const icon = await requireManager().icon(parts[2]!);
        if (!icon) return new Response("Not found", { status: 404 });
        return new Response(icon as BodyInit, {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (
        parts[0] === "api" &&
        parts[1] === "packs" &&
        parts[3] === "scene" &&
        req.method === "GET"
      ) {
        const scene = await requireManager().scene(parts[2]!, Number(url.searchParams.get("skin") ?? 0));
        return json({
          name: scene.name,
          identifier: scene.identifier,
          geometry: scene.geometry,
          skins: scene.skins,
          texture: `data:image/png;base64,${Buffer.from(scene.texture).toString("base64")}`,
        });
      }
      if (parts[0] === "api" && parts[1] === "packs" && parts[3] === "skins" && req.method === "GET")
        return json(await requireManager().contents(parts[2]!));
      if (parts[0] === "api" && parts[1] === "packs" && parts[3] === "texture" && req.method === "GET") {
        const scene = await requireManager().scene(parts[2]!, Number(url.searchParams.get("skin") ?? 0));
        return new Response(scene.texture as BodyInit, { headers: { "Content-Type": "image/png" } });
      }
      if (parts[0] === "api" && parts[1] === "preset-packs" && req.method === "GET") {
        const m = requireManager(), slot = parts[2]!;
        if (parts[3] === "skins") return json(await m.presetContents(slot));
        const scene = await m.presetScene(slot, Number(url.searchParams.get("skin") ?? 0));
        if (parts[3] === "texture") return new Response(scene.texture as BodyInit, { headers: { "Content-Type": "image/png" } });
        if (parts[3] === "scene") return json({ ...scene, texture: `data:image/png;base64,${Buffer.from(scene.texture).toString("base64")}` });
      }
      if (parts[0] === "api" && parts[1] === "packs" && parts[3] === "download" && req.method === "GET") {
        const folder = resolve(root, ".cache/pack-exports", crypto.randomUUID());
        await mkdir(folder, { recursive: true });
        const output = resolve(folder, "skin.mcpack");
        try {
          await requireManager().exportPack(parts[2]!, output);
          return new Response(new Uint8Array(await readFile(output)), { headers: {
            "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="skin.mcpack"',
          } });
        } finally { await rm(folder, { recursive: true, force: true }); }
      }
      if (url.pathname === "/api/packs/create" && req.method === "POST") {
        const body = await req.json() as { name: string };
        return json(await requireManager().createPack(String(body.name ?? "")));
      }
      if (url.pathname === "/api/packs/add-skins" && req.method === "POST") {
        const body = await req.json() as { target: string; source: string; indices: number[] };
        if (!Array.isArray(body.indices)) throw Error("请选择皮肤");
        return json(await requireManager().addSkins(body.target, body.source, body.indices));
      }
      if (url.pathname === "/api/packs/import" && req.method === "POST") {
        const m = requireManager(), id = "pack-" + crypto.randomUUID();
        if (req.headers.get("content-type")?.includes("application/json")) {
          const body = await req.json() as { path: string };
          const path = String(body.path ?? "");
          if (!/^(?:[a-z]:[\\/]|\/)/i.test(path)) throw Error("请输入本地绝对路径");
          return json(await m.importPack(id, path));
        }
        const form = await req.formData(), file = form.get("file");
        if (!(file instanceof File) || !/\.(mcpack|zip)$/i.test(file.name)) throw Error("请选择 .mcpack 或皮肤包 ZIP");
        const folder = resolve(root, ".cache/pack-imports");
        await mkdir(folder, { recursive: true });
        const path = resolve(folder, id + ".mcpack");
        try { await writeFile(path, new Uint8Array(await file.arrayBuffer()), { flag: "wx" }); return json(await m.importPack(id, path)); }
        finally { await rm(path, { force: true }); }
      }
      if (url.pathname === "/api/packs/rename" && req.method === "POST") {
        const body = await req.json() as { id: string; name?: string; skinIndex?: number; skinName?: string };
        return json(await requireManager().renameNames(body.id, body));
      }
      if (url.pathname === "/api/packs/apply-update" && req.method === "POST") {
        const body = await req.json() as { id: string; slot: string };
        return json(await requireManager().updateEnabled(body.slot, body.id));
      }
      if (url.pathname === "/api/packs/install" && req.method === "POST") {
        const m = requireManager();
        const body = (await req.json()) as {
          job?: string;
          label?: string;
          id?: string;
          slot?: string;
        };
        const job = jobs.get(body.job ?? "");
        if (!job || job.status !== "done" || !job.files)
          throw Error("转换结果不存在或尚未完成");
        const pack = await m.importFiles(
          String(body.id ?? ("skin-" + Date.now() + "-" + crypto.randomUUID().slice(0, 6))),
          job.files,
          ["texts"],
          { ...job.meta, versionName: String(body.label ?? "").trim().slice(0, 120) || new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) },
        );
        if (body.label?.trim()) await m.renameNames(pack.id, {name: body.label.trim().slice(0, 120), skinIndex: 0, skinName: body.label.trim().slice(0, 120)});
        if (!body.slot) return json({ pack, enabled: false });
        try {
          await m.enable(body.slot, pack.id);
          return json({ pack, enabled: true });
        } catch (error) {
          return json({
            pack,
            enabled: false,
            warning: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (url.pathname === "/api/packs/enable" && req.method === "POST") {
        const body = (await req.json()) as { slot?: string; id?: string };
        const m = requireManager(), slot = String(body.slot ?? "");
        const result = await m.enable(slot, String(body.id ?? ""));
        await m.pruneBackups(slot).catch(() => {});
        return json(result);
      }
      if (url.pathname === "/api/packs/disable" && req.method === "POST") {
        const body = (await req.json()) as { slot?: string; id?: string };
        const m = requireManager(), slot = String(body.slot ?? "");
        const result = await m.disable(slot, String(body.id ?? ""));
        await m.pruneBackups(slot).catch(() => {});
        return json(result);
      }
      if (url.pathname === "/api/packs/restore" && req.method === "POST") {
        const body = (await req.json()) as { slot?: string };
        const m = requireManager(), slot = String(body.slot ?? "");
        const result = await m.restore(slot);
        await m.pruneBackups(slot).catch(() => {});
        return json(result);
      }
      if (url.pathname === "/api/packs/recover" && req.method === "POST") {
        const body = (await req.json()) as { slot?: string };
        return json(await requireManager().recover(String(body.slot ?? "")));
      }
      if (url.pathname === "/api/packs/delete" && req.method === "POST") {
        const body = (await req.json()) as { id?: string };
        return json(await requireManager().remove(String(body.id ?? "")));
      }
      if (url.pathname.startsWith("/api/"))
        return json({ error: "Unknown API" }, 404);
      const target = resolve(
        dist,
        url.pathname === "/"
          ? "index.html"
          : "." + decodeURIComponent(url.pathname),
      );
      const actual = await realpath(target).catch(() => null);
      if (
        !actual ||
        !(actual.startsWith(dist + "\\") || actual.startsWith(dist + "/"))
      )
        return new Response("Not found", { status: 404 });
      return new Response(Bun.file(actual));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  },
});
console.log(`4DGen 本地工作台：http://127.0.0.1:${server.port}`);
setTimeout(() => void warmPresetPreviews(), 3000);

