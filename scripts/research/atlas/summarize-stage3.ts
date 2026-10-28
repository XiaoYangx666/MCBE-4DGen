/**
 * Turn a Stage 3 run into committed markdown.
 * Input : .cache/research/stage3/report.json (gitignored)
 * Output: docs/research/texture-allocation-v2/data/stage3-*.md
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AtlasDiagnostics } from './metrics.ts';

const SOURCE = '.cache/research/stage3/report.json';
const OUT = 'docs/research/texture-allocation-v2/data';

interface VariantRun {
  variant: string;
  pad: number;
  planMs: number;
  charts: number;
  diagnostics: AtlasDiagnostics;
  budget?: {
    scale: number;
    floorBoundCharts: number;
    floorPixels: number;
    contentPixels: number;
    allocatedPixels: number;
    slots: number;
    charts: number;
    sharedCharts: number;
    sharedSavedPixels: number;
  };
  correctness: {
    vertices: number;
    outsideAtlas: number;
    outsideChart: number;
    nonFinite: number;
    collapsedTriangles: number;
  };
}

interface SweepPoint {
  weight: number;
  density: number;
  ratio: number;
  exponent: number | null;
  totalDensity: number;
  charts: number;
}

interface Entry {
  name: string;
  kind: 'fixture' | 'real';
  description?: string;
  stats?: { triangles: number; materials: number; textures: number };
  variants: VariantRun[];
  sweeps: { variant: string; target: string; points: SweepPoint[] }[];
  deletion?: {
    variant: string;
    removed: string;
    before: { density: Record<string, number>; error: number; uv: number };
    after: { density: Record<string, number>; error: number; uv: number };
  }[];
}

interface Report {
  generatedAt: string;
  commit: string;
  atlasSize: number;
  entries: Entry[];
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const f = (value: number, digits = 4) => value.toFixed(digits);

async function main() {
  const report = JSON.parse(await readFile(SOURCE, 'utf8')) as Report;
  await mkdir(OUT, { recursive: true });

  const variants = report.entries[0]?.variants.map((variant) => variant.variant) ?? [];

  const models: string[] = [
    `# Stage 3：方案对比（128×128）`,
    '',
    `生成时间：${report.generatedAt}　提交：\`${report.commit}\``,
    '',
    '所有方案使用相同输入、相同 128×128 约束、相同 CPU 渲染器与相同测量。' +
      '`planMs` 只包含规划（不含绘制与测量）。`空洞` 指矩形内未被三角面覆盖的像素。',
    '',
    '| 模型 | 方案 | 岛 | content | allocated | UV 覆盖 | 矩形内 UV | 误差均值 | p95 | 边缘误差 | 规划 ms | 越界 UV | 越出矩形 | 退化三角 | floor 岛 | 共享岛 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const entry of report.entries)
    for (const variant of entry.variants)
      models.push(
        `| ${entry.name} | ${variant.variant} | ${variant.charts} | ${pct(variant.diagnostics.contentUtilization)} | ${pct(variant.diagnostics.allocatedUtilization)} | ${pct(variant.diagnostics.uvUtilization)} | ${pct(variant.diagnostics.chartCoverage)} | ${f(variant.diagnostics.error.meanAbs)} | ${f(variant.diagnostics.error.p95)} | ${f(variant.diagnostics.error.edgeMeanAbs)} | ${variant.planMs.toFixed(1)} | ${variant.correctness.outsideAtlas} | ${variant.correctness.outsideChart} | ${variant.correctness.collapsedTriangles} | ${variant.budget?.floorBoundCharts ?? '-'} | ${variant.budget?.sharedCharts ?? '-'} |`,
      );

  models.push('', '## 逐材质：细节保留与误差', '');
  models.push(
    '只列出基线 web 采样比最低（细节最紧张）的 4 个材质与面积最大的 2 个材质。' +
      '`×` 是相对基线 web 的纹理密度倍数；误差为该材质三角面采样点的线性 RGB 平均绝对差。',
    '',
  );
  for (const entry of report.entries) {
    const base = entry.variants.find((variant) => variant.variant === 'baseline-web');
    if (!base) continue;
    const ranked = [...base.diagnostics.materials].sort(
      (a, b) => a.sourceRatio - b.sourceRatio,
    );
    const detail = ranked.slice(0, 4);
    const large = [...base.diagnostics.materials]
      .sort((a, b) => b.worldArea - a.worldArea)
      .slice(0, 2);
    const selected = [...detail, ...large].filter(
      (material, index, list) =>
        list.findIndex((other) => other.material === material.material) === index,
    );
    models.push(`### ${entry.name}`, '');
    models.push(
      `| 材质 | 基线密度 | 基线误差 | 桌面 ×/误差 | A-density ×/误差 | A-retention ×/误差 | C ×/误差 |`,
      '|---|---|---|---|---|---|---|',
    );
    for (const material of selected) {
      const cell = (name: string) => {
        const variant = entry.variants.find((candidate) => candidate.variant === name);
        if (!variant) return '-';
        const found = variant.diagnostics.materials.find(
          (candidate) => candidate.material === material.material,
        );
        const error = variant.diagnostics.error.perMaterial.find(
          (candidate) => candidate.material === material.material,
        );
        if (!found) return '-';
        const ratio =
          material.texelDensity > 0 ? found.texelDensity / material.texelDensity : 0;
        return `${ratio.toFixed(2)}× / ${error ? error.meanAbs.toFixed(4) : '-'}`;
      };
      const baseError = base.diagnostics.error.perMaterial.find(
        (candidate) => candidate.material === material.material,
      );
      models.push(
        `| ${material.material} | ${material.texelDensity.toFixed(0)} | ${baseError ? baseError.meanAbs.toFixed(4) : '-'} | ${cell('baseline-desktop')} | ${cell('A-density')} | ${cell('A-retention')} | ${cell('C-retention-cov')} |`,
      );
    }
    models.push('');
  }

  await writeFile(join(OUT, 'stage3-models.md'), models.join('\n'));

  const control: string[] = [
    `# Stage 3：权重控制实验`,
    '',
    `生成时间：${report.generatedAt}　提交：\`${report.commit}\``,
    '',
    '对每个目标材质设置 0.25×/0.5×/1×/2×/4×，记录其**实际纹理密度**相对 1× 的倍数。' +
      '`exp` = log(实际倍数)/log(权重)：理想的可预测控制在 **2.0**（面积密度 ∝ w²，' +
      '即线性密度 ∝ w）；`0.00` 表示完全无响应。',
    '',
    '| 模型 | 方案 | 目标 | 0.25× | 0.5× | 1× | 2× | 4× | exp(4×) |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const entry of report.entries)
    for (const sweep of entry.sweeps) {
      const at = (weight: number) => sweep.points.find((point) => point.weight === weight);
      const four = at(4);
      control.push(
        `| ${entry.name} | ${sweep.variant} | ${sweep.target} | ${at(0.25)?.ratio.toFixed(2) ?? '-'} | ${at(0.5)?.ratio.toFixed(2) ?? '-'} | ${at(1)?.ratio.toFixed(2) ?? '-'} | ${at(2)?.ratio.toFixed(2) ?? '-'} | ${four?.ratio.toFixed(2) ?? '-'} | ${four?.exponent !== null && four?.exponent !== undefined ? four.exponent.toFixed(2) : '-'} |`,
      );
    }
  await writeFile(join(OUT, 'stage3-control.md'), control.join('\n'));

  const deletion: string[] = [
    `# Stage 3：部件/材质删除实验`,
    '',
    `生成时间：${report.generatedAt}　提交：\`${report.commit}\``,
    '',
    '删除一个材质批次后重新规划。`保留材质平均密度` 是仍存在材质的纹理密度均值，' +
      '用于判断被删除材质的需求是否真正让出；`误差` 是保留材质的采样误差，' +
      '用于确认删除没有破坏其余 UV。',
    '',
    '| 模型 | 方案 | 删除 | 删除前密度 | 删除后密度 | 变化 | 删除前 UV | 删除后 UV | 删除前误差 | 删除后误差 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const entry of report.entries)
    for (const result of entry.deletion ?? []) {
      const mean = (density: Record<string, number>) => {
        const values = Object.entries(density).filter(([name]) => name !== result.removed);
        return values.length
          ? values.reduce((sum, [, value]) => sum + value, 0) / values.length
          : 0;
      };
      const before = mean(result.before.density);
      const after = mean(result.after.density);
      deletion.push(
        `| ${entry.name} | ${result.variant} | ${result.removed} | ${before.toFixed(0)} | ${after.toFixed(0)} | ${before > 0 ? ((after / before - 1) * 100).toFixed(1) : '-'}% | ${pct(result.before.uv)} | ${pct(result.after.uv)} | ${result.before.error.toFixed(4)} | ${result.after.error.toFixed(4)} |`,
      );
    }
  await writeFile(join(OUT, 'stage3-deletion.md'), deletion.join('\n'));

  const summary = {
    generatedAt: report.generatedAt,
    commit: report.commit,
    atlasSize: report.atlasSize,
    variants,
    entries: report.entries.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      stats: entry.stats,
      variants: entry.variants.map((variant) => ({
        variant: variant.variant,
        charts: variant.charts,
        planMs: variant.planMs,
        contentUtilization: variant.diagnostics.contentUtilization,
        allocatedUtilization: variant.diagnostics.allocatedUtilization,
        uvUtilization: variant.diagnostics.uvUtilization,
        chartCoverage: variant.diagnostics.chartCoverage,
        error: variant.diagnostics.error,
        budget: variant.budget,
        correctness: variant.correctness,
      })),
      sweeps: entry.sweeps,
      deletion: entry.deletion,
    })),
  };
  await writeFile(join(OUT, 'stage3-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[summary] ${OUT}/stage3-models.md`);
  console.log(`[summary] ${OUT}/stage3-control.md`);
  console.log(`[summary] ${OUT}/stage3-deletion.md`);
  console.log(`[summary] ${OUT}/stage3-summary.json`);
}

await main();
