import { build } from "vite";
import { resolve, basename } from "node:path";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
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
  pack?: Uint8Array;
  texture?: Uint8Array;
  geometry?: unknown;
  key?: string;
};
const jobs = new Map<string, Job>();
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
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
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
) {
  if (sessions.size >= 4) sessions.delete(sessions.keys().next().value!);
  const model = await importModel(
    cache && (await Bun.file(resolve(root, cache)).exists())
      ? resolve(root, cache)
      : path,
    { backend: "wasm" },
  );
  const preview = await io.writeBinary(model.document);
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
  sessions.set(id, {
    model,
    preview,
    profile: defaultProfile,
    name,
    materials,
  });
  return {
    id,
    name,
    profile: defaultProfile,
    materials,
    warnings: model.warnings,
  };
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
          if (!p) throw Error("未知示例");
          return json(
            await load(
              resolve(root, p.path),
              p.name,
              JSON.parse(
                await readFile(resolve(root, p.profile), "utf8"),
              ) as HumanoidProfile,
              "cache" in p ? p.cache : undefined,
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
          const folder = resolve(
            root,
            ".cache/web-uploads",
            crypto.randomUUID(),
          );
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
            await writeFile(path, bytes, { flag: "wx" });
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
          if (candidates.length !== 1)
            throw Error(
              `需要恰好一个模型入口，当前找到 ${candidates.length} 个；请只选择一个模型及其贴图`,
            );
          return json(
            await load(candidates[0]!, basename(candidates[0]!), null),
          );
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
        const cached = [...jobs].find(
          ([, job]) => job.key === key && job.status === "done",
        );
        if (cached) return json({ id: cached[0], cached: true });
        const id = crypto.randomUUID(),
          job: Job = {
            key,
            status: "running",
            message: "正在绑定、减面并生成 128×128 图集…",
          };
        if (jobs.size >= 8) jobs.delete(jobs.keys().next().value!);
        jobs.set(id, job);
        busy = true;
        void (async () => {
          try {
            const model = {
              ...s.model,
              document: cloneDocument(s.model.document),
            };
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
            const started = performance.now();
            let exported;
            let details: unknown;
            if (b.binding === "humanoid") {
              const r = await exportHumanoid(model, {
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
            job.pack = await zipSkinPack(files);
            job.texture = exported.png;
            job.geometry = exported.file;
            job.result = {
              report: exported.report,
              details,
              excluded: b.excluded,
              conversionMs: Math.round(performance.now() - started),
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
        if (asset === "geometry") return json(j.geometry);
        if (asset === "texture")
          return new Response(j.texture as BodyInit, {
            headers: { "Content-Type": "image/png" },
          });
        if (asset === "pack")
          return new Response(j.pack as BodyInit, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": 'attachment; filename="4DGen-skin.mcpack"',
            },
          });
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
