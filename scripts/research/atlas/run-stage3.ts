/**
 * Stage 3 A/B runner: baselines vs candidate A/B/C on identical inputs,
 * identical 128×128 constraint and the same renderer/measurement.
 *
 * Usage:
 *   node scripts/research/atlas/run-stage3.ts                 # all fixtures + real corpus
 *   node scripts/research/atlas/run-stage3.ts --fixtures
 *   node scripts/research/atlas/run-stage3.ts --real --limit 3
 */
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixtures } from './fixtures.ts';
import { planBaselineWeb } from './baseline-web.ts';
import { planBaselineDesktop } from './baseline-desktop.ts';
import { planCandidate, type CandidateOptions, type CandidateResult } from './candidates.ts';
import { measurePlan, type AtlasDiagnostics } from './metrics.ts';
import { remapPlan } from './remap.ts';
import { findRealSamples, loadRealModel } from './real.ts';
import type { AtlasPlan, ChartInput, RgbaImage } from './types.ts';

const OUT = '.cache/research/stage3';

interface Variant {
  name: string;
  pad: number;
  kind: 'baseline' | 'candidate';
  plan: (inputs: readonly ChartInput[], weights?: Record<string, number>) => CandidateResult | { plan: AtlasPlan };
}

const candidate = (
  name: string,
  options: CandidateOptions,
): Variant => ({
  name,
  pad: options.pad ?? 1,
  kind: 'candidate',
  plan: (inputs, weights) =>
    planCandidate(
      inputs,
      weights ? { ...options, weights: { ...options.weights, ...weights } } : options,
    ),
});

const VARIANTS: Variant[] = [
  {
    name: 'baseline-web',
    pad: 1,
    kind: 'baseline',
    plan: (inputs, weights) => ({
      plan: planBaselineWeb(weights ? withWeight(inputs, weights) : inputs, 128, 1),
    }),
  },
  {
    name: 'baseline-desktop',
    pad: 2,
    kind: 'baseline',
    plan: (inputs, weights) => ({
      plan: planBaselineDesktop(inputs, 128, {
        padding: 2,
        ...(weights ? { weights } : {}),
      }),
    }),
  },
  candidate('A-density', { target: 'density', coverageAware: false, sharing: 'none' }),
  candidate('A-retention', { target: 'retention', coverageAware: false, sharing: 'none' }),
  candidate('B-retention-safe', {
    target: 'retention',
    coverageAware: false,
    sharing: 'safe',
  }),
  candidate('C-retention-cov', {
    target: 'retention',
    coverageAware: true,
    sharing: 'none',
  }),
];

function withWeight(inputs: readonly ChartInput[], weights: Record<string, number>): ChartInput[] {
  return inputs.map((input) => {
    const weight = weights[input.material] ?? 1;
    return weight === 1
      ? input
      : {
          ...input,
          area: input.area * weight,
          triangleAreas: input.triangleAreas
            ? input.triangleAreas.map((value) => value * weight)
            : null,
        };
  });
}

interface Correctness {
  vertices: number;
  outsideAtlas: number;
  outsideChart: number;
  nonFinite: number;
  collapsedTriangles: number;
}

/** Remap and check that no vertex leaves the atlas, its chart, or collapses. */
function checkPlan(inputs: readonly ChartInput[], plan: AtlasPlan): Correctness {
  const atlasUvs = remapPlan(inputs, plan);
  const size = plan.size;
  let vertices = 0;
  let outsideAtlas = 0;
  let outsideChart = 0;
  let nonFinite = 0;
  let collapsedTriangles = 0;
  for (const input of inputs) {
    const mapped = atlasUvs.get(input.id);
    if (!mapped?.length) continue;
    for (let i = 0; i < mapped.length; i += 2) {
      const u = mapped[i]!;
      const v = mapped[i + 1]!;
      vertices++;
      if (!Number.isFinite(u) || !Number.isFinite(v)) nonFinite++;
      else if (u < -1e-6 || v < -1e-6 || u > 1 + 1e-6 || v > 1 + 1e-6) outsideAtlas++;
    }
    if (!input.uvs) continue;
    const triangles = Math.floor(input.uvs.length / 6);
    for (let triangle = 0; triangle < triangles; triangle++) {
      const sourceArea = Math.abs(
        ((input.uvs[triangle * 6 + 2]! - input.uvs[triangle * 6]!) *
          (input.uvs[triangle * 6 + 5]! - input.uvs[triangle * 6 + 1]!) -
          (input.uvs[triangle * 6 + 3]! - input.uvs[triangle * 6 + 1]!) *
            (input.uvs[triangle * 6 + 4]! - input.uvs[triangle * 6]!)) /
          2,
      );
      const atlasArea = Math.abs(
        ((mapped[triangle * 6 + 2]! - mapped[triangle * 6]!) *
          (mapped[triangle * 6 + 5]! - mapped[triangle * 6 + 1]!) -
          (mapped[triangle * 6 + 3]! - mapped[triangle * 6 + 1]!) *
            (mapped[triangle * 6 + 4]! - mapped[triangle * 6]!)) /
          2,
      );
      if (sourceArea > 1e-9 && atlasArea < 1e-12) collapsedTriangles++;
    }
  }
  const byId = new Map(inputs.map((input) => [input.id, input]));
  for (const chart of plan.charts) {
    const innerX = chart.rect.x + chart.rect.pad;
    const innerY = chart.rect.y + chart.rect.pad;
    const innerW = Math.max(1, chart.rect.width - chart.rect.pad * 2);
    const innerH = Math.max(1, chart.rect.height - chart.rect.pad * 2);
    const groups =
      chart.triangles ?? [{ inputId: chart.inputId, triangles: null as number[] | null }];
    for (const group of groups) {
      const mapped = atlasUvs.get(group.inputId);
      const count = mapped ? Math.floor(mapped.length / 6) : 0;
      const triangles =
        group.triangles ?? Array.from({ length: count }, (_, index) => index);
      for (const triangle of triangles) {
        if (triangle < 0 || triangle >= count) continue;
        for (let corner = 0; corner < 3; corner++) {
          const index = triangle * 6 + corner * 2;
          const px = (mapped![index] ?? 0) * size;
          const py = (mapped![index + 1] ?? 0) * size;
          // One pixel of tolerance for integer rounding at the content edge.
          if (
            px < innerX - 1 ||
            py < innerY - 1 ||
            px > innerX + innerW + 1 ||
            py > innerY + innerH + 1
          )
            outsideChart++;
        }
      }
    }
    void byId;
  }
  return { vertices, outsideAtlas, outsideChart, nonFinite, collapsedTriangles };
}

