/**
 * Stage 3: sparse UV island splitting.
 *
 * Compares, on identical inputs and the same 128² atlas:
 *   v2          production merge, no split
 *   strict      stricter merge (fewer, tighter islands), no split
 *   split4      v2 + recursive median split (up to 4 pieces)
 *   split8      v2 + recursive median split (up to 8 pieces)
 *   split8cov   split8 + coverage-aware demand
 *
 * Splitting is measured at the triangle-soup level, which is what the browser
 * pipeline already stores. Vertex duplication cost is computed exactly from
 * the per-corner vertex ids of the real models.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fixtures } from './fixtures.ts';
import { planCandidate, type CandidateOptions } from './candidates.ts';
import { measurePlan, type AtlasDiagnostics } from './metrics.ts';
import { loadRealModel, type RealModel } from './real.ts';
import type { ChartInput } from './types.ts';

const OUT = '.cache/research/v3/sparse';
const DOC = 'docs/research/texture-allocation-v3/data/stage3-sparse.md';

interface Variant {
  name: string;
  options: CandidateOptions;
}

const BASE: CandidateOptions = {
  target: 'retention',
  coverageAware: false,
  sharing: 'none',
};

const VARIANTS: Variant[] = [
  { name: 'v2', options: { ...BASE, merge: 'production' } },
  { name: 'strict', options: { ...BASE, merge: 'strict' } },
  {
    name: 'split4',
    options: { ...BASE, merge: 'production', splitSparse: { minCoverage: 0.5, maxPieces: 4, minTriangles: 8 } },
  },
  {
    name: 'split8',
    options: { ...BASE, merge: 'production', splitSparse: { minCoverage: 0.6, maxPieces: 8, minTriangles: 8 } },
  },
  {
    name: 'split8cov',
    options: {
      ...BASE,
      coverageAware: true,
      merge: 'production',
      splitSparse: { minCoverage: 0.6, maxPieces: 8, minTriangles: 8 },
    },
  },
];

interface Duplication {
  originalVertices: number;
  expandedVertices: number;
  duplicated: number;
}

function duplication(inputs: readonly ChartInput[], plan: ReturnType<typeof planCandidate>['plan']): Duplication {
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const original = new Set<number>();
  for (const input of inputs)
    if (input.vertexIds) for (const id of input.vertexIds) original.add(id);
  const pairs = new Set<string>();
  for (const chart of plan.charts) {
    const groups = chart.triangles ?? [];
    for (const group of groups) {
      const input = byId.get(group.inputId);
      if (!input?.vertexIds) continue;
      for (const triangle of group.triangles)
        for (let corner = 0; corner < 3; corner++) {
          const id = input.vertexIds[triangle * 3 + corner];
          if (id === undefined) continue;
          pairs.add(`${group.inputId}:${id}:${chart.chartId}`);
        }
    }
  }
  return {
    originalVertices: original.size,
    expandedVertices: pairs.size,
    duplicated: Math.max(0, pairs.size - original.size),
  };
}

interface Run {
  variant: string;
  planMs: number;
  charts: number;
  content: number;
  allocated: number;
  uv: number;
  chartCoverage: number;
  error: AtlasDiagnostics['error'];
  duplication: Duplication | null;
}

function run(inputs: readonly ChartInput[], variant: Variant): Run {
  const started = performance.now();
  const result = planCandidate(inputs, variant.options);
  const planMs = performance.now() - started;
  const measured = measurePlan(inputs, result.plan);
  const d = measured.diagnostics;
  const dup = inputs.some((input) => input.vertexIds)
    ? duplication(inputs, result.plan)
    : null;
  return {
    variant: variant.name,
    planMs,
    charts: d.charts,
    content: d.contentUtilization,
    allocated: d.allocatedUtilization,
    uv: d.uvUtilization,
    chartCoverage: d.chartCoverage,
    error: d.error,
    duplication: dup,
  };
}

interface Entry {
  name: string;
  kind: 'fixture' | 'real';
  runs: Run[];
}

const entries: Entry[] = [];
await mkdir(OUT, { recursive: true });

for (const fixture of fixtures()) {
  entries.push({
    name: fixture.name,
    kind: 'fixture',
    runs: VARIANTS.map((variant) => run(fixture.inputs, variant)),
  });
  console.log(
    `[fixture] ${fixture.name}: ` +
      entries.at(-1)!.runs
        .map((r) => `${r.variant} uv=${(r.uv * 100).toFixed(1)}% err=${r.error.meanAbs.toFixed(4)} charts=${r.charts}`)
        .join(' | '),
  );
}

const models: RealModel[] = [];
for (const path of [
  'video/remotion/public/models/shino-source.glb',
  'video/remotion/public/models/nana-source.glb',
  'video/remotion/public/models/furina-source.glb',
]) {
  models.push(await loadRealModel(path));
}

for (const model of models) {
  const runs = VARIANTS.map((variant) => run(model.inputs, variant));
  entries.push({ name: model.name, kind: 'real', runs });
  console.log(
    `[real] ${model.name}: ` +
      runs
        .map(
          (r) =>
            `${r.variant} uv=${(r.uv * 100).toFixed(1)}% err=${r.error.meanAbs.toFixed(4)} charts=${r.charts} dup=${r.duplication ? r.duplication.duplicated : '-'}`,
        )
        .join(' | '),
  );
}

await writeFile(`${OUT}/report.json`, JSON.stringify(entries, null, 2));

const header = [
  '| 输入 | 方案 | 岛数 | content | allocated | UV 覆盖 | 矩形内 UV | 误差均值 | p95 | 边缘误差 | 规划 ms | 复制顶点 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
];
const lines: string[] = [];
for (const entry of entries)
  for (const run of entry.runs)
    lines.push(
      `| ${entry.name} | ${run.variant} | ${run.charts} | ${(run.content * 100).toFixed(1)}% | ${(run.allocated * 100).toFixed(1)}% | ${(run.uv * 100).toFixed(1)}% | ${(run.chartCoverage * 100).toFixed(1)}% | ${run.error.meanAbs.toFixed(4)} | ${run.error.p95.toFixed(4)} | ${run.error.edgeMeanAbs.toFixed(4)} | ${run.planMs.toFixed(1)} | ${run.duplication ? `${run.duplication.duplicated} / ${run.duplication.originalVertices}` : '-'} |`,
    );
await writeFile(DOC, [...header, ...lines, ''].join('\n'));
console.log(`[done] ${DOC}`);
