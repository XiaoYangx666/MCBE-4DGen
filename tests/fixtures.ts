import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export async function png(): Promise<Uint8Array> {
  return sharp({ create: { width: 8, height: 4, channels: 4,
    background: { r: 40, g: 160, b: 80, alpha: 0.5 } } }).png().toBuffer();
}

/** All synthetic fixture geometry is authored here and may be redistributed with the project. */
export async function documentFixture(skinned = false): Promise<Document> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const normal = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer);
  const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer);
  const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
  const texture = doc.createTexture('rgba').setImage(await png()).setMimeType('image/png').setURI('image.png');
  const material = doc.createMaterial('green').setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 0.5])
    .setMetallicFactor(0).setAlphaMode('BLEND');
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal)
    .setAttribute('TEXCOORD_0', uv).setIndices(indices).setMaterial(material);
  const mesh = doc.createMesh('triangle').addPrimitive(primitive);
  const parent = doc.createNode('parent').setTranslation([10, 0, 0]).setScale([2, 3, 4]);
  const child = doc.createNode('child').setMesh(mesh).setTranslation([1, 0, 0]);
  parent.addChild(child);
  const other = doc.createNode('other').setMesh(mesh).setTranslation([0, 0, 2]);
  parent.addChild(other);
  const scene = doc.createScene('main').addChild(parent);
  doc.getRoot().setDefaultScene(scene);
  if (skinned) {
    const joint = doc.createNode('hips');
    scene.addChild(joint);
    const skin = doc.createSkin('rig').addJoint(joint).setSkeleton(joint);
    const inverse = doc.createAccessor().setType('MAT4').setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buffer);
    skin.setInverseBindMatrices(inverse);
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(12)).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4')
      .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buffer));
    child.setSkin(skin);
  }
  return doc;
}

export async function writeDocument(dir: string, type: 'glb' | 'gltf', skinned = false): Promise<string> {
  const path = join(dir, `model.${type}`);
  await new NodeIO().write(path, await documentFixture(skinned));
  return path;
}

export async function writeObj(dir: string): Promise<string> {
  await mkdir(join(dir, 'textures'));
  await writeFile(join(dir, 'textures', 'color.png'), await png());
  await writeFile(join(dir, 'material.mtl'), 'newmtl green\nKd 1 1 1\nmap_Kd textures/color.png\nnewmtl red\nKd 1 0 0\n');
  const path = join(dir, 'two.obj');
  await writeFile(path, 'mtllib material.mtl\no first\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 2 0 0\nv 3 0 0\nv 2 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl green\nf 1/1 2/2 3/3\no second\nusemtl red\nf 4/1 5/2 6/3\n');
  return path;
}
