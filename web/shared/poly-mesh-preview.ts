/**
 * three.js preview helpers for exported Bedrock poly_mesh geometry, shared by
 * the desktop workbench and the browser web app.
 *
 * The builder only covers geometry/texture/material assembly. Render loops,
 * OrbitControls, lighting and React shells stay in their respective callers.
 */
import * as THREE from "three";
import type { BedrockGeometryFile } from "../../src/bedrock-types.ts";
import { decodeGeometryTriangles } from "../../src/geometry-validator.ts";

/** Exported packs may use any identifier, so preview the first geometry in the file. */
export function firstGeometryIdentifier(
  geometry: BedrockGeometryFile,
): `geometry.${string}` {
  const identifier = Object.keys(geometry).find((key) =>
    key.startsWith("geometry."),
  );
  if (!identifier) throw new Error("文件里没有可预览的 poly_mesh 几何");
  return identifier as `geometry.${string}`;
}

export interface PolyMeshPreviewOptions {
  /** Geometry key inside the file. Defaults to the first `geometry.*` entry. */
  identifier?: `geometry.${string}`;
  /** Negate X on positions and normals (desktop packs render mirrored). */
  mirrorX?: boolean;
  /** Emit one mesh per bone, named after the bone. Defaults to a single mesh. */
  groupByBone?: boolean;
  /** Material face side. Defaults to `THREE.FrontSide`. */
  side?: THREE.Side;
  /** Alpha cutout threshold. Defaults to `0.5`. */
  alphaTest?: number;
  /** Blend instead of cutout. Defaults to `false`. */
  transparent?: boolean;
  roughness?: number;
  metalness?: number;
  /** Name of the single mesh when `groupByBone` is off. Defaults to `4D skin`. */
  meshName?: string;
  /**
   * Pre-built texture. When supplied, `textureUrl` is ignored, the map is
   * attached immediately and the caller keeps ownership (dispose is not
   * called for it).
   */
  texture?: THREE.Texture;
  /** Called once the internally loaded texture is ready. */
  onTextureLoad?: (texture: THREE.Texture) => void;
}

export interface PolyMeshPreview {
  object: THREE.Group;
  /** Release every geometry, material and (internally loaded) texture. */
  dispose: () => void;
}

/** Pixel-art friendly sampling for Bedrock atlases. */
export function configurePolyMeshTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildBufferGeometry(
  triangles: ReturnType<typeof decodeGeometryTriangles>,
  mirrorX: boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const x = mirrorX ? -1 : 1;
  for (const triangle of triangles) {
    for (const corner of triangle) {
      positions.push(
        corner.position[0] * x,
        corner.position[1],
        corner.position[2],
      );
      normals.push(corner.normal[0] * x, corner.normal[1], corner.normal[2]);
      uvs.push(corner.uv[0], corner.uv[1]);
    }
  }
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  buffer.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  buffer.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  buffer.computeBoundingBox();
  buffer.computeBoundingSphere();
  return buffer;
}

/**
 * Build a three.js preview from the exact exported poly_mesh. Bedrock UVs use
 * a bottom-left origin, matching three's default texture flipY behaviour.
 *
 * The texture is attached once it loads; callers that render on demand should
 * pass `onTextureLoad` to request a redraw.
 */
export function buildPolyMeshPreview(
  geometry: BedrockGeometryFile,
  textureUrl: string,
  options: PolyMeshPreviewOptions = {},
): PolyMeshPreview {
  const identifier = options.identifier ?? firstGeometryIdentifier(geometry);
  const triangles = decodeGeometryTriangles(geometry, identifier);
  const groupByBone = options.groupByBone ?? false;
  const mirrorX = options.mirrorX ?? false;

  const parts = new Map<string, typeof triangles>();
  if (groupByBone) {
    for (const triangle of triangles) {
      const name = triangle[0]!.bone;
      const list = parts.get(name);
      if (list) list.push(triangle);
      else parts.set(name, [triangle]);
    }
  } else {
    parts.set(options.meshName ?? "4D skin", triangles);
  }

  const materials: THREE.MeshStandardMaterial[] = [];
  const object = new THREE.Group();

  for (const [name, list] of parts) {
    const material = new THREE.MeshStandardMaterial({
      roughness: options.roughness ?? 1,
      metalness: options.metalness ?? 0,
      side: options.side ?? THREE.FrontSide,
      transparent: options.transparent ?? false,
      alphaTest: options.alphaTest ?? 0.5,
    });
    if (options.texture) material.map = options.texture;
    materials.push(material);
    const mesh = new THREE.Mesh(buildBufferGeometry(list, mirrorX), material);
    mesh.name = name;
    object.add(mesh);
  }

  let texture: THREE.Texture;
  let ownsTexture = false;
  if (options.texture) {
    texture = configurePolyMeshTexture(options.texture);
  } else {
    ownsTexture = true;
    texture = configurePolyMeshTexture(
      new THREE.TextureLoader().load(textureUrl, (loaded) => {
        configurePolyMeshTexture(loaded);
        for (const material of materials) {
          material.map = loaded;
          material.needsUpdate = true;
        }
        options.onTextureLoad?.(loaded);
      }),
    );
  }

  let disposed = false;
  return {
    object,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      object.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const meshMaterials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of meshMaterials) material.dispose();
      });
      if (ownsTexture) texture.dispose();
    },
  };
}

