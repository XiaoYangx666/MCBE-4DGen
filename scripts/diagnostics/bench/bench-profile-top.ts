// Diagnostic only: aggregate a V8/Bun .cpuprofile by self time per function.
// Usage: node scripts/diagnostics/bench/bench-profile-top.ts <profile.cpuprofile> [topN]
import { readFile } from 'node:fs/promises';

interface Profile { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }>; }
const profile = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as Profile;
const byKey = new Map<string, number>();
let total = 0;
for (const node of profile.nodes) {
  const hits = node.hitCount ?? 0;
  total += hits;
  if (!hits) continue;
  const url = node.callFrame.url.replace(/^.*[\\/](node_modules|src|scripts)[\\/]/, '$1/');
  const key = `${node.callFrame.functionName || '(anonymous)'} @ ${url}:${node.callFrame.lineNumber + 1}`;
  byKey.set(key, (byKey.get(key) ?? 0) + hits);
}
const top = [...byKey].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3] ?? 25));
console.log(`totalSamples=${total}`);
for (const [key, hits] of top) console.log(`${((hits / total) * 100).toFixed(1).padStart(5)}%  ${hits.toString().padStart(6)}  ${key}`);