interface VariantRun {
  variant: string;
  pad: number;
  planMs: number;
  charts: number;
  diagnostics: AtlasDiagnostics;
  budget?: CandidateResult['budget'];
  correctness: Correctness;
}

interface SweepPoint {
  weight: number;
  density: number;
  ratio: number;
  exponent: number | null;
  totalDensity: number;
  charts: number;
}

interface Sweep {
  variant: string;
  target: string;
  points: SweepPoint[];
}

interface DeletionResult {
  variant: string;
  removed: string;
  before: { density: Record<string, number>; error: number; uv: number };
  after: { density: Record<string, number>; error: number; uv: number };
}

interface Entry {
  name: string;
  kind: 'fixture' | 'real';
  description?: string;
  stats?: { triangles: number; materials: number; textures: number };
  variants: VariantRun[];
  sweeps: Sweep[];
  deletion?: DeletionResult[];
}

const args = process.argv.slice(2);
const fixturesOnly = args.includes('--fixtures');
const realOnly = args.includes('--real');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1]!.split(',') : null;

function runVariant(
  variant: Variant,
  inputs: readonly ChartInput[],
  options: { errors?: boolean } = {},
): VariantRun {
  const started = performance.now();
  const result = variant.plan(inputs);
  const planMs = performance.now() - started;
  const measured = measurePlan(inputs, result.plan, { skipError: options.errors === false });
  const budget = 'budget' in result ? result.budget : undefined;
  return {
    variant: variant.name,
    pad: variant.pad,
    planMs,
    charts: measured.diagnostics.charts,
    diagnostics: measured.diagnostics,
    ...(budget ? { budget } : {}),
    correctness: checkPlan(inputs, result.plan),
  };
}

const SWEEP_WEIGHTS = [0.25, 0.5, 1, 2, 4];

function sweep(variant: Variant, inputs: readonly ChartInput[], target: string): Sweep {
  const points: SweepPoint[] = [];
  for (const weight of SWEEP_WEIGHTS) {
    const result = variant.plan(inputs, { [target]: weight });
    const diagnostics = measurePlan(inputs, result.plan, { skipError: true }).diagnostics;
    const material = diagnostics.materials.find((entry) => entry.material === target);
    const totalTexels = diagnostics.materials.reduce((sum, entry) => sum + entry.atlasTexels, 0);
    const totalArea = diagnostics.materials.reduce((sum, entry) => sum + entry.worldArea, 0);
    points.push({
      weight,
      density: material?.texelDensity ?? 0,
      ratio: 0,
      exponent: null,
      totalDensity: totalArea > 0 ? totalTexels / totalArea : 0,
      charts: diagnostics.charts,
    });
  }
  const base = points.find((point) => point.weight === 1)?.density ?? 1;
  for (const point of points) {
    point.ratio = base > 0 ? point.density / base : 0;
    point.exponent =
      point.weight !== 1 && point.ratio > 0
        ? Math.log(point.ratio) / Math.log(point.weight)
        : null;
  }
  return { variant: variant.name, target, points };
}

