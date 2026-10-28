/**
 * Focused check: does deleting a material damage the retained materials'
 * sampling quality? Compares per-material error before and after, which the
 * aggregate number cannot show (the removed material changes the average).
 *
 * Usage: node scripts/research/atlas/check-deletion.ts <model.glb> <material>
 */
import { loadRealModel } from './real.ts';
import { planCandidate } from './candidates.ts';
import { measurePlan } from './metrics.ts';

const path = process.argv[2] ?? 'video/remotion/public/models/shino-source.glb';
const removed = process.argv[3] ?? 'Cloth2';
const model = await loadRealModel(path);
const plan = (inputs: typeof model.inputs) =>
  planCandidate(inputs, { target: 'retention', coverageAware: false }).plan;

const before = measurePlan(model.inputs, plan(model.inputs));
const kept = model.inputs.filter((input) => input.material !== removed);
const after = measurePlan(kept, plan(kept));
const beforeById = new Map(before.diagnostics.error.perMaterial.map((entry) => [entry.material, entry]));

console.log(`| 材质 | 删除前误差 | 删除后误差 | 变化 |`);
console.log(`|---|---|---|---|`);
let improved = 0;
let stable = 0;
let worse = 0;
let worst = 0;
for (const entry of after.diagnostics.error.perMaterial) {
  const previous = beforeById.get(entry.material);
  if (!previous) continue;
  const delta = entry.meanAbs - previous.meanAbs;
  if (delta < -0.001) improved++;
  else if (delta <= 0.001) stable++;
  else {
    worse++;
    worst = Math.max(worst, delta);
  }
  console.log(
    `| ${entry.material} | ${previous.meanAbs.toFixed(4)} | ${entry.meanAbs.toFixed(4)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} |`,
  );
}
console.log(
  `\nretained=${improved + stable + worse} improved=${improved} stable=${stable} worse=${worse} worst_delta=${worst.toFixed(4)}`,
);
