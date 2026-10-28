/**
 * Limited-integration check for the desktop budget path.
 *
 * Runs the real production `optimizeTextures` with `atlasBudget` and compares
 * its layout with the research planner on the same model. Also verifies that
 * every exported UV stays inside [0,1] and that the result passes validation.
 *
 * Usage: node scripts/research/atlas/check-integration.ts <model.glb>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { importModel } from '../../../src/importer.ts';
import { optimizeTextures } from '../../../src/texture-optimizer.ts';
import { planCandidate } from './candidates.ts';
import { loadRealModel } from './real.ts';

const path = process.argv[2] ?? 'video/remotion/public/models/shino-source.glb';
await mkdir('.cache/research/integration', { recursive: true });

const started = performance.now();
const model = await importModel(path);
const result = await optimizeTextures(model, {
  compactSize: 128,
  padding: 1,
  filter: 'lanczos3',
  atlasBudget: 'texel-retention',
});
const elapsedMs = performance.now() - started;

const root = result.model.document.getRoot();
let vertices = 0;
let outside = 0;
let charts = 0;
for (const mesh of root.listMeshes())
  for (const primitive of mesh.listPrimitives()) {
    const uv = primitive.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    charts++;
    const value: number[] = [];
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, value);
      vertices++;
      if (
        (value[0] ?? 0) < -1e-6 ||
        (value[1] ?? 0) < -1e-6 ||
        (value[0] ?? 0) > 1 + 1e-6 ||
        (value[1] ?? 0) > 1 + 1e-6
      )
        outside++;
    }
  }

const research = await loadRealModel(path);
const planned = planCandidate(research.inputs, {
  target: 'retention',
  coverageAware: false,
  sharing: 'none',
});
const researchRects = planned.plan.charts
  .map((chart) => `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`)
  .sort();
const outputRects = result.report.regions
  .map((region) => {
    const pad = result.report.padding ?? 1;
    return `${region.x - pad},${region.y - pad},${region.width + pad * 2},${region.height + pad * 2}`;
  })
  .sort();
const matched = researchRects.filter((rect, index) => rect === outputRects[index]).length;

const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
await writeFile(join('.cache/research/integration', `${name}.png`), result.png);
const metadata = await sharp(Buffer.from(result.png)).metadata();

console.log(
  JSON.stringify(
    {
      model: name,
      elapsedMs: Math.round(elapsedMs),
      png: { width: metadata.width, height: metadata.height, bytes: result.png.length },
      charts: result.report.regions.length,
      primitives: charts,
      vertices,
      outsideUv: outside,
      atlas: {
        content: result.report.atlas.contentUtilization,
        allocated: result.report.atlas.allocatedUtilization,
        emptyPixels: result.report.atlas.emptyPixels,
      },
      layoutMatchesResearch: `${matched}/${researchRects.length}`,
      warnings: result.report.warnings.length,
    },
    null,
    2,
  ),
);
