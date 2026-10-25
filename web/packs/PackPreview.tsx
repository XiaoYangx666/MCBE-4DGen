import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildPolyMeshPreview,
  fitPreviewCamera,
} from "../shared/poly-mesh-preview";
import { createPreviewLighting } from "../shared/preview-lighting";
import { createPreviewOrientation } from "../shared/preview-orientation";
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
    let requestRender = () => {};
    // Pack previews are always lit; the rig also owns the soft ground shadow.
    const lighting = createPreviewLighting(renderer, world, {
      onChange: () => requestRender(),
    });
    const grid = new THREE.GridHelper(48, 24, 0x46515b, 0x282f36);
    grid.position.y = -0.01;
    world.add(grid);
    const orientation = createPreviewOrientation({
      direction: -1,
      label: "玩家正前方（−Z）",
    });
    world.add(orientation.object);

    const preview = buildPolyMeshPreview(scene.geometry, scene.texture, {
      identifier: scene.identifier as `geometry.${string}`,
      groupByBone: true,
      mirrorX: true,
      side: THREE.FrontSide,
      alphaTest: 0.5,
      onTextureLoad: () => requestRender(),
    });
    const group = preview.object;
    world.add(group);
    lighting.apply(true, group);
    lighting.fit(group);
    orientation.fit(group);

    // Match the in-game forward direction: Bedrock packs face -Z, so the
    // default camera sits in front of the model and looks back along +Z.
    let currentView: "front" | "angle" = "angle";
    const view = (kind: "front" | "angle") => {
      currentView = kind;
      fitPreviewCamera(camera, controls, group, {
        view: kind,
        strategy: "extent",
        aspect: (el.clientWidth || 1) / (el.clientHeight || 1),
        padding: 1.16,
      });
    };
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
    requestRender = render.request;
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
      preview.dispose();
      orientation.dispose();
      lighting.dispose();
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
