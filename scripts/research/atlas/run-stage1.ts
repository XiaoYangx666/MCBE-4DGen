/**
 * Stage 1 benchmark: run the unmodified production planners on synthetic
 * fixtures and on the local real-model corpus, then measure what they actually
 * produce.
 *
 * Usage:
 *   node scripts/research/atlas/run-stage1.ts                 # fixtures + real corpus
 *   node scripts/research/atlas/run-stage1.ts --fixtures      # fixtures only
 *   node scripts/research/atlas/run-stage1.ts --real --limit 3
 *   ATLAS_SAMPLES="path/a.glb;path/b.vrm" node scripts/research/atlas/run-stage1.ts
 */
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixtures } from './fixtures.ts';
import { planBaselineWeb } from './baseline-web.ts';
import { planBaselineDesktop } from './baseline-desktop.ts';
import {
  analyzeProduction,
  runProduction,
  type ProductionAnalysis,
} from './desktop-production.ts';
import { measurePlan, type AtlasDiagnostics } from './metrics.ts';
import { findRealSamples, loadRealModel } from './real.ts';
import type { AtlasPlan, ChartInput, RgbaImage } from './types.ts';

const OUT = '.cache/research/stage1';

interface VariantResult {
  variant: string;
  pad: number;
  elapsedMs: number;
  plan: {
    charts: number;
    scale: number;
    rects: { chartId: string; x: number; y: number; width: number; height: number }[];
  };
  diagnostics: AtlasDiagnostics;
}

interface FixtureResult {
  name: string;
  description: string;
  notes: string;
  variants: VariantResult[];
  weightSweep?: SweepResult[];
}

interface SweepResult {
  platform: 'web-baseline' | 'desktop-baseline';
  target: string;
  /** Requested weight → per-material texel density. */
  points: { weight: number; totalDensity: number; materials: Record<string, { density: number; atlasTexels: number; worldArea: number }> }[];
}

interface RealResult {
  name: string;
  path: string;
  sha256: string;
  stats: { triangles: number; materials: number; textures: number; textureBytes: number };
  variants: VariantResult[];
  weightSweep?: SweepResult[];
  production?: {
    elapsedMs: number;
    peakRssKb: number;
    analysis: ProductionAnalysis;
    report: {
      width: number;
      height: number;
      contentUtilization: number;
      allocatedUtilization: number;
      sampledUtilization?: number;
      uvUtilization?: number;
      sampledPixels?: number;
      uvPixels?: number;
    };
    portAgreement: { compared: number; matched: number; mismatched: string[] };
  };
  notes: string[];
}

const args = process.argv.slice(2);
const fixturesOnly = args.includes('--fixtures');
const realOnly = args.includes('--real');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1]!.split(',') : null;

const time = <T>(run: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
};

function variant(
  name: string,
  plan: AtlasPlan,
  inputs: readonly ChartInput[],
  elapsedMs: number,
): VariantResult {
  const measured = measurePlan(inputs, plan);
  return {
    variant: name,
    pad: plan.pad,
    elapsedMs,
    plan: {
      charts: plan.charts.length,
      scale: plan.scale,
      rects: plan.charts.map((chart) => ({
        chartId: chart.chartId,
        x: chart.rect.x,
        y: chart.rect.y,
        width: chart.rect.width,
        height: chart.rect.height,
      })),
    },
    diagnostics: measured.diagnostics,
  };
}

async function savePng(image: RgbaImage, name: string) {
  await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toFile(join(OUT, name));
}

const SWEEP_WEIGHTS = [0.25, 1, 4];

/** Browser weights scale a batch's world area; triangle areas follow it. */
function withWeight(inputs: readonly ChartInput[], material: string, weight: number): ChartInput[] {
  return inputs.map((input) =>
    input.material === material
      ? {
          ...input,
          area: input.area * weight,
          triangleAreas: input.triangleAreas
            ? input.triangleAreas.map((value) => value * weight)
            : null,
        }
      : input,
  );
}

function weightSweep(
  inputs: readonly ChartInput[],
  targets: readonly string[],
  platform: 'web-baseline' | 'desktop-baseline',
): SweepResult[] {
  const results: SweepResult[] = [];
  for (const target of targets) {
    const points: SweepResult['points'] = [];
    for (const weight of SWEEP_WEIGHTS) {
      const plan =
        platform === 'web-baseline'
          ? planBaselineWeb(withWeight(inputs, target, weight), 128, 1)
          : planBaselineDesktop(inputs, 128, { padding: 2, weights: { [target]: weight } });
      const diagnostics = measurePlan(inputs, plan, { skipError: true }).diagnostics;
      const materials: Record<string, { density: number; atlasTexels: number; worldArea: number }> = {};
      let texels = 0;
      let area = 0;
      for (const material of diagnostics.materials) {
        materials[material.material] = {
          density: material.texelDensity,
          atlasTexels: material.atlasTexels,
          worldArea: material.worldArea,
        };
        texels += material.atlasTexels;
        area += material.worldArea;
      }
      points.push({ weight, totalDensity: area > 0 ? texels / area : 0, materials });
    }
    results.push({ platform, target, points });
  }
  return results;
}

