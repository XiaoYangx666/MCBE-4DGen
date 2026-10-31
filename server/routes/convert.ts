import { cloneDocument } from '@gltf-transform/functions';
import { bindStatic } from '../../src/bone-mapper.ts';
import { exportBedrockGeometry } from '../../src/bedrock-exporter.ts';
import { exportHumanoid } from '../../src/humanoid.ts';
import type { HumanoidProfile } from '../../src/humanoid.ts';
import { optimizeModel } from '../../src/optimizer.ts';
import { filterMaterialKeys, filterParts } from '../../src/parts.ts';
import { normalizeSelection } from '../../src/selection.ts';
import { buildSkinPack } from '../../src/skin-pack-files.ts';
import { zipSkinPack } from '../../src/skin-pack.ts';
import { HttpError, json, stableJson } from '../http.ts';
import { updateModel } from '../model-library.ts';
import { route, type RouteContext } from '../route.ts';
import type { Job } from '../studio.ts';

export const convertRoutes = [
  route('POST', '/api/convert', async ({ studio, req }) => {
    if (studio.busy) return json({ error: '已有任务正在运行' }, 409);
    const body = (await req.json()) as {
      session: string;
      excluded: string[];
      materialWeights?: Record<string, number>;
      /** Stable part ids to keep; omitted means every part. */
      includedParts?: string[];
      binding: string;
      ratio: number;
      maxError: number;
      height: number;
      profile: HumanoidProfile | null;
      textureMode?: 'legacy' | 'budget';
      textureTarget?: 'texel-density' | 'texel-retention';
      atlasSharing?: boolean;
      /** Recompute the atlas/preview only; do not assemble the skin-pack ZIP. */
      preview?: boolean;
    };
    const session = studio.sessions.get(body.session);
    if (!session) throw new HttpError('模型会话不存在', 404);
    if (
      !['static', 'humanoid'].includes(body.binding) ||
      !Number.isFinite(body.ratio) ||
      body.ratio <= 0 ||
      body.ratio > 1 ||
      !Number.isFinite(body.maxError) ||
      body.maxError < 0 ||
      body.maxError > 1 ||
      !Number.isFinite(body.height) ||
      body.height < 1 ||
      body.height > 128 ||
      !Array.isArray(body.excluded) ||
      body.excluded.some((name) => typeof name !== 'string') ||
      (body.includedParts !== undefined &&
        (!Array.isArray(body.includedParts) ||
          body.includedParts.some((id) => typeof id !== 'string'))) ||
      (body.textureMode !== undefined &&
        !['legacy', 'budget'].includes(body.textureMode)) ||
      (body.textureTarget !== undefined &&
        !['texel-density', 'texel-retention'].includes(body.textureTarget))
    )
      throw Error('转换参数无效');

    // Keys are authoritative; unique legacy names are migrated on read and
    // duplicate/unknown entries are dropped instead of touching a wrong part.
    const selection = normalizeSelection(session.materials, session.parts, {
      excluded: body.excluded,
      materialWeights: body.materialWeights ?? {},
      ...(body.includedParts ? { includedParts: body.includedParts } : {}),
    });
    const excluded = selection.excluded;
    const materialWeights = selection.materialWeights;
    const keepParts = body.includedParts
      ? selection.includedParts ?? []
      : session.parts.map((part) => part.id);
    if (!keepParts.length) throw Error('请至少保留一个模型部件');
    const textureMode = body.textureMode ?? 'legacy';
    const textureTarget = body.textureTarget ?? 'texel-retention';
    const preview = body.preview === true;

    const key = stableJson({
      session: body.session,
      excluded: [...excluded].sort(),
      includedParts: [...keepParts].sort(),
      binding: body.binding,
      ratio: body.ratio,
      maxError: body.maxError,
      height: body.height,
      profile: body.profile,
      materialWeights,
      textureMode,
      textureTarget,
      atlasSharing: !!body.atlasSharing,
    });
    const geometryKey = stableJson({
      session: body.session,
      excluded: [...excluded].sort(),
      includedParts: [...keepParts].sort(),
      binding: body.binding,
      ratio: body.ratio,
      maxError: body.maxError,
      height: body.height,
      profile: body.profile,
    });
    const preparedModel = studio.preparedModels.get(geometryKey);
    const cached = preview
      ? undefined
      : [...studio.jobs].find(
          ([, job]) => job.key === key && job.status === 'done' && !(job.result as { preview?: boolean } | undefined)?.preview,
        );
    if (!preview)
      await updateModel(session.modelId, {
        settings: {
          binding: body.binding,
          ratio: body.ratio,
          maxError: body.maxError,
          height: body.height,
          excluded,
          materialWeights,
          profile: body.profile,
          includedParts: keepParts,
          textureMode,
          textureTarget,
          atlasSharing: !!body.atlasSharing,
          fingerprint: session.fingerprint,
        },
      });
    if (cached) return json({ id: cached[0], cached: true });

    const id = crypto.randomUUID();
    const job: Job = {
      key,
      status: 'running',
      message: preparedModel
        ? preview
          ? '复用模型，更新纹理预览…'
          : '复用模型，仅更新纹理与 UV…'
        : preview
          ? '正在绑定、减面并生成纹理预览…'
          : '正在绑定、减面并生成 128×128 图集…',
      meta: {
        source: session.name,
        modelId: session.modelId,
        materialWeights,
        binding: body.binding,
        ratio: body.ratio,
        maxError: body.maxError,
        height: body.height,
        excluded,
        profile: body.profile,
        preview,
      },
    };
    studio.addJob(id, job);
    studio.busy = true;
    void (async () => {
      try {
        const model = preparedModel
          ? session.model
          : {
              ...session.model,
              document: cloneDocument(session.model.document),
            };
        if (!preparedModel) {
          if (keepParts.length !== session.parts.length)
            filterParts(model.document, new Set(keepParts));
          filterMaterialKeys(model.document, new Set(excluded));
        }
        const started = performance.now();
        // Bedrock samples skin textures with nearest filtering, so the default
        // atlas has no gutter. Set FOURDGEN_ATLAS_PADDING=1 to restore the
        // 1px edge extrusion used by linear-filtered viewers.
        const atlasPadding = (() => {
          const raw = process.env.FOURDGEN_ATLAS_PADDING;
          if (raw === undefined) return 0;
          const value = Number(raw);
          return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
        })();
        let exported;
        let details: unknown;
        if (body.binding === 'humanoid') {
          const result = await exportHumanoid(model, {
            prepared: preparedModel?.humanoid,
            onPrepared: (state) =>
              studio.retainPrepared(geometryKey, { humanoid: state }),
            height: body.height,
            onStage: (phase) => {
              job.message =
                (
                  {
                    rig: '准备骨骼与材质…',
                    pose: '冻结调整后的姿势…',
                    reduction: '按误差限制减面…',
                    atlas: '裁切贴图并分配图集…',
                    export: '导出六个玩家部位…',
                    done: '几何导出完成…',
                  } as Record<string, string>
                )[phase] ?? phase;
            },
            textureSize: 256,
            atlasPadding,
            ...(Object.keys(materialWeights).length
              ? { materialWeights }
              : {}),
            ...(textureMode === 'budget'
              ? {
                  atlasBudget: textureTarget,
                  atlasSharing: !!body.atlasSharing,
                }
              : {}),
            ...(body.profile ? { profile: body.profile } : {}),
            reduction: { ratio: body.ratio, maxError: body.maxError },
          });
          exported = result;
          details = result.binding;
        } else {
          const result = await optimizeModel(model, {
            prepared: preparedModel?.static,
            onPrepared: (state) =>
              studio.retainPrepared(geometryKey, { static: state }),
            prepare: {
              height: body.height,
              center: 'ground',
              rotation: [0, body.profile?.rotationYDegrees ?? 0, 0],
            },
            mesh: { ratio: body.ratio, maxError: body.maxError },
            texture: {
              compactSize: 128,
              padding: atlasPadding,
              ...(Object.keys(materialWeights).length
                ? { materialWeights }
                : {}),
              ...(textureMode === 'budget'
                ? {
                    atlasBudget: textureTarget,
                    atlasSharing: !!body.atlasSharing,
                  }
                : {}),
            },
          });
          exported = await exportBedrockGeometry(bindStatic(result.model), {
            identifier: 'geometry.skin0',
            skinTextureSize: 128,
          });
          details = result.report;
        }
        job.message = '正在校验皮肤包…';
        const files = preview
          ? undefined
          : buildSkinPack({
              geometry: exported.file,
              png: exported.png,
              identifier: 'geometry.skin0',
              packName: packNameFromModel(session.name),
            });
        job.files = files;
        job.texture = exported.png;
        job.geometry = exported.file;
        job.result = {
          report: exported.report,
          details,
          excluded,
          conversionMs: Math.round(performance.now() - started),
          textureOnly: !!preparedModel,
          preview,
          settings: {
            ratio: body.ratio,
            maxError: body.maxError,
            binding: body.binding,
            excluded,
          },
        };
        job.status = 'done';
        job.message = preview ? '预览已更新' : '转换完成';
      } catch (error) {
        job.status = 'error';
        job.message = error instanceof Error ? error.message : String(error);
      } finally {
        studio.busy = false;
      }
    })();
    return json({ id });
  }),

  route('GET', '/api/job/:id', jobState),
  route('GET', '/api/job/:id/:asset', jobState),

  /** Turn a completed preview job into a downloadable pack without recomputing. */
  route('POST', '/api/job/:id/finalize', async ({ studio, params }) => {
    const job = studio.jobs.get(params.id!);
    if (!job) throw new HttpError('任务不存在', 404);
    if (job.status !== 'done') throw new HttpError('任务尚未完成', 409);
    if (job.files) return json({ id: params.id });
    if (!job.texture || !job.geometry)
      throw new HttpError('预览缺少几何或纹理，请重新生成', 409);
    job.files = buildSkinPack({
      geometry: job.geometry as Parameters<typeof buildSkinPack>[0]['geometry'],
      png: job.texture,
      identifier: 'geometry.skin0',
      packName: packNameFromModel(job.meta?.source ?? '4D 皮肤'),
    });
    job.result = { ...(job.result as object), preview: false };
    job.message = '皮肤包已生成';
    return json({ id: params.id });
  }),
];