function deletion(
  variant: Variant,
  inputs: readonly ChartInput[],
  removed: string,
): DeletionResult | null {
  const kept = inputs.filter((input) => input.material !== removed);
  if (kept.length === inputs.length) return null;
  const before = measurePlan(inputs, variant.plan(inputs).plan);
  const after = measurePlan(kept, variant.plan(kept).plan);
  const density = (target: typeof before) =>
    Object.fromEntries(
      target.diagnostics.materials.map((material) => [material.material, material.texelDensity]),
    );
  return {
    variant: variant.name,
    removed,
    before: {
      density: density(before),
      error: before.diagnostics.error.meanAbs,
      uv: before.diagnostics.uvUtilization,
    },
    after: {
      density: density(after),
      error: after.diagnostics.error.meanAbs,
      uv: after.diagnostics.uvUtilization,
    },
  };
}

async function savePng(image: RgbaImage, name: string) {
  await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toFile(join(OUT, name));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const report: { generatedAt: string; commit: string; atlasSize: number; entries: Entry[] } = {
    generatedAt: new Date().toISOString(),
    commit,
    atlasSize: 128,
    entries: [],
  };

  const sweepTargetsFor = (inputs: readonly ChartInput[]) =>
    [...new Set(inputs.map((input) => input.material))].slice(0, 2);

  if (!realOnly)
    for (const fixture of fixtures()) {
      if (only && !only.includes(fixture.name)) continue;
      const variants = VARIANTS.map((variant) => runVariant(variant, fixture.inputs));
      const targets = fixture.focus
        .map((id) => fixture.inputs.find((input) => input.id === id)?.material ?? id)
        .filter((name, index, list) => list.indexOf(name) === index)
        .slice(0, 2);
      const sweeps = VARIANTS.flatMap((variant) =>
        targets.map((target) => sweep(variant, fixture.inputs, target)),
      );
      const deletionVariant = VARIANTS.find((variant) => variant.name === 'A-retention')!;
      const deletionResults: DeletionResult[] = [];
      if (fixture.name === 'part-deletion') {
        const result = deletion(deletionVariant, fixture.inputs, 'Prop');
        if (result) deletionResults.push(result);
      }
      report.entries.push({
        name: fixture.name,
        kind: 'fixture',
        description: fixture.description,
        variants,
        sweeps,
        ...(deletionResults.length ? { deletion: deletionResults } : {}),
      });
      await savePng(
        measurePlan(fixture.inputs, planCandidate(fixture.inputs, {
          target: 'retention',
          coverageAware: false,
        }).plan).atlas,
        `${fixture.name}-A-retention.png`,
      );
      console.log(
        `[fixture] ${fixture.name}: ` +
          variants
            .map(
              (variant) =>
                `${variant.variant} uv=${(variant.diagnostics.uvUtilization * 100).toFixed(1)}% err=${variant.diagnostics.error.meanAbs.toFixed(4)}`,
            )
            .join(' | '),
      );
    }

  if (!fixturesOnly) {
    const samples = (await findRealSamples()).slice(0, Number.isFinite(limit) ? limit : undefined);
    for (const path of samples) {
      const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      if (only && !only.includes(name)) continue;
      try {
        const loaded = await loadRealModel(path);
        const variants = VARIANTS.map((variant) => runVariant(variant, loaded.inputs));
        const targets = sweepTargetsFor(loaded.inputs);
        const sweeps = VARIANTS.flatMap((variant) =>
          targets.map((target) => sweep(variant, loaded.inputs, target)),
        );
        // Part deletion: drop the material with the largest world area and see
        // whether its budget is reclaimed without disturbing the rest.
        const largest = [...loaded.inputs].sort((a, b) => b.area - a.area)[0];
        const deletionResults: DeletionResult[] = [];
        if (largest)
          for (const variantName of ['baseline-desktop', 'A-retention', 'C-retention-cov']) {
            const variant = VARIANTS.find((entry) => entry.name === variantName)!;
            const result = deletion(variant, loaded.inputs, largest.material);
            if (result) deletionResults.push(result);
          }
        report.entries.push({
          name: loaded.name,
          kind: 'real',
          description: `SHA-256 ${loaded.sha256}`,
          stats: {
            triangles: loaded.stats.triangles,
            materials: loaded.stats.materials,
            textures: loaded.stats.textures,
          },
          variants,
          sweeps,
          ...(deletionResults.length ? { deletion: deletionResults } : {}),
        });
        await savePng(
          measurePlan(loaded.inputs, planCandidate(loaded.inputs, {
            target: 'retention',
            coverageAware: false,
          }).plan).atlas,
          `${loaded.name}-A-retention.png`,
        );
        console.log(
          `[real] ${loaded.name}: ` +
            variants
              .map(
                (variant) =>
                  `${variant.variant} uv=${(variant.diagnostics.uvUtilization * 100).toFixed(1)}% err=${variant.diagnostics.error.meanAbs.toFixed(4)} ${variant.planMs.toFixed(0)}ms`,
              )
              .join(' | '),
        );
      } catch (error) {
        console.error(`[real] ${name} failed:`, error);
      }
    }
  }

  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[done] ${join(OUT, 'report.json')}`);
}

await main();