/** Minimal OrbitControls surface, so this module stays DOM-free for tests. */
export interface PreviewCameraControls {
  target: THREE.Vector3;
  minDistance?: number;
  maxDistance?: number;
  update: () => unknown;
}

export interface FitPreviewCameraOptions {
  /** `angle` matches each caller's default framing; `front` looks along -Z. */
  view?: "angle" | "front";
  /**
   * `max-dimension` is the legacy bounding-sphere framing (fits the largest
   * side regardless of aspect). `extent` is the shared desktop-style
   * width/height framing used by every preview shell.
   */
  strategy?: "max-dimension" | "extent";
  /** Width / height used by the `extent` strategy. Defaults to camera.aspect. */
  aspect?: number;
  /** Distance multiplier. Defaults to 1.45 for `max-dimension`, 1.16 for `extent`. */
  padding?: number;
  /** Reset `camera.zoom` to 1 while framing. Defaults to false. */
  resetZoom?: boolean;
  /**
   * Which Z side the `extent` angle/front camera sits on. Defaults to -1
   * (Bedrock forward). Pass 1 for source models authored facing +Z.
   */
  directionZ?: 1 | -1;
}

/** Camera defaults shared by every preview shell. */
export const PREVIEW_CAMERA = {
  fov: 32,
  near: 0.01,
  far: 10_000,
} as const;

export type PreviewViewKind = "angle" | "front";

/**
 * The desktop pack preview's framing is the reference: a 3/4 angle and a
 * straight-on check, both taken from the model's front (-Z) side.
 */
export const PREVIEW_FRAMING: Record<PreviewViewKind, FitPreviewCameraOptions> = {
  angle: { view: "angle", strategy: "extent", padding: 1.16 },
  front: { view: "front", strategy: "extent", padding: 1.16 },
};

/**
 * Frame a world-space box with the camera. The two strategies intentionally
 * keep their original distance maths; only the shared plumbing lives here.
 */
export function fitPreviewBounds(
  camera: THREE.PerspectiveCamera,
  controls: PreviewCameraControls,
  box: THREE.Box3,
  options: FitPreviewCameraOptions = {},
): boolean {
  if (box.isEmpty()) return false;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const view = options.view ?? "angle";
  const strategy = options.strategy ?? "max-dimension";
  const fov = (camera.fov * Math.PI) / 180;

  let direction: THREE.Vector3;
  let distance: number;
  if (strategy === "extent") {
    const aspect = Math.max(0.2, options.aspect ?? camera.aspect);
    const fitHeight = size.y / (2 * Math.tan(fov / 2));
    const fitWidth = Math.max(size.x, size.z) / (2 * Math.tan(fov / 2) * aspect);
    distance = Math.max(fitHeight, fitWidth) * (options.padding ?? 1.16);
    const z = options.directionZ ?? -1;
    direction =
      view === "front"
        ? new THREE.Vector3(0, 0.07, z)
        : new THREE.Vector3(0.42, 0.16, z);
    camera.near = Math.max(0.001, distance / 100);
    camera.far = Math.max(1000, distance * 100);
  } else {
    const max = Math.max(size.x, size.y, size.z, 0.001);
    distance = (max / (2 * Math.tan(fov / 2))) * (options.padding ?? 1.45);
    direction =
      view === "front"
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0.62, 0.28, 1);
    camera.near = Math.max(distance / 2000, 0.01);
    camera.far = Math.max(distance * 60, 100);
    controls.minDistance = Math.max(max * 0.03, 0.01);
    controls.maxDistance = Math.max(max * 30, 10);
  }

  controls.target.copy(center);
  camera.position
    .copy(center)
    .addScaledVector(direction.normalize(), distance);
  if (options.resetZoom) camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
  return true;
}

/** Frame an object with the camera. */
export function fitPreviewCamera(
  camera: THREE.PerspectiveCamera,
  controls: PreviewCameraControls,
  object: THREE.Object3D,
  options: FitPreviewCameraOptions = {},
): boolean {
  return fitPreviewBounds(
    camera,
    controls,
    new THREE.Box3().setFromObject(object),
    options,
  );
}