function contentRects(plan: AtlasPlan) {  return plan.charts
    .map((chart) => ({
      x: chart.rect.x + chart.rect.pad,
      y: chart.rect.y + chart.rect.pad,
      width: Math.max(1, chart.rect.width - chart.rect.pad * 2),
      height: Math.max(1, chart.rect.height - chart.rect.pad * 2),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width);
}

function compareRects(
  a: { x: number; y: number; width: number; height: number }[],
  b: { x: number; y: number; width: number; height: number }[],
) {
  const key = (rect: { x: number; y: number; width: number; height: number }) =>
    `${rect.x},${rect.y},${rect.width},${rect.height}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  const mismatched: string[] = [];
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++)
    if (left[i] !== right[i]) mismatched.push(`${left[i] ?? '-'} vs ${right[i] ?? '-'}`);
  return {
    compared: length,
    matched: length - mismatched.length,
    mismatched: mismatched.slice(0, 12),
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const report: {
    generatedAt: string;
    commit: string;
    atlasSize: number;
    fixtures: FixtureResult[];
    real: RealResult[];
  } = {
    generatedAt: new Date().toISOString(),
    commit,
    atlasSize: 128,
    fixtures: [],
    real: [],
  };
  const rows: string[] = [
    'model,variant,material,worldArea,atlasTexels,sourceTexels,texelDensity,sourceRatio,sourceRatioP50,sourceRatioP05,uvPixels,opaquePixels,rectPixels,wastePixels,bboxUtilization',
  ];

  if (!realOnly)
    for (const fixture of fixtures()) {
      if (only && !only.includes(fixture.name)) continue;
      const web = time(() => planBaselineWeb(fixture.inputs, 128, 1));
      const desktop = time(() =>
        planBaselineDesktop(fixture.inputs, 128, { padding: 2 }),
      );
      const webResult = variant('web-baseline', web.value, fixture.inputs, web.ms);
      const desktopResult = variant(
        'desktop-baseline',
        desktop.value,
        fixture.inputs,
        desktop.ms,
      );
      const focusNames = fixture.focus
        .map((id) => fixture.inputs.find((input) => input.id === id)?.material ?? id)
        .filter((name, index, list) => list.indexOf(name) === index)
        .slice(0, 2);
      report.fixtures.push({
        name: fixture.name,
        description: fixture.description,
        notes: fixture.notes,
        variants: [webResult, desktopResult],
        weightSweep: [
          ...weightSweep(fixture.inputs, focusNames, 'web-baseline'),
          ...weightSweep(fixture.inputs, focusNames, 'desktop-baseline'),
        ],
      });
      const measured = measurePlan(fixture.inputs, web.value);
      await savePng(measured.atlas, `${fixture.name}-web.png`);
      const measuredDesktop = measurePlan(fixture.inputs, desktop.value);
      await savePng(measuredDesktop.atlas, `${fixture.name}-desktop.png`);
      for (const result of [webResult, desktopResult])
        for (const material of result.diagnostics.materials)
          rows.push(
            [
              fixture.name,
              result.variant,
              material.material,
              material.worldArea.toFixed(6),
              material.atlasTexels.toFixed(1),
              material.sourceTexels.toFixed(1),
              material.texelDensity.toFixed(4),
              material.sourceRatio.toFixed(4),
              material.sourceRatioP50.toFixed(4),
              material.sourceRatioP05.toFixed(4),
              material.uvPixels,
              material.opaquePixels,
              material.rectPixels.toFixed(0),
              material.wastePixels.toFixed(0),
              material.bboxUtilization.toFixed(4),
            ].join(','),
          );
      console.log(
        `[fixture] ${fixture.name}: web uv=${(webResult.diagnostics.uvUtilization * 100).toFixed(1)}% error=${webResult.diagnostics.error.meanAbs.toFixed(4)} | desktop uv=${(desktopResult.diagnostics.uvUtilization * 100).toFixed(1)}% error=${desktopResult.diagnostics.error.meanAbs.toFixed(4)}`,
      );
    }

  if (!fixturesOnly) {
    const samples = (await findRealSamples()).slice(0, Number.isFinite(limit) ? limit : undefined);
    console.log(`[real] ${samples.length} sample(s)`);
    for (const path of samples) {
      const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      if (only && !only.includes(name)) continue;
      try {
        const loaded = await loadRealModel(path);
        const web = time(() => planBaselineWeb(loaded.inputs, 128, 1));
        const desktop = time(() =>
          planBaselineDesktop(loaded.inputs, 128, { padding: 2 }),
        );
        const webResult = variant('web-baseline', web.value, loaded.inputs, web.ms);
        const desktopResult = variant(
          'desktop-baseline',
          desktop.value,
          loaded.inputs,
          desktop.ms,
        );
        const production = await runProduction(path, { compactSize: 128, padding: 2 });
        const analysis = analyzeProduction(production);
        // Sweep the three materials that lost the most native detail under the
        // baseline, i.e. the ones a user would actually try to prioritise.
        const critical = [...webResult.diagnostics.materials]
          .filter((material) => material.sourceTexels > 0 && material.sourceRatio > 0)
          .sort((a, b) => a.sourceRatio - b.sourceRatio)
          .slice(0, 3)
          .map((material) => material.material);
        const sweeps = [
          ...weightSweep(loaded.inputs, critical, 'web-baseline'),
          ...weightSweep(loaded.inputs, critical, 'desktop-baseline'),
        ];
        const agreement = compareRects(
          contentRects(desktop.value),
          production.regions.map((region) => ({
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          })),
        );
        report.real.push({
          name: loaded.name,
          path: loaded.path,
          sha256: loaded.sha256,
          stats: loaded.stats,
          variants: [webResult, desktopResult],
          weightSweep: sweeps,
          production: {
            elapsedMs: production.elapsedMs,
            peakRssKb: production.peakRssKb,
            analysis,
            report: {
              width: production.report.atlas.width,
              height: production.report.atlas.height,
              contentUtilization: production.report.atlas.contentUtilization,
              allocatedUtilization: production.report.atlas.allocatedUtilization,
              ...(production.report.atlas.sampledUtilization !== undefined
                ? { sampledUtilization: production.report.atlas.sampledUtilization }
                : {}),
              ...(production.report.atlas.uvUtilization !== undefined
                ? { uvUtilization: production.report.atlas.uvUtilization }
                : {}),
              ...(production.report.atlas.sampledPixels !== undefined
                ? { sampledPixels: production.report.atlas.sampledPixels }
                : {}),
              ...(production.report.atlas.uvPixels !== undefined
                ? { uvPixels: production.report.atlas.uvPixels }
                : {}),
            },
            portAgreement: agreement,
          },
          notes: loaded.warnings,
        });
        await savePng(
          measurePlan(loaded.inputs, web.value).atlas,
          `${loaded.name}-web.png`,
        );
        await savePng(
          measurePlan(loaded.inputs, desktop.value).atlas,
          `${loaded.name}-desktop-ported.png`,
        );
        await savePng(production.atlas, `${loaded.name}-desktop-production.png`);
        for (const result of [webResult, desktopResult])
          for (const material of result.diagnostics.materials)
            rows.push(
              [
                loaded.name,
                result.variant,
                material.material,
                material.worldArea.toFixed(6),
                material.atlasTexels.toFixed(1),
                material.sourceTexels.toFixed(1),
                material.texelDensity.toFixed(4),
                material.sourceRatio.toFixed(4),
                material.sourceRatioP50.toFixed(4),
                material.sourceRatioP05.toFixed(4),
                material.uvPixels,
                material.opaquePixels,
                material.rectPixels.toFixed(0),
                material.wastePixels.toFixed(0),
                material.bboxUtilization.toFixed(4),
              ].join(','),
            );
        for (const material of analysis.materials)
          rows.push(
            [
              loaded.name,
              'desktop-production',
              material.material,
              material.worldArea.toFixed(6),
              material.atlasTexels.toFixed(1),
              material.sourceTexels.toFixed(1),
              material.texelDensity.toFixed(4),
              material.sourceRatio.toFixed(4),
              '',
              '',
              material.uvPixels,
              material.opaquePixels,
              material.rectPixels.toFixed(0),
              Math.max(0, material.rectPixels - material.uvPixels).toFixed(0),
              '',
            ].join(','),
          );
        console.log(
          `[real] ${loaded.name}: tris=${loaded.stats.triangles} mats=${loaded.stats.materials} | production uv=${(analysis.uvUtilization * 100).toFixed(1)}% err=${analysis.error.meanAbs.toFixed(4)} ${production.elapsedMs.toFixed(0)}ms | port match=${agreement.matched}/${agreement.compared}`,
        );
      } catch (error) {
        console.error(`[real] ${name} failed:`, error);
        report.real.push({
          name,
          path,
          sha256: '',
          stats: { triangles: 0, materials: 0, textures: 0, textureBytes: 0 },
          variants: [],
          notes: [`failed: ${error instanceof Error ? error.message : String(error)}`],
        });
      }
    }
  }

  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(OUT, 'materials.csv'), rows.join('\n'));
  console.log(`[done] ${join(OUT, 'report.json')}`);
  console.log(`[done] ${join(OUT, 'materials.csv')}`);
}

await main();
