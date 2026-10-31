import type { Material, Primitive } from "@gltf-transform/core";
import type { Transform } from "@gltf-transform/extensions";
import { cloneDocument } from "@gltf-transform/functions";
import sharp from "sharp";
import type { IntermediateModel } from "./model.ts";
import { inspectModel } from "./inspect.ts";
import { validateModel } from "./validate-model.ts";
import { textureCharts } from "./texture-charts.ts";
import { bakeBaseColorPixels } from "./texture-pixels.ts";
import { optimizeTexturesWithBudget } from "./atlas-desktop.ts";
import { materialKeyMap } from "./parts.ts";
import {
  normalizeWrapMode,
  tileEdge,
  unwrapChartBounds,
  wrapIndex,
} from "./texture-chart-math.ts";

export interface TextureOptions {
  /** Maximum dimension of each source image, preserving aspect ratio. Omit for Original. */
  maxTextureSize?: number;
  /** Explicit square atlas size. Omit for automatic power-of-two size up to 8192. */
  atlasSize?: number;
  filter?: "nearest" | "lanczos3";
  padding?: number;
  /** Crop used UV islands, share equivalent samplers, and fit directly at this final resolution. */
  compactSize?: number;
  /** Compact atlas demand follows world-space surface area; source-area is a diagnostic comparison. */
  allocation?: "surface-area" | "source-area";
  materialWeights?: Record<string, number>;
  /**
   * Opt-in texel-budget allocation shared with the browser planner. Keeps every
   * material independent and reports technical floors instead of silently
   * clamping. Leave undefined for the legacy compact path.
   */
  atlasBudget?: "texel-density" | "texel-retention";
  /** With `atlasBudget`, reuse rectangles only for identical source pixels. */
  atlasSharing?: boolean;
  /** With `atlasBudget`, charge retention demand for sampled UV area. */
  atlasCoverageAware?: boolean;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sublinear atlas demand: keeps one dominant chart from crowding out small details. */
const ALLOCATION_POWER = 0.85;
interface Region {
  material: Material | null;
  primitives: Primitive[];
  uv: Map<Primitive, Float32Array>;
  min: [number, number];
  tiles: [number, number];
  width: number;
  height: number;
  source: { width: number; height: number } | null;
  wrap: [number, number];
  crop?: Rect;
  areas: Record<string, number>;
  /** World area per stable material key; duplicate names stay distinct. */
  areaKeys: Record<string, number>;
  weightedArea: number;
}

/** Best-short-side free rectangle packing. No rotation, so UV orientation stays unchanged. */
function pack(
  regions: Region[],
  size: number,
  padding: number,
  flexible = false,
): Rect[] | null {
  let free: Rect[] = [{ x: 0, y: 0, width: size, height: size }];
  // Small aspect adjustments fill awkward gaps without visibly stretching the
  // source. 1.2 changes the aspect ratio by 1.44x, which is the hard limit.
  const MAX_STRETCH = 1.2;
  const result: Rect[] = Array(regions.length);
  const items = regions
    .map((r, id) => ({
      id,
      width: r.width + padding * 2,
      height: r.height + padding * 2,
    }))
    .sort(
      (a, c) =>
        c.width * c.height - a.width * a.height || a.id - c.id,
    );
  for (const item of items) {
    const originalW = item.width - 2 * padding,
      originalH = item.height - 2 * padding;
    const candidates =
      flexible && regions[item.id]!.crop
        ? [1, MAX_STRETCH, 1 / MAX_STRETCH]
            .map((factor) => {
              const width = Math.max(3, Math.round(originalW * factor));
              const height = Math.max(
                3,
                Math.round((originalW * originalH) / width),
              );
              return {
                width: width + 2 * padding,
                height: height + 2 * padding,
                penalty: Math.abs(Math.log(factor)),
              };
            })
            .filter(
              (c) =>
                (c.width - 2 * padding) * (c.height - 2 * padding) <=
                originalW * originalH * 1.08,
            )
        : [{ width: item.width, height: item.height, penalty: 0 }];
    const choices = free.flatMap((rect) =>
      candidates
        .filter((c) => c.width <= rect.width && c.height <= rect.height)
        .map((c) => ({ rect, ...c })),
    );
    choices.sort(
      (a, b) =>
        Math.min(a.rect.width - a.width, a.rect.height - a.height) -
          Math.min(b.rect.width - b.width, b.rect.height - b.height) ||
        a.penalty - b.penalty,
    );
    const fit = choices[0];
    if (!fit) return null;
    const used = {
      x: fit.rect.x,
      y: fit.rect.y,
      width: fit.width,
      height: fit.height,
    };
    regions[item.id]!.width = fit.width - 2 * padding;
    regions[item.id]!.height = fit.height - 2 * padding;
    result[item.id] = used;
    const next: Rect[] = [];
    for (const r of free) {
      if (
        used.x >= r.x + r.width ||
        used.x + used.width <= r.x ||
        used.y >= r.y + r.height ||
        used.y + used.height <= r.y
      ) {
        next.push(r);
        continue;
      }
      if (used.x > r.x) next.push({ ...r, width: used.x - r.x });
      if (used.x + used.width < r.x + r.width)
        next.push({
          ...r,
          x: used.x + used.width,
          width: r.x + r.width - used.x - used.width,
        });
      if (used.y > r.y) next.push({ ...r, height: used.y - r.y });
      if (used.y + used.height < r.y + r.height)
        next.push({
          ...r,
          y: used.y + used.height,
          height: r.y + r.height - used.y - used.height,
        });
    }
    free = next.filter(
      (r, i) =>
        !next.some(
          (s, j) =>
            i !== j &&
            s.x <= r.x &&
            s.y <= r.y &&
            s.x + s.width >= r.x + r.width &&
            s.y + s.height >= r.y + r.height &&
            (s.x !== r.x ||
              s.y !== r.y ||
              s.width !== r.width ||
              s.height !== r.height ||
              j < i),
        ),
    );
  }
  return result;
}

/** glTF wrap codes go through the shared wrapper (repeat / clamp / mirror). */
function sampleIndex(i: number, size: number, mode: number): number {
  return wrapIndex(i, size, normalizeWrapMode(mode));
}

export async function optimizeTextures(
  input: IntermediateModel,
  options: TextureOptions = {},
) {
  const filter = options.filter ?? "lanczos3",
    padding = options.padding ?? 2;
  if (filter !== "nearest" && filter !== "lanczos3")
    throw new Error("filter must be nearest or lanczos3");
  if (!Number.isSafeInteger(padding) || padding < 0 || padding > 64)
    throw new Error("padding must be an integer in [0, 64]");
  for (const size of [
    options.maxTextureSize,
    options.atlasSize,
    options.compactSize,
  ]) {
    if (
      size !== undefined &&
      (!Number.isSafeInteger(size) || size < 1 || size > 8192)
    )
      throw new Error("Texture dimensions must be integers in [1, 8192]");
  }
  if (
    options.compactSize &&
    options.atlasSize &&
    options.compactSize !== options.atlasSize
  )
    throw new Error("compactSize and atlasSize must agree");
  if (
    options.allocation &&
    !["surface-area", "source-area"].includes(options.allocation)
  )
    throw new Error("Invalid texture allocation");
  if (
    options.materialWeights &&
    (typeof options.materialWeights !== "object" ||
      Array.isArray(options.materialWeights) ||
      Object.values(options.materialWeights).some(
        (w) => !Number.isFinite(w) || w < 0 || w > 20,
      ))
  )
    throw new Error("Material weights must be in [0, 20]");
  if (
    options.atlasBudget !== undefined &&
    !["texel-density", "texel-retention"].includes(options.atlasBudget)
  )
    throw new Error("Invalid atlas budget");
  if (options.atlasBudget)
    return optimizeTexturesWithBudget(input, {
      size: options.compactSize ?? options.atlasSize ?? 128,
      padding: options.padding ?? 1,
      target: options.atlasBudget,
      filter,
      ...(options.materialWeights ? { materialWeights: options.materialWeights } : {}),
      ...(options.atlasSharing ? { sharing: true } : {}),
      ...(options.atlasCoverageAware ? { coverageAware: true } : {}),
    });
  validateModel(input);
  const inspection = await inspectModel(input);
  const model: IntermediateModel = {
    ...input,
    document: cloneDocument(input.document),
    source: { ...input.source },
    warnings: [...inspection.warnings],
  };
  const doc = model.document,
    root = doc.getRoot();
  const keysByMaterial = materialKeyMap(doc);
  const grouped = new Map<Material | null, Primitive[]>();
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) {
      if (p.getAttribute("COLOR_0"))
        throw new Error(
          "Vertex-color baking is not implemented; refusing to silently lose COLOR_0.",
        );
      const material = p.getMaterial();
      if (!grouped.has(material)) grouped.set(material, []);
      grouped.get(material)!.push(p);
    }
  const regions: Region[] = [];
  for (const [material, primitives] of options.compactSize
    ? textureCharts(doc)
    : grouped) {
    const texture = material?.getBaseColorTexture();
    const image = texture?.getImage();
    const metadata = image ? await sharp(image).metadata() : null;
    const source = metadata
      ? { width: metadata.width!, height: metadata.height! }
      : null;
    const scale =
      source && options.maxTextureSize
        ? Math.min(
            1,
            options.maxTextureSize / Math.max(source.width, source.height),
          )
        : 1;
    const w = source ? Math.max(1, Math.round(source.width * scale)) : 4;
    const h = source ? Math.max(1, Math.round(source.height * scale)) : 4;
    const info = material?.getBaseColorTextureInfo();
    const transform = info?.getExtension<Transform>("KHR_texture_transform");
    const coordinate = transform?.getTexCoord() ?? info?.getTexCoord() ?? 0;
    const uv = new Map<Primitive, Float32Array>();
    const low = [Infinity, Infinity],
      high = [-Infinity, -Infinity];
    for (const p of primitives) {
      const count = p.getAttribute("POSITION")!.getCount(),
        values = new Float32Array(count * 2);
      const accessor = p.getAttribute(`TEXCOORD_${coordinate}`);
      if (image && !accessor)
        throw new Error(`Textured primitive is missing TEXCOORD_${coordinate}`);
      const offset = transform?.getOffset() ?? [0, 0],
        scaling = transform?.getScale() ?? [1, 1],
        angle = transform?.getRotation() ?? 0;
      for (let i = 0; i < count; i++) {
        const value: number[] = [];
        accessor?.getElement(i, value);
        const x = (value[0] ?? 0.5) * scaling[0]!,
          y = (value[1] ?? 0.5) * scaling[1]!;
        const u = image
          ? offset[0]! + Math.cos(angle) * x - Math.sin(angle) * y
          : 0.5;
        const v = image
          ? offset[1]! + Math.sin(angle) * x + Math.cos(angle) * y
          : 0.5;
        if (!Number.isFinite(u) || !Number.isFinite(v))
          throw new Error("Texture transform produced invalid UV");
        values[i * 2] = u;
        values[i * 2 + 1] = v;
        low[0] = Math.min(low[0]!, u);
        low[1] = Math.min(low[1]!, v);
        high[0] = Math.max(high[0]!, u);
        high[1] = Math.max(high[1]!, v);
      }
      uv.set(p, values);
    }
    // sin/cos at 90° can put an exact tile edge a few ulps outside its integer.
    // Stabilize the allocation bounds only; keep actual UVs unchanged for sampling.
    const unwrapped = unwrapChartBounds(low[0]!, low[1]!, high[0]!, high[1]!);
    const min: [number, number] = [unwrapped.min[0], unwrapped.min[1]];
    const tiles: [number, number] = [unwrapped.tiles[0], unwrapped.tiles[1]];
    if (unwrapped.exceedsTileSpan)
      throw new Error(
        "UV span exceeds 16 tiles; reduce tiling before atlas baking.",
      );
    const wrap: [number, number] = [
      info?.getWrapS() ?? 10497,
      info?.getWrapT() ?? 10497,
    ];
    let crop: Rect | undefined;
    // Crop the continuous, unwrapped UV interval. Negative and seam-crossing UVs
    // sample a virtual periodic image, rather than reserving entire integer tiles.
    if (options.compactSize && source) {
      const boundedX = tileEdge(low[0]!) >= 0 && tileEdge(high[0]!) <= 1;
      const boundedY = tileEdge(low[1]!) >= 0 && tileEdge(high[1]!) <= 1;
      const x = Math.max(
        boundedX ? 0 : -Infinity,
        Math.floor(tileEdge(low[0]!) * source.width) - 1,
      );
      const y = Math.max(
        boundedY ? 0 : -Infinity,
        Math.floor(tileEdge(low[1]!) * source.height) - 1,
      );
      const width = Math.max(
        1,
        Math.min(
          boundedX ? source.width : Infinity,
          Math.ceil(tileEdge(high[0]!) * source.width) + 1,
        ) - x,
      );
      const height = Math.max(
        1,
        Math.min(
          boundedY ? source.height : Infinity,
          Math.ceil(tileEdge(high[1]!) * source.height) + 1,
        ) - y,
      );
      if (width * height <= 64 * 1024 * 1024) {
        crop = { x, y, width, height };
        min[0] = x / source.width;
        min[1] = y / source.height;
        tiles[0] = width / source.width;
        tiles[1] = height / source.height;
      }
    }
    const areas: Record<string, number> = Object.create(null);
    const areaKeys: Record<string, number> = Object.create(null);
    for (const p of primitives) {
      const sourceMaterial = p.getMaterial();
      const name = sourceMaterial?.getName() ?? "(default)";
      const materialKey = sourceMaterial
        ? (keysByMaterial.get(sourceMaterial) ?? "m:(default)#0")
        : "m:(default)#0";
      const pos = p.getAttribute("POSITION")!;
      const ids =
        p.getIndices()?.getArray() ??
        Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
      const instances = root
        .listNodes()
        .filter((n) => n.getMesh()?.listPrimitives().includes(p));
      for (const node of instances) {
        const m = node.getWorldMatrix();
        const world = (i: number) => {
          const v = pos.getElement(i, []);
          return [0, 1, 2].map(
            (k) =>
              m[k]! * v[0]! +
              m[4 + k]! * v[1]! +
              m[8 + k]! * v[2]! +
              m[12 + k]!,
          );
        };
        for (let i = 0; i < ids.length; i += 3) {
          const a = world(ids[i]!),
            b = world(ids[i + 1]!),
            c = world(ids[i + 2]!);
          const u = b.map((v, k) => v - a[k]!),
            v = c.map((v, k) => v - a[k]!);
          const area =
            Math.hypot(
              u[1]! * v[2]! - u[2]! * v[1]!,
              u[2]! * v[0]! - u[0]! * v[2]!,
              u[0]! * v[1]! - u[1]! * v[0]!,
            ) / 2;
          areas[name] = (areas[name] ?? 0) + area;
          areaKeys[materialKey] = (areaKeys[materialKey] ?? 0) + area;
        }
      }
    }
    const weightedArea = source
      ? Object.entries(areaKeys).reduce(
          (sum, [key, area]) =>
            sum +
            area *
              (options.materialWeights &&
              Object.hasOwn(options.materialWeights, key)
                ? options.materialWeights[key]!
                : options.materialWeights &&
                    Object.hasOwn(options.materialWeights, material?.getName() ?? "")
                  ? options.materialWeights[material!.getName()!]!
                  : 1),
          0,
        )
      : 0; // A flat base-color material has no texture detail to preserve.
    regions.push({
      material,
      primitives,
      uv,
      min,
      tiles,
      width: Math.max(1, Math.round(w * tiles[0])),
      height: Math.max(1, Math.round(h * tiles[1])),
      source,
      ...(crop ? { crop } : {}),
      wrap,
      areas,
      areaKeys,
      weightedArea,
    });
  }
  let size = options.compactSize ?? options.atlasSize ?? 8;
  let layout = pack(regions, size, padding);
  if (options.compactSize) {
    // Sublinear demand keeps one huge body/cloth chart from crowding out many
    // small face, eye and trim charts. It also packs rectangular charts more
    // evenly; real samples with a dominant chart gained several percentage points
    // of effective coverage while models without one stayed neutral.
    const totalArea = regions.reduce(
      (sum, r) => sum + Math.pow(Math.max(0, r.weightedArea), ALLOCATION_POWER),
      0,
    );
    const dimensions = regions.map((r) => {
      if (options.allocation === "source-area") return [r.width, r.height];
      const demand =
        Math.max(
          1e-8,
          Math.pow(Math.max(0, r.weightedArea), ALLOCATION_POWER) /
            Math.max(totalArea, 1e-8),
        ) *
        size *
        size;
      const aspect = Math.max(1 / 32, Math.min(32, r.width / r.height));
      return [Math.sqrt(demand * aspect), Math.sqrt(demand / aspect)];
    });
    // A 3×3 minimum keeps small eye/trim charts sampleable at the final atlas size.
    const minChart = 3;
    const attempt = (scale: number) => {
      regions.forEach((r, i) => {
        r.width = Math.max(
          r.crop ? minChart : r.tiles[0],
          Math.round(dimensions[i]![0]! * scale),
        );
        r.height = Math.max(
          r.crop ? minChart : r.tiles[1],
          Math.round(dimensions[i]![1]! * scale),
        );
      });
      return pack(regions, size, padding, true);
    };
    let low = 0,
      high = size;
    if (!attempt(0))
      throw new Error(
        "Too many UV charts for final atlas with safe gutters; increase compactSize",
      );
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (attempt(mid)) low = mid;
      else high = mid;
    }
    layout = attempt(low);
    // Keep the proportional allocation intact; neighboring free space is not
    // arbitrarily awarded to whichever chart happens to be visited first.
    for (const r of regions)
      if (!r.crop) {
        r.width = Math.floor(r.width / r.tiles[0]) * r.tiles[0];
        r.height = Math.floor(r.height / r.tiles[1]) * r.tiles[1];
      }
  }
  while (
    !layout &&
    options.atlasSize === undefined &&
    !options.compactSize &&
    size < 8192
  ) {
    size *= 2;
    layout = pack(regions, size, padding);
  }
  if (!layout)
    throw new Error(
      `Texture atlas capacity exceeded (${size}×${size}). Increase atlasSize or reduce maxTextureSize; padded regions: ${regions.map((r) => `${r.width + padding * 2}×${r.height + padding * 2}`).join(", ")}. No textures were discarded.`,
    );
  const atlas = Buffer.alloc(size * size * 4);
  const reportRegions: {id:number; material:string; materialKeys:string[]; materials:string[]; surfaceAreas:Record<string,number>; weightedArea:number; x:number; y:number; width:number; height:number; source:Region["source"]; resized:{width:number;height:number}; tiles:Region["tiles"]; crop:Region["crop"]}[] = [];
  // Reuse decoded source images across islands. The eviction budget must cover
  // every distinct source texture used by the atlas: a smaller bound thrashed
  // between textures and re-decoded multi-megapixel PNGs for each island.
  const decodedImages = new Map<Uint8Array, Buffer>();
  const distinctSources = new Set<Uint8Array>();
  for (const region of regions) {
    const image = region.material?.getBaseColorTexture()?.getImage();
    if (image) distinctSources.add(image);
  }
  const decodeCacheLimit = Math.max(3, distinctSources.size);
  const decodeImage = async (image: Uint8Array) => {
    const cached = decodedImages.get(image);
    if (cached) return cached;
    const raw = await sharp(image)
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    if (decodedImages.size >= decodeCacheLimit)
      decodedImages.delete(decodedImages.keys().next().value!);
    decodedImages.set(image, raw);
    return raw;
  };
  // Decode every source the atlas needs up front, concurrently. Each decode is
  // a libvips round trip over a multi-megapixel image; doing them one island at
  // a time serialized the startup latency of every call.
  await Promise.all([...distinctSources].map((image) => decodeImage(image)));
  // Resample islands concurrently. Each call is an independent libvips pipeline
  // over an already decoded buffer, so results are identical to running them
  // one at a time; only the serialized per-call latency is removed. The pixel
  // post-processing below stays in atlas order because it writes one buffer.
  const resampled = await Promise.all(
    regions.map(async (region) => {
      const w = region.crop
          ? region.width
          : Math.round(region.width / region.tiles[0]),
        h = region.crop
          ? region.height
          : Math.round(region.height / region.tiles[1]);
      const image = region.material?.getBaseColorTexture()?.getImage();
      const pipeline =
        image && region.source
          ? sharp(await decodeImage(image), {
              raw: {
                width: region.source.width,
                height: region.source.height,
                channels: 4,
              },
            })
          : image
            ? sharp(image).toColourspace("srgb").ensureAlpha()
            : null;
      let cropped = pipeline;
      if (region.crop) {
        const c = region.crop,
          source = region.source!;
        if (
          c.x >= 0 &&
          c.y >= 0 &&
          c.x + c.width <= source.width &&
          c.y + c.height <= source.height
        ) {
          cropped = pipeline!.extract({
            left: c.x,
            top: c.y,
            width: c.width,
            height: c.height,
          });
        } else {
          const raw = await decodeImage(image!);
          const pixels = Buffer.alloc(c.width * c.height * 4);
          for (let y = 0; y < c.height; y++)
            for (let x = 0; x < c.width; x++) {
              const sx = sampleIndex(c.x + x, source.width, region.wrap[0]),
                sy = sampleIndex(c.y + y, source.height, region.wrap[1]);
              const i = (sy * source.width + sx) * 4,
                j = (y * c.width + x) * 4;
              for (let channel = 0; channel < 4; channel++)
                pixels[j + channel] = raw[i + channel]!;
            }
          cropped = sharp(pixels, {
            raw: { width: c.width, height: c.height, channels: 4 },
          });
        }
      }
      const pixels = cropped
        ? await cropped
            .resize(w, h, { kernel: filter, fit: "fill" })
            .raw()
            .toBuffer()
        : Buffer.alloc(4 * w * h, 255);
      return { w, h, pixels };
    }),
  );
  for (const [id, region] of regions.entries()) {
    const rect = layout[id]!;
    const { w, h, pixels } = resampled[id]!;
    const factor = region.material?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const mode = region.material?.getAlphaMode() ?? "OPAQUE",
      cutoff = region.material?.getAlphaCutoff() ?? 0.5;
    bakeBaseColorPixels(pixels, {
      factor,
      alphaMode: mode,
      alphaCutoff: cutoff,
    });
    // Fill both repeated/clamped/mirrored UV span and gutters with the source sampler's behavior.
    for (let y = -padding; y < region.height + padding; y++)
      for (let x = -padding; x < region.width + padding; x++) {
        const sx = region.crop
          ? sampleIndex(x, w, 33071)
          : sampleIndex(x + region.min[0] * w, w, region.wrap[0]);
        const sy = region.crop
          ? sampleIndex(y, h, 33071)
          : sampleIndex(y + region.min[1] * h, h, region.wrap[1]);
        const src = (sy * w + sx) * 4,
          dst = ((rect.y + y + padding) * size + rect.x + x + padding) * 4;
        for (let c = 0; c < 4; c++) atlas[dst + c] = pixels[src + c]!;
      }
    for (const p of region.primitives) {
      const values = region.uv.get(p)!;
      for (let i = 0; i < values.length; i += 2) {
        values[i] =
          (rect.x +
            padding +
            ((values[i]! - region.min[0]) / region.tiles[0]) * region.width) /
          size;
        values[i + 1] =
          (rect.y +
            padding +
            ((values[i + 1]! - region.min[1]) / region.tiles[1]) *
              region.height) /
          size;
      }
      p.setAttribute(
        "TEXCOORD_0",
        doc
          .createAccessor()
          .setType("VEC2")
          .setArray(Float32Array.from(values))
          .setBuffer(root.listBuffers()[0] ?? doc.createBuffer()),
      );
    }
    reportRegions.push({
      id,
      material: Object.keys(region.areas).join(" / ") || "(default)",
      materials: [...new Set(region.primitives.map((p) => p.getMaterial()?.getName() ?? "(default)"))],
      materialKeys: [...new Set(region.primitives.map((p) => {
        const material = p.getMaterial();
        return material ? (keysByMaterial.get(material) ?? "m:(default)#0") : "m:(default)#0";
      }))],
      surfaceAreas: region.areas,
      weightedArea: region.weightedArea,
      x: rect.x + padding,
      y: rect.y + padding,
      width: region.width,
      height: region.height,
      source: region.source,
      resized: { width: w, height: h },
      tiles: region.tiles,
      crop: region.crop,
    });
  }
  const png = await sharp(atlas, {
    raw: { width: size, height: size, channels: 4 },
  })
    .png()
    .toBuffer();
  let sampledUtilization: number | undefined;
  let uvUtilization: number | undefined;
  let sampledPixels: number | undefined;
  let uvPixels: number | undefined;
  const materialPixels = new Map<string, Uint8Array>();
  const materialUvPixels = new Map<string, Uint8Array>();
  const materialNames = new Map<string, string>();
  if (options.compactSize) {
    const used = new Uint8Array(size * size);
    const uvUsed = new Uint8Array(size * size);
    for (const region of regions)
      for (const p of region.primitives) {
        const material = p.getMaterial();
        const key = material ? (keysByMaterial.get(material) ?? "m:(default)#0") : "m:(default)#0";
        const name = material?.getName() ?? "(default)";
        if (!materialPixels.has(key)) {
          materialPixels.set(key, new Uint8Array(size * size));
          materialUvPixels.set(key, new Uint8Array(size * size));
          materialNames.set(key, name);
        }
        const pixels = materialPixels.get(key)!;
        const uvPixelsForMaterial = materialUvPixels.get(key)!;
        const uv = p.getAttribute("TEXCOORD_0")!,
          indices =
            p.getIndices()?.getArray() ??
            Uint32Array.from({ length: uv.getCount() }, (_, i) => i);
        for (let i = 0; i < indices.length; i += 3) {
          const points = [indices[i]!, indices[i + 1]!, indices[i + 2]!].map(
            (id) => {
              const t: number[] = [];
              uv.getElement(id, t);
              return t.map((v) => v * size);
            },
          );
          const [a, b, c] = points as [number[], number[], number[]];
          const edge = (p: number[], q: number[], x: number, y: number) =>
            (q[0]! - p[0]!) * (y - p[1]!) - (q[1]! - p[1]!) * (x - p[0]!);
          if (Math.abs(edge(a, b, c[0]!, c[1]!)) < 1e-12) {
            // A point/line UV still samples one texel; count it instead of
            // pretending the material has no atlas usage.
            const x = Math.max(
              0,
              Math.min(size - 1, Math.floor((a[0]! + b[0]! + c[0]!) / 3)),
            );
            const y = Math.max(
              0,
              Math.min(size - 1, Math.floor((a[1]! + b[1]! + c[1]!) / 3)),
            );
            uvUsed[y * size + x] = 1;
            uvPixelsForMaterial[y * size + x] = 1;
            if (atlas[(y * size + x) * 4 + 3]! > 0) {
              used[y * size + x] = 1;
              pixels[y * size + x] = 1;
            }
            continue;
          }
          const x0 = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!))),
            x1 = Math.min(size - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!)));
          const y0 = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!))),
            y1 = Math.min(size - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!)));
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
              const e = [
                edge(a, b, x + 0.5, y + 0.5),
                edge(b, c, x + 0.5, y + 0.5),
                edge(c, a, x + 0.5, y + 0.5),
              ];
              if (e.every((v) => v >= 0) || e.every((v) => v <= 0)) {
                uvUsed[y * size + x] = 1;
                uvPixelsForMaterial[y * size + x] = 1;
                if (atlas[(y * size + x) * 4 + 3]! > 0) {
                  used[y * size + x] = 1;
                  pixels[y * size + x] = 1;
                }
              }
            }
        }
      }
    sampledPixels = used.reduce((sum, v) => sum + v, 0);
    uvPixels = uvUsed.reduce((sum, v) => sum + v, 0);
    sampledUtilization = sampledPixels / used.length;
    uvUtilization = uvPixels / uvUsed.length;
  }
  const texture = doc
    .createTexture("atlas")
    .setImage(new Uint8Array(png))
    .setMimeType("image/png")
    .setURI("atlas.png");
  for (const region of regions) {
    const material = region.material ?? doc.createMaterial("default");
    for (const p of region.primitives) p.setMaterial(material);
    for (const ext of material.listExtensions()) ext.dispose();
    material
      .setNormalTexture(null)
      .setMetallicRoughnessTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0])
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setBaseColorFactor([1, 1, 1, 1])
      .setBaseColorTexture(texture);
    const info = material.getBaseColorTextureInfo()!;
    for (const ext of info.listExtensions()) ext.dispose();
    info
      .setTexCoord(0)
      .setWrapS(33071)
      .setWrapT(33071)
      .setMinFilter(filter === "nearest" ? 9728 : 9729)
      .setMagFilter(filter === "nearest" ? 9728 : 9729);
  }
  // Dispose unused materials/textures, after all material extension references have been removed.
  for (const material of root.listMaterials())
    if (
      !root
        .listMeshes()
        .some((m) =>
          m.listPrimitives().some((p) => p.getMaterial() === material),
        )
    )
      material.dispose();
  for (const old of root.listTextures())
    if (old !== texture && old.listParents().length === 1) old.dispose();
  for (const accessor of root.listAccessors())
    if (accessor.listParents().length === 1) accessor.dispose();
  model.warnings.push(
    "Atlas preserves base color and alpha only; PBR lighting/shader effects are not reproduced.",
  );
  validateModel(model);
  return {
    model,
    png,
    report: {
      originalTextures: inspection.textures.map((t) => ({
        width: t.width,
        height: t.height,
        bytes: t.bytes,
      })),
      atlas: (() => {
        const contentPixels = regions.reduce(
          (n, r) => n + r.width * r.height,
          0,
        );
        const allocatedPixels = regions.reduce(
          (n, r) => n + (r.width + 2 * padding) * (r.height + 2 * padding),
          0,
        );
        const totalPixels = size * size;
        return {
          width: size,
          height: size,
          bytes: png.length,
          sampledUtilization,
          uvUtilization,
          contentUtilization: contentPixels / totalPixels,
          allocatedUtilization: allocatedPixels / totalPixels,
          sampledPixels,
          uvPixels,
          contentPixels,
          allocatedPixels,
          gutterPixels: allocatedPixels - contentPixels,
          emptyPixels: totalPixels - allocatedPixels,
          gutterUtilization: (allocatedPixels - contentPixels) / totalPixels,
          emptyUtilization: (totalPixels - allocatedPixels) / totalPixels,
          chartCoverage:
            contentPixels > 0 && uvPixels !== undefined
              ? uvPixels / contentPixels
              : undefined,
        };
      })(),
      filter,
      padding,
      allocation: options.compactSize
        ? (options.allocation ?? "surface-area")
        : "source-area",
      materialWeights: options.materialWeights ?? {},
      materials: [...materialPixels].map(([key, pixels]) => ({
        name: materialNames.get(key) ?? key,
        key,
        pixels: pixels.reduce((sum, v) => sum + v, 0),
        uvPixels: materialUvPixels
          .get(key)!
          .reduce((sum, v) => sum + v, 0),
        regions: reportRegions
          .filter((r) => r.materialKeys.includes(key))
          .map((r) => r.id),
      })),
      regions: reportRegions,
      warnings: model.warnings,
    },
  };
}
