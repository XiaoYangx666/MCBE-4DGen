/**
 * Turn a Stage 1 run into committed, human-readable tables.
 *
 * Reads `.cache/research/stage1/report.json` (gitignored) and writes markdown
 * plus a compact JSON summary under `docs/research/texture-allocation-v2/data`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AtlasDiagnostics } from './metrics.ts';

const SOURCE = '.cache/research/stage1/report.json';
const OUT = 'docs/research/texture-allocation-v2/data';

interface VariantResult {
  variant: string;
  pad: number;
  elapsedMs: number;
  plan: { charts: number; scale: number; rects: { chartId: string; x: number; y: number; width: number; height: number }[] };
  diagnostics: AtlasDiagnostics;
}

interface SweepResult {
  platform: 'web-baseline' | 'desktop-baseline';
  target: string;
  points: {
    weight: number;
    totalDensity: number;
    materials: Record<string, { density: number; atlasTexels: number; worldArea: number }>;
  }[];
}

interface Report {
  generatedAt: string;
  commit: string;
  atlasSize: number;
  fixtures: {
    name: string;
    description: string;
    notes: string;
    variants: VariantResult[];
    weightSweep?: SweepResult[];
  }[];
  real: {
    name: string;
    path: string;
    sha256: string;
    stats: { triangles: number; materials: number; textures: number; textureBytes: number };
    variants: VariantResult[];
    weightSweep?: SweepResult[];
    production?: {
      elapsedMs: number;
      peakRssKb: number;
      analysis: {
        atlasSize: number;
        charts: number;
        contentPixels: number;
        allocatedPixels: number;
        uvPixels: number;
        opaquePixels: number;
        overlapPixels: number;
        contentUtilization: number;
        allocatedUtilization: number;
        uvUtilization: number;
        opaqueUtilization: number;
        materials: {
          material: string;
          worldArea: number;
          atlasTexels: number;
          sourceTexels: number;
          texelDensity: number;
          sourceRatio: number;
          uvPixels: number;
          opaquePixels: number;
          rectPixels: number;
        }[];
        error: {
          samples: number;
          meanAbs: number;
          p95: number;
          maxAbs: number;
          edgeMeanAbs: number;
          interiorMeanAbs: number;
        };
      };
      report: Record<string, number>;
      portAgreement: { compared: number; matched: number; mismatched: string[] };
    };
    notes: string[];
  }[];
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number, digits = 3) => value.toFixed(digits);

function variantRow(name: string, variant: VariantResult) {
  const d = variant.diagnostics;
  return `| ${name} | ${variant.variant} | ${d.charts} | ${pct(d.contentUtilization)} | ${pct(d.allocatedUtilization)} | ${pct(d.uvUtilization)} | ${pct(d.chartCoverage)} | ${pct(d.overlapPixels / (d.size * d.size))} | ${num(d.error.meanAbs, 4)} | ${num(d.error.p95, 4)} | ${num(d.error.edgeMeanAbs, 4)} | ${num(d.error.interiorMeanAbs, 4)} |`;
}

const FIXTURE_HEADER = `| 场景 | 方案 | 岛数 | content | allocated | UV 覆盖 | 矩形内 UV 占比 | 材质重叠 | 误差均值 | 误差 p95 | 边缘误差 | 内部误差 |
|---|---|---|---|---|---|---|---|---|---|---|---|`;

const REAL_HEADER = FIXTURE_HEADER;

function sweepTable(sweep: SweepResult): string[] {
  const base = sweep.points.find((point) => point.weight === 1) ?? sweep.points[0]!;
  const others = Object.keys(base.materials)
    .filter((material) => material !== sweep.target)
    .sort(
      (a, b) =>
        (base.materials[b]?.atlasTexels ?? 0) - (base.materials[a]?.atlasTexels ?? 0),
    )
    .slice(0, 2);
  const lines = [
    `| 权重 | ${sweep.target} 密度 | 目标相对 w=1 | 目标纹理像素 | 全局密度相对 | ${others.map((other) => `${other} 相对`).join(' | ')} |`,
    '|---|---|---|---|---|---|',
  ];
  for (const point of sweep.points) {
    const target = point.materials[sweep.target];
    const baseTarget = base.materials[sweep.target]?.density ?? 1;
    lines.push(
      `| ${point.weight} | ${(target?.density ?? 0).toFixed(1)} | ${((target?.density ?? 0) / (baseTarget || 1)).toFixed(2)}× | ${(target?.atlasTexels ?? 0).toFixed(0)} | ${(point.totalDensity / (base.totalDensity || 1)).toFixed(2)}× | ${others
        .map((other) => {
          const value = point.materials[other]?.density ?? 0;
          const reference = base.materials[other]?.density ?? 1;
          return `${(value / (reference || 1)).toFixed(2)}×`;
        })
        .join(' | ')} |`,
    );
  }
  return lines;
}

async function main() {
  const report = JSON.parse(await readFile(SOURCE, 'utf8')) as Report;
  await mkdir(OUT, { recursive: true });

  const fixtures = [
    `# Stage 1 基准：合成场景（128×128）`,
    '',
    `生成时间：${report.generatedAt}　提交：\`${report.commit}\``,
    '',
    '方案说明：',
    '- `web-baseline`：`webapp/engine/atlas.ts` 的 `planAtlas` 移植版（pad=1），逐像素用研究渲染器绘制。',
    '- `desktop-baseline`：`src/texture-optimizer.ts` compact 分支的移植版（pad=2）。',
    '- 两者的矩形布局均与生产代码逐项校验（见真实模型表 `port` 列）。',
    '- 「矩形内 UV 占比」= uvPixels / contentPixels；“材质重叠”= 同一像素被 ≥2 个材质采样的比例。',
    '',
    FIXTURE_HEADER,
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const fixture of report.fixtures)
    for (const variant of fixture.variants) fixtures.push(variantRow(fixture.name, variant));

  fixtures.push('', '## 场景说明与每材质数据', '');
  for (const fixture of report.fixtures) {
    fixtures.push(`### ${fixture.name}`, '', fixture.description, '', `**已知事实**：${fixture.notes}`, '');
    for (const variant of fixture.variants) {
      fixtures.push(
        `**${variant.variant}**（${variant.plan.charts} 岛，pad=${variant.pad}，缩放=${variant.plan.scale.toFixed(4)}）`,
        '',
        '| 材质 | 世界面积 | atlas texels | 原生 texels | 采样比 | 采样比 p50 | 采样比 p05 | UV 像素 | 矩形像素 | bbox 利用 |',
        '|---|---|---|---|---|---|---|---|---|---|',
      );
      for (const material of variant.diagnostics.materials)
        fixtures.push(
          `| ${material.material} | ${num(material.worldArea)} | ${material.atlasTexels.toFixed(0)} | ${material.sourceTexels.toFixed(0)} | ${material.sourceRatio.toFixed(4)} | ${material.sourceRatioP50.toFixed(4)} | ${material.sourceRatioP05.toFixed(4)} | ${material.uvPixels} | ${material.rectPixels.toFixed(0)} | ${pct(material.bboxUtilization)} |`,
        );
      fixtures.push('');
    }
    for (const sweep of fixture.weightSweep ?? []) {
      fixtures.push(
        `**权重扫描 · ${sweep.platform} · 目标 \`${sweep.target}\`**`,
        '',
        ...sweepTable(sweep),
        '',
      );
    }
  }
  await writeFile(join(OUT, 'stage1-fixtures.md'), fixtures.join('\n'));

  const real = [
    `# Stage 1 基准：真实模型（128×128）`,
    '',
    `生成时间：${report.generatedAt}　提交：\`${report.commit}\``,
    '',
    '真实模型来自本机 `video/remotion/public/models/*-source.glb`（PMX 转换，未纳入 git）。' +
      '每个模型记录 SHA-256，便于在拥有相同素材的机器上复现。',
    '',
    REAL_HEADER,
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const model of report.real)
    for (const variant of model.variants) real.push(variantRow(model.name, variant));

  real.push('', '## 生产管线（未修改的 desktop `optimizeTextures`）', '');
  real.push(
    '| 模型 | 三角面 | 材质 | 贴图 | 岛数 | content | allocated | UV 覆盖 | 不透明覆盖 | 误差均值 | 误差 p95 | 边缘误差 | 耗时 ms | 峰值 RSS KB | 移植一致性 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const model of report.real) {
    if (!model.production) continue;
    const a = model.production.analysis;
    real.push(
      `| ${model.name} | ${model.stats.triangles} | ${model.stats.materials} | ${model.stats.textures} | ${a.charts} | ${pct(a.contentUtilization)} | ${pct(a.allocatedUtilization)} | ${pct(a.uvUtilization)} | ${pct(a.opaqueUtilization)} | ${num(a.error.meanAbs, 4)} | ${num(a.error.p95, 4)} | ${num(a.error.edgeMeanAbs, 4)} | ${model.production.elapsedMs.toFixed(0)} | ${model.production.peakRssKb} | ${model.production.portAgreement.matched}/${model.production.portAgreement.compared} |`,
    );
  }

  for (const model of report.real) {
    real.push('', `### ${model.name}`, '', `\`${model.path}\``, '', `SHA-256 \`${model.sha256}\``, '');
    if (model.production) {
      real.push(
        '| 材质 | 世界面积 | atlas texels | 原生 texels | 采样比 | UV 像素 | 矩形像素 | 矩形浪费 |',
        '|---|---|---|---|---|---|---|---|',
      );
      for (const material of [...model.production.analysis.materials].sort(
        (a, b) => a.sourceRatio - b.sourceRatio,
      ))
        real.push(
          `| ${material.material} | ${num(material.worldArea)} | ${material.atlasTexels.toFixed(0)} | ${material.sourceTexels.toFixed(0)} | ${material.sourceRatio.toFixed(4)} | ${material.uvPixels} | ${material.rectPixels.toFixed(0)} | ${pct(
            material.rectPixels > 0
              ? Math.max(0, material.rectPixels - material.uvPixels) / material.rectPixels
              : 0,
          )} |`,
        );
    }
    if (model.notes.length) real.push('', `警告：${model.notes.join('；')}`);
    for (const sweep of model.weightSweep ?? []) {
      real.push(
        '',
        `**权重扫描 · ${sweep.platform} · 目标 \`${sweep.target}\`**`,
        '',
        ...sweepTable(sweep),
      );
    }
  }
  await writeFile(join(OUT, 'stage1-real.md'), real.join('\n'));

  // Compact machine-readable summary (no rect lists).
  const summary = {
    generatedAt: report.generatedAt,
    commit: report.commit,
    atlasSize: report.atlasSize,
    fixtures: report.fixtures.map((fixture) => ({
      name: fixture.name,
      variants: fixture.variants.map((variant) => ({
        variant: variant.variant,
        charts: variant.diagnostics.charts,
        contentUtilization: variant.diagnostics.contentUtilization,
        allocatedUtilization: variant.diagnostics.allocatedUtilization,
        uvUtilization: variant.diagnostics.uvUtilization,
        chartCoverage: variant.diagnostics.chartCoverage,
        error: variant.diagnostics.error,
        materials: variant.diagnostics.materials,
      })),
    })),
    real: report.real.map((model) => ({
      name: model.name,
      sha256: model.sha256,
      stats: model.stats,
      variants: model.variants.map((variant) => ({
        variant: variant.variant,
        charts: variant.diagnostics.charts,
        contentUtilization: variant.diagnostics.contentUtilization,
        allocatedUtilization: variant.diagnostics.allocatedUtilization,
        uvUtilization: variant.diagnostics.uvUtilization,
        chartCoverage: variant.diagnostics.chartCoverage,
        error: variant.diagnostics.error,
        materials: variant.diagnostics.materials,
      })),
      production: model.production
        ? {
            elapsedMs: model.production.elapsedMs,
            peakRssKb: model.production.peakRssKb,
            analysis: model.production.analysis,
            portAgreement: model.production.portAgreement,
          }
        : null,
    })),
  };
  await writeFile(join(OUT, 'stage1-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[summary] ${OUT}/stage1-fixtures.md`);
  console.log(`[summary] ${OUT}/stage1-real.md`);
  console.log(`[summary] ${OUT}/stage1-summary.json`);
}

await main();
