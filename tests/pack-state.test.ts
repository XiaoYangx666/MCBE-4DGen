import { test } from "vitest";
import assert from "node:assert/strict";
import {
  findActivePack,
  installedSkinIndices,
  isPackFullyInstalled,
  isPackOutdated,
  isSkinInstalled,
} from "../web/packs/pack-state.ts";

test("active pack helpers distinguish whole-pack and selected-skin installs", () => {
  const active = [
    { id: "whole", revision: "r1" },
    { id: "partial", revision: "r2", skins: [1, 3] },
  ];
  assert.equal(findActivePack(active, "partial")?.revision, "r2");
  assert.equal(findActivePack(active, "missing"), undefined);
  assert.equal(findActivePack(undefined, "whole"), undefined);

  assert.deepEqual(installedSkinIndices(active[0], 3), [0, 1, 2]);
  assert.deepEqual(installedSkinIndices(active[1], 4), [1, 3]);
  assert.deepEqual(installedSkinIndices(undefined, 4), []);

  assert.equal(isSkinInstalled(active[0], 2), true);
  assert.equal(isSkinInstalled(active[1], 0), false);
  assert.equal(isSkinInstalled(active[1], 3), true);
  assert.equal(isSkinInstalled(undefined, 0), false);

  assert.equal(isPackOutdated(active[0], "r1"), false);
  assert.equal(isPackOutdated(active[1], "r3"), true);
  assert.equal(isPackOutdated(undefined, "r1"), false);

  assert.equal(isPackFullyInstalled(active[0], 3), true);
  assert.equal(isPackFullyInstalled(active[1], 4), false);
  assert.equal(
    isPackFullyInstalled(
      { id: "partial", revision: "r2", skins: [0, 1, 2, 3] },
      4,
    ),
    true,
  );
  assert.equal(isPackFullyInstalled(undefined, 4), false);
});