const MODEL_EXTENSION = /\.(pmx|pmd|glb|gltf|vrm|fbx|obj|dae|stl|ply)$/i;

/** User-visible model name without a source file extension. */
function modelDisplayName(name: string) {
  return name.trim().replace(MODEL_EXTENSION, '').trim();
}

/** Skin pack name derived from the model, never a local-workbench suffix. */
function packNameFromModel(name: string) {
  return modelDisplayName(name).slice(0, 128) || '4D 皮肤';
}

/** Attachment headers with an ASCII fallback and a UTF-8 ZIP name. */
function zipHeaders(name: string) {
  const stem = (modelDisplayName(name) || '4d-skin').slice(0, 80);
  const ascii = stem.replace(/[^\x20-\x7e]|["\\/]/g, '-').trim() || '4d-skin';
  const encoded = encodeURIComponent(`${stem}.zip`);
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encoded}`,
  };
}

async function jobState({ studio, params }: RouteContext) {
  const job = studio.jobs.get(params.id!);
  if (!job) throw new HttpError('任务不存在', 404);
  const asset = params.asset;
  if (!asset)
    return json({
      status: job.status,
      message: job.message,
      result: job.result,
    });
  if (job.status !== 'done') throw Error('任务尚未完成');
  if (asset === 'scene')
    return json({
      name: job.meta?.source ?? '图片皮肤',
      identifier: 'geometry.skin0',
      geometry: job.geometry,
      skins: 1,
      texture: `/api/job/${params.id}/texture`,
    });
  if (asset === 'download') {
    if (!job.files) throw new HttpError('这是预览结果，尚未打包皮肤包', 409);
    return new Response((await zipSkinPack(job.files)) as BodyInit, {
      headers: zipHeaders(job.meta?.source ?? ''),
    });
  }
  if (asset === 'geometry') return json(job.geometry);
  if (asset === 'texture')
    return new Response(job.texture as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  return null;
}
