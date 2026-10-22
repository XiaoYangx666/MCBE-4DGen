import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { decodeGeometryTriangles } from "../../src/geometry-validator";
import { createDemandRender } from "../workbench/demand-render";
import type { Scene } from "./pack-types";
import { bindViewportAppearance } from "../workbench/viewport-appearance";

/** Full-size rotatable preview of a library pack's first skin. */
export function PackPreview({
  packId,
  skinIndex = 0,
  revision = "",
  baseUrl,
}: {
  packId: string;
  skinIndex?: number;
  revision?: string;
  baseUrl?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ front: () => void; reset: () => void } | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setError("");
    fetch(
      `${baseUrl ?? `/api/packs/${encodeURIComponent(packId)}`}/scene?skin=${skinIndex}&revision=${encodeURIComponent(revision)}`,
    )
      .then(async (response) => {
        const body = (await response.json()) as Scene & { error?: string };
        if (!response.ok) throw Error(body.error ?? "预览加载失败");
        if (!cancelled) setScene(body);
      })
      .catch((loadError) => {
        if (!cancelled)
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [packId, skinIndex, revision, baseUrl]);

  useEffect(() => {
    const el = host.current;
    if (!el || !scene?.geometry) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color("#15191e");
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    let userMoved = false;
    controls.addEventListener("start", () => {
      userMoved = true;
    });
    world.add(new THREE.HemisphereLight(0xffffff, 0x707984, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(20, 40, 30);
    world.add(light);
    const grid = new THREE.GridHelper(48, 24, 0x46515b, 0x282f36);
    grid.position.y = -0.01;
    world.add(grid);
    const group = new THREE.Group();
    world.add(group);

    const texture = new THREE.TextureLoader().load(scene.texture, () =>
      render.request(),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    const triangles = decodeGeometryTriangles(
      scene.geometry,
      scene.identifier as `geometry.${string}`,
    );
    const parts = new Map<string, typeof triangles>();
    for (const triangle of triangles) {
      const name = triangle[0]!.bone;
      const list = parts.get(name) ?? [];
      list.push(triangle);
      parts.set(name, list);
    }
    for (const [name, list] of parts) {
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      for (const triangle of list)
        for (const corner of triangle) {
          positions.push(
            -corner.position[0],
            corner.position[1],
            corner.position[2],
          );
          normals.push(-corner.normal[0], corner.normal[1], corner.normal[2]);
          uvs.push(...corner.uv);
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.FrontSide,
          alphaTest: 0.5,
          roughness: 1,
        }),
      );
      mesh.name = name;
      group.add(mesh);
    }

    // Match the in-game forward direction: Bedrock packs face -Z, so the
    // default camera sits in front of the model and looks back along +Z.
    let currentView: "front" | "angle" = "angle";
    function view(kind: "front" | "angle") {
      currentView = kind;
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const width = el?.clientWidth || 1;
      const height = el?.clientHeight || 1;
      const aspect = Math.max(0.2, width / height);
      const fov = (camera.fov * Math.PI) / 180;
      const fitHeight = size.y / (2 * Math.tan(fov / 2));
      const fitWidth =
        Math.max(size.x, size.z) / (2 * Math.tan(fov / 2) * aspect);
      const distance = Math.max(fitHeight, fitWidth) * 1.16;
      const direction =
        kind === "front"
          ? new THREE.Vector3(0, 0.07, -1)
          : new THREE.Vector3(0.42, 0.16, -1);
      controls.target.copy(center);
      camera.position
        .copy(center)
        .addScaledVector(direction.normalize(), distance);
      camera.near = Math.max(0.001, distance / 100);
      camera.far = Math.max(1000, distance * 100);
      camera.updateProjectionMatrix();
      controls.update();
    }
    fitRef.current = {
      front: () => view("front"),
      reset: () => view("angle"),
    };
    view("angle");

    const resize = new ResizeObserver(() => {
      const width = el.clientWidth || 1;
      const height = el.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (!userMoved) view(currentView);
      render.request();
    });
    resize.observe(el);
    const render = createDemandRender(() => {
      const moving = controls.update();
      renderer.render(world, camera);
      return moving;
    });
    controls.addEventListener("change", render.request);
    render.request();
    const unbindAppearance = bindViewportAppearance(
      world,
      grid,
      render.request,
    );
    return () => {
      unbindAppearance();
      controls.removeEventListener("change", render.request);
      render.dispose();
      resize.disconnect();
      controls.dispose();
      group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      });
      texture.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scene]);

  return (
    <div className="packs-preview" ref={host}>
      {!scene && !error && (
        <div className="packs-preview-hint">正在加载预览…</div>
      )}
      {error && <div className="packs-preview-hint error">{error}</div>}
      {scene && !scene.geometry && (
        <>
          <img src={scene.texture} alt={scene.name} />
          <div className="packs-preview-hint">标准皮肤 · 仅贴图</div>
        </>
      )}
      {scene?.geometry && (
        <>
          <div className="packs-preview-hint">
            初始视角：游戏正前方（−Z）· 拖动旋转 · 滚轮缩放
          </div>
          <div className="packs-preview-actions">
            <button type="button" onClick={() => fitRef.current?.front()}>
              正面
            </button>
            <button type="button" onClick={() => fitRef.current?.reset()}>
              默认视角
            </button>
          </div>
        </>
      )}
    </div>
  );
}
