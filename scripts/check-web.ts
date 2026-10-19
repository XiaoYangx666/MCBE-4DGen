import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
const base = "http://127.0.0.1:4173";
const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const v = (await r.json()) as any;
  assert.equal(r.status, 200, JSON.stringify(v));
  return v;
};
assert.equal((await fetch(base)).status, 200);
assert.equal(
  (
    await fetch(base + "/api/load", {
      method: "POST",
      headers: {
        Origin: "http://evil.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    })
  ).status,
  403,
);
const form = new FormData();
form.append(
  "files",
  new File(["v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"], "sample.obj"),
);
form.append("paths", "sample.obj");
const r = await fetch(base + "/api/upload", {
  method: "POST",
  headers: { Origin: base },
  body: form,
});
const s = (await r.json()) as any;
assert.equal(r.status, 200, JSON.stringify(s));
assert.ok(s.id);
assert.equal(
  (await fetch(base + "/api/session/" + s.id + "/preview")).status,
  200,
);
const job = await post("/api/convert", {
  session: s.id,
  excluded: [],
  materialWeights: { [s.materials[0].name]: 0 },
  binding: "static",
  ratio: 1,
  maxError: 0.03,
  height: 32,
  profile: null,
});
for (let i = 0; i < 60; i++) {
  const state = (await (
    await fetch(base + "/api/job/" + job.id)
  ).json()) as any;
  if (state.status === "error") throw Error(state.message);
  if (state.status === "done") {
    assert.equal(state.result.details.texture.allocation, "surface-area");
    assert.equal(
      state.result.details.texture.materialWeights[s.materials[0].name],
      0,
    );
    break;
  }
  if (i === 59) throw Error("Timed out");
  await delay(500);
}
const repeated = await post("/api/convert", {
  session: s.id,
  excluded: [],
  materialWeights: { [s.materials[0].name]: 0 },
  binding: "static",
  ratio: 1,
  maxError: 0.03,
  height: 32,
  profile: null,
});
assert.equal(repeated.id, job.id);
assert.equal(repeated.cached, true);
const packs = (await (await fetch(base + "/api/packs")).json()) as any;
assert.equal(typeof packs.configured, "boolean");
if (packs.configured) {
  assert.ok(Array.isArray(packs.status) && packs.status.length > 0);
  assert.ok(Array.isArray(packs.library));
  for (const slot of packs.status) {
    assert.equal(typeof slot.slot, "string");
    assert.ok(Array.isArray(slot.active));
  }
}
const invalid = new FormData();
invalid.append("files", new File(["invalid"], "bad.obj"));
invalid.append("paths", "../bad.obj");
const denied = await fetch(base + "/api/upload", {
  method: "POST",
  headers: { Origin: base },
  body: invalid,
});
assert.equal(denied.status, 400);
console.log(
  "PASS: page, origin protection, upload, source preview, static conversion, pack manager status, traversal rejection",
);
