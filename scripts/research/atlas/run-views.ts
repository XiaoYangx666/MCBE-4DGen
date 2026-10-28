/**
 * Fixed-view visual comparison: reference (original textures) vs candidate
 * (128² atlas), plus a per-pixel difference panel.
 *
 * Usage:
 *   node scripts/research/atlas/run-views.ts
 *   node scripts/research/atlas/run-views.ts --model shino-source,furina-source
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { planBaselineWeb } from './baseline-web.ts';
import { planBaselineDesktop } from './baseline-desktop.ts';
import { planCandidate } from './candidates.ts';
import { measurePlan } from './metrics.ts';
import { loadRealModel } from './real.ts';
import { renderComparison } from './view.ts';
import type { AtlasPlan, ChartInput, RgbaImage } from './types.ts';

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--model');
const only = onlyIndex >= 0 ? args[onlyIndex + 1]!.split(',') : null;
const DEFAULT_MODELS = [
  'video/remotion/public/models/shino-source.glb',
  'video/remotion/public/models/furina-source.glb',
  'video/remotion/public/models/nana-source.glb',
];
const SAMPLES = process.env.ATLAS_SAMPLES
  ? process.env.ATLAS_SAMPLES.split(';')
  : DEFAULT_MODELS;

interface Variant {
  name: string;
  plan: (inputs: readonly ChartInput[]) => AtlasPlan;
}

const VARIANTS: Variant[] = [
  { name: 'baseline-web', plan: (inputs) => planBaselineWeb(inputs, 128, 1) },
  {
    name: 'baseline-desktop',
    plan: (inputs) => planBaselineDesktop(inputs, 128, { padding: 2 }),
  },
  {
    name: 'A-retention',
    plan: (inputs) =>
      planCandidate(inputs, { target: 'retention', coverageAware: false, sharing: 'none' })
        .plan,
  },
  {
    name: 'C-retention-cov',
    plan: (inputs) =>
      planCandidate(inputs, { target: 'retention', coverageAware: true, sharing: 'none' })
        .plan,
  },
];

/** Compose three equally sized panels into one PNG-ready buffer. */
function montage(panels: RgbaImage[]): { data: Uint8Array; width: number; height: number } {
  const width = panels.reduce((sum, panel) => sum + panel.width, 0);
  const height = Math.max(...panels.map((panel) => panel.height));
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  let offsetX = 0;
  for (const panel of panels) {
    for (let y = 0; y < panel.height; y++)
      for (let x = 0; x < panel.width; x++) {
        const src = (y * panel.width + x) * 4;
        const dst = (y * width + offsetX + x) * 4;
        data[dst] = panel.data[src]!;
        data[dst + 1] = panel.data[src + 1]!;
        data[dst + 2] = panel.data[src + 2]!;
        data[dst + 3] = panel.data[src + 3]!;
      }
    offsetX += panel.width;
  }
  return { data, width, height };
}

async function main() {
  await mkdir('.cache/research/views', { recursive: true });
  await mkdir('docs/research/texture-allocation-v2/images', { recursive: true });
  const rows: string[] = ['model,variant,coveredPixels,meanError,p95Error'];
  for (const path of SAMPLES) {
    const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    if (only && !only.includes(name)) continue;
    const loaded = await loadRealModel(path);
    for (const variant of VARIANTS) {
      const plan = variant.plan(loaded.inputs);
      const measured = measurePlan(loaded.inputs, plan, { skipError: true });
      const comparison = renderComparison(loaded.inputs, measured.atlas, measured.atlasUvs, {
        width: 360,
        height: 480,
        yaw: 20,
        pitch: -4,
      });
      rows.push(
        `${name},${variant.name},${comparison.coveredPixels},${comparison.meanError.toFixed(5)},${comparison.p95Error.toFixed(5)}`,
      );
      const composed = montage([comparison.reference, comparison.candidate, comparison.diff]);
      const png = await sharp(Buffer.from(composed.data), {
        raw: { width: composed.width, height: composed.height, channels: 4 },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(
        join('.cache/research/views', `${name}-${variant.name}.png`),
        png,
      );
      if (variant.name === 'baseline-web' || variant.name === 'A-retention')
        await writeFile(
          join(
            'docs/research/texture-allocation-v2/images',
            `${name}-${variant.name}.png`,
          ),
          png,
        );
      console.log(
        `[view] ${name} ${variant.name}: mean=${comparison.meanError.toFixed(4)} p95=${comparison.p95Error.toFixed(4)} covered=${comparison.coveredPixels}`,
      );
    }
  }
  await writeFile('.cache/research/views/errors.csv', rows.join('\n'));
  console.log('[done] .cache/research/views/errors.csv');
}

await main();
