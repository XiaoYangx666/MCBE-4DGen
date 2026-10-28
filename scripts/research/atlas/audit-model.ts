/**
 * Stage 1 audit helper: prints the part/material structure that the texture
 * pipeline actually sees. Used to check whether Mesh/Node/Primitive identity
 * survives into the atlas stage.
 *
 * Usage: node scripts/research/atlas/audit-model.ts <model...>
 */
import { importModel } from '../../../src/importer.ts';

for (const path of process.argv.slice(2)) {
  const model = await importModel(path);
  const root = model.document.getRoot();
  const nodes = root.listNodes().filter((node) => node.getMesh());
  const meshes = root.listMeshes();
  const materials = root.listMaterials();
  const names = new Map<string, number>();
  for (const material of materials) {
    const name = material.getName() || '(default)';
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  const duplicates = [...names].filter(([, count]) => count > 1);

  // Which materials are used by more than one mesh instance?
  const byMaterial = new Map<string, Set<string>>();
  let instances = 0;
  let instancedMeshes = 0;
  const meshUse = new Map<object, number>();
  for (const node of nodes) {
    instances++;
    const mesh = node.getMesh()!;
    meshUse.set(mesh, (meshUse.get(mesh) ?? 0) + 1);
    for (const primitive of mesh.listPrimitives()) {
      const name = primitive.getMaterial()?.getName() || '(default)';
      const set = byMaterial.get(name) ?? new Set<string>();
      set.add(`${node.getName() || '(node)'}/${mesh.getName() || '(mesh)'}`);
      byMaterial.set(name, set);
    }
  }
  for (const count of meshUse.values()) if (count > 1) instancedMeshes += count - 1;
  const shared = [...byMaterial].filter(([, set]) => set.size > 1);

  const primitives = meshes.reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0);
  const triangles = meshes
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0);

  console.log(
    JSON.stringify(
      {
        path: path.split(/[\\/]/).pop(),
        nodes: nodes.length,
        meshInstances: instances,
        meshes: meshes.length,
        primitives,
        triangles: Math.round(triangles),
        materials: materials.length,
        duplicateMaterialNames: duplicates,
        materialsSharedAcrossMeshInstances: shared.map(([name, set]) => ({
          name,
          parts: set.size,
          examples: [...set].slice(0, 4),
        })),
        instancedMeshInstances: instancedMeshes,
      },
      null,
      2,
    ),
  );
}
