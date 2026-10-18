/** Upstream model-specific README explicitly declares CC0; do not infer asset licenses from code. */
const avocado = {
  name: 'Avocado',
  revision: 'edc7c9e67c639d230715049ee31f9a96a6babbbe',
  url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/Avocado/glTF-Binary/Avocado.glb',
  licenseSource: 'https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/Avocado/README.md',
  license: 'CC0-1.0',
  credit: 'Microsoft, 2017',
  sha256: 'ccc9c3ce56423720b09399c2351537207cd5a65f859f9e6e2f30922762f3abd4',
  bytes: 8110040,
  path: '.cache/samples/Avocado.glb',
  expected: { vertices: 406, triangles: 682, meshes: 1, textures: 3 },
} as const;

const toyCar = {
  name: 'ToyCar',
  revision: 'edc7c9e67c639d230715049ee31f9a96a6babbbe',
  url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/ToyCar/glTF-Binary/ToyCar.glb',
  licenseSource: 'https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/ToyCar/README.md',
  license: 'CC0-1.0',
  credit: 'Guido Odendahl (initial model), Eric Chadwick (extensions and scene composition), 2020',
  sha256: '01a60862de55cd4b9f3acfab0b0def86451800f9c42467fcd61052c16cb9838c',
  bytes: 5422412,
  path: '.cache/samples/ToyCar.glb',
  expected: { vertices: 77429, triangles: 108936, meshes: 3, textures: 8 },
} as const;

export function selectSample(name = 'Avocado') {
  if (name === 'Avocado') return avocado;
  if (name === 'ToyCar') return toyCar;
  throw new Error(`Unknown sample: ${name}. Choose Avocado or ToyCar.`);
}
