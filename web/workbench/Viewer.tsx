import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { BedrockGeometryFile } from "../../src/bedrock-types";
import { buildPolyMeshPreview } from "../shared/poly-mesh-preview";
import { createPosePreview } from "./pose-preview";
import type { HumanoidProfile } from "../../src/humanoid";
import type { Result, Session } from "./types";
import type { PartSummary } from "../../src/api-types";
import { applyPartMeshState, collectPartMeshes } from "./part-visibility";
import { api } from "../lib/api";
import { preparePreviewMaterial } from "./preview-material";
import {
  createPreviewViewport,
  type PreviewViewport,
} from "../shared/preview-viewport";
import { ViewLightingButton } from "../shared/ViewLightingButton";
import { captureCameraView, restoreCameraView, type CameraViewState } from "./camera-state";

type CameraState = CameraViewState & { sessionId: string };

export function Viewer({
  session,
  result,
  mode,
  excluded,
  wire,
  unlit,
  focus,
  solo,
  profile,
  height,
  binding,
  onSelect,
  onSelectCandidates,
  previewUrl,
  parts,
  includedParts,
  selectedPart,
  onUnlitChange,
}: {
  previewUrl?: string;
  session: Session | null;
  result: Result | null;
  mode: string;
  excluded: string[];
  wire: boolean;
  unlit: boolean;
  focus: string;
  solo: string | null;
  profile: HumanoidProfile;
  height: number;
  binding: string;
  onSelect: (name: string) => void;
  /** Called with several material names when a click cannot pick one. */
  onSelectCandidates?: (names: string[]) => void;
  parts?: readonly PartSummary[];
  includedParts: ReadonlySet<string>;
  selectedPart: string | null;
  /** Toggle scene lighting; omit to hide the button (preview-only hosts). */
  onUnlitChange?: (unlit: boolean) => void;
}) {
  const viewKind = mode === "result" && result ? "result" : "source";
  const host = useRef<HTMLDivElement>(null);
  const poseSettings = useRef({ profile, height, binding });
  poseSettings.current = { profile, height, binding };
  const settings = useRef({ excluded, wire, unlit, focus, solo, mode, ...poseSettings.current, onSelect, onSelectCandidates, parts, includedParts, selectedPart });
  settings.current = { excluded, wire, unlit, focus, solo, mode, ...poseSettings.current, onSelect, onSelectCandidates, parts, includedParts, selectedPart };
  const frameRef = useRef<((part?: string) => void) | null>(null);
  const frontRef = useRef<(() => void) | null>(null);
  const invalidate = useRef<(() => void) | null>(null);
  useEffect(()=>{invalidate.current?.();},[excluded,wire,unlit,focus,solo,mode,profile,height,binding,parts,includedParts,selectedPart]);
  const cameraState = useRef<CameraState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [textures, setTextures] = useState(0);
  const [textureWarning, setTextureWarning] = useState("");

  useEffect(() => {
    setError("");
    setTextures(0);
    setTextureWarning("");
    const el = host.current!;
    let disposed = false;

    let poseController: ReturnType<typeof createPosePreview> | null = null;
    let poseSignature = "";
    let modelDirty = true;
    let beforeRender = () => {};
    let partStates: ReturnType<typeof collectPartMeshes> = [];

    let view: PreviewViewport;
    try {
      view = createPreviewViewport({
        host: el,
        theme: true,
        grid: {
          size: 64,
          divisions: 32,
          color: 0x46515b,
          centerColor: 0x282f36,
        },
        lit: !settings.current.unlit,
        renderMode: "demand",
        controls: { enableDamping: true },
        orientation: { direction: -1, label: "玩家正前方（−Z）" },
        onBeforeRender: () => beforeRender(),
        onContextLost: () =>
          setError("WebGL 上下文丢失，请刷新页面后重试。"),
      });
    } catch (e) {
      setError(String(e));
      setLoading(false);
      return;
    }
    const { camera, controls, lighting, orientation } = view;
    const group = new THREE.Group();
    view.setObject(group, { frame: false });

    function applyPose() {
      if (!poseController) return;
      const current = settings.current;
      const options = {
        profile: current.profile,
        height: current.height,
        humanoid: current.binding === "humanoid",
        excluded: current.excluded,
      };
      const signature = JSON.stringify(options);
      if (signature === poseSignature) return;
      poseSignature = signature;
      try {
        poseController(options);
        setError("");
      } catch (e) {
        poseController({ profile: null, height: 32, humanoid: false });
        setError(String(e));
      }
    }

    function fit(part = "all", front = false) {
      const box = new THREE.Box3();
      if (part.startsWith("material:")) {
        group.traverse((object) => {
          if (object instanceof THREE.Mesh && object.userData.materialNames?.includes(part.slice(9))) {
            box.union(new THREE.Box3().setFromObject(object));
          }
        });
      } else {
        const object = part === "all" ? group : group.getObjectByName(part);
        if (!object) return;
        box.setFromObject(object);
      }
      if (box.isEmpty()) return;
      view.frameBox(box, front ? "front" : "angle", { resetZoom: true });
    }
    frameRef.current = (part) => fit(part ?? "all", !!previewUrl);
    frontRef.current = () => fit("all", true);

    async function load() {
      if (!session) return;
      setLoading(true);
      setProgress(0);
      try {
        if (viewKind !== "result" || !result) {
          const manager = new THREE.LoadingManager();
          let textureFailed = false;
          manager.onError = () => { textureFailed = true; };
          const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
          const gltf = await loader.loadAsync(previewUrl ?? ("/api/session/" + session.id + "/preview"), (event) => {
            if (!disposed && event.total) setProgress(Math.min(1, event.loaded / event.total));
          });
          if (disposed) {
            disposeObject(gltf.scene);
            return;
          }
          for (const [object, association] of gltf.parser.associations) {
            if (association.nodes !== undefined) {
              object.userData.sourceName = gltf.parser.json.nodes[association.nodes]?.name;
            }
          }
          const maps = new Set<THREE.Texture>();
          gltf.scene.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              if (material.map?.image) maps.add(material.map);
            }
          });
          setTextures(maps.size);
          if (textureFailed) setTextureWarning('部分纹理未能加载，请检查模型的贴图文件。');
          group.add(gltf.scene);
          poseController = createPosePreview(group);
          partStates = collectPartMeshes(group, settings.current.parts ?? []);
        } else {
          const [file, texture] = await Promise.all([
            api("/api/job/" + result.id + "/geometry"),
            new THREE.TextureLoader().loadAsync("/api/job/" + result.id + "/texture"),
          ]);
          if (disposed) {
            texture.dispose();
            return;
          }
          const preview = buildPolyMeshPreview(file as BedrockGeometryFile, "", {
            identifier: "geometry.skin0",
            groupByBone: true,
            mirrorX: true,
            texture,
            side: THREE.FrontSide,
            alphaTest: 0.5,
            transparent: false,
            roughness: 1,
          });
          group.add(preview.object);
        }
        group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const old = Array.isArray(object.material) ? object.material : [object.material];
          old.forEach(preparePreviewMaterial);
          object.userData.materialNames = old.map((material) => material.name);
          object.userData.original = old;
          object.userData.flat = old.map((material) => new THREE.MeshBasicMaterial({
            name: material.name,
            map: (material as any).map,
            color: (material as any).color,
            opacity: material.opacity,
            transparent: material.transparent,
            side: material.side,
            alphaTest: material.alphaTest,
            depthWrite: material.depthWrite,
            depthTest: material.depthTest,
          }));
        });
        applyPose();
        view.setLit(!settings.current.unlit, { invalidate: false });
        lighting.fit(group);
        orientation?.fit(group);
        const saved = cameraState.current;
        if (saved?.sessionId === session.id) {
          restoreCameraView(saved, camera, controls);
        } else {
          fit("all", !!previewUrl);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) {
          setProgress(1);
          setLoading(false);
          invalidate.current?.();
        }
      }
    }
    void load();

    const ray = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 4) return;
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const hits = ray
        .intersectObject(group, true)
        .filter((intersection) => intersection.object.visible);
      const hit = hits[0];
      if (!hit) return;
      const names: string[] = [];
      const tolerance = Math.max(0.001, hit.distance * 0.02);
      for (const intersection of hits) {
        if (intersection.distance > hit.distance + tolerance) break;
        const object = intersection.object;
        const list = object.userData.materialNames as string[] | undefined;
        if (!list?.length) continue;
        const index = intersection.face?.materialIndex;
        const name = index !== undefined ? list[index] ?? list[0] : list[0];
        if (name && !names.includes(name)) names.push(name);
      }
      if (!names.length) return;
      const current = settings.current;
      const currentMode = current.mode;
      if (currentMode !== "result" && names.length > 1 && current.onSelectCandidates) {
        current.onSelectCandidates(names);
        return;
      }
      current.onSelect(currentMode !== "result" ? names[0]! : hit.object.name);
    };
    view.renderer.domElement.addEventListener("pointerdown", pointerDown);
    view.renderer.domElement.addEventListener("pointerup", pointerUp);

    beforeRender = () => {
      if (!modelDirty) return;
      modelDirty = false;
      applyPose();
      const current = settings.current;
      const partStateByMesh = new Map(partStates.map((state) => [state.mesh, state]));
      const selectedPartMapped = current.selectedPart &&
        partStates.some((state) =>
          [...state.partByGroup.values()].some((part) => part.id === current.selectedPart),
        )
        ? current.selectedPart
        : null;
      const keepPart = (id: string) =>
        selectedPartMapped ? id === selectedPartMapped : current.includedParts.has(id);
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const state = partStateByMesh.get(object);
        const partShown = state ? applyPartMeshState(state, keepPart) : true;
        const materialShown = current.mode !== "result"
          ? current.solo !== null
            ? object.userData.materialNames?.includes(current.solo)
            : !object.userData.materialNames?.some((name: string) => current.excluded.includes(name))
          : current.focus === "all" || object.name === current.focus;
        object.visible = !!materialShown && partShown;
        const materials = current.unlit ? object.userData.flat : object.userData.original;
        if (materials) {
          object.material = materials.length === 1 ? materials[0] : materials;
          for (const material of materials) material.wireframe = current.wire;
        }
      });
      // Lighting follows the posed bounds; unlit mode still shows the flat
      // materials, so the rig just swaps to its ambient fill.
      view.setLit(!current.unlit, { invalidate: false });
      lighting.fit(group);
      orientation?.fit(group);
    };

    invalidate.current = () => {
      modelDirty = true;
      view.invalidate();
    };
    view.invalidate();

    return () => {
      disposed = true;
      setLoading(false);
      cameraState.current = {
        sessionId: session?.id ?? "",
        ...captureCameraView(camera.position, controls.target, camera.up, camera.zoom),
      };
      invalidate.current = null;
      view.renderer.domElement.removeEventListener("pointerdown", pointerDown);
      view.renderer.domElement.removeEventListener("pointerup", pointerUp);
      view.dispose();
      disposeObject(group);
    };
  }, [previewUrl, session?.id, viewKind === "result" ? result?.id : undefined, viewKind]);

  return (
    <div className="viewport" ref={host} data-preview-state={loading?"loading":error?"error":"ready"} data-preview-textures={textures}>
      {textureWarning && <div className="viewer-error">{textureWarning}</div>}
      {error && <div className="viewer-error">预览失败：{error}</div>}
      {loading && (
        <div className="viewer-loading">
          {progress >= 1
            ? "正在解析模型…"
            : progress > 0
              ? `正在载入模型 ${Math.round(progress * 100)}%`
              : "正在载入模型…"}
        </div>
      )}
      <div className="view-hint">拖动旋转 · 滚轮缩放 · 右键平移 · 点击选择</div>
      <div className="orientation-hint">正面检查：脸和胸前应朝向绿色箭头</div>
      {onUnlitChange && (
        <ViewLightingButton unlit={unlit} onChange={onUnlitChange} />
      )}
      <div className="view-buttons">
        <button onClick={() => frontRef.current?.()}>正面检查</button>
        <button onClick={() => frameRef.current?.()}>⌖ 全景</button>
      </div>
    </div>
  );
}

function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    node.geometry.dispose();
    const list = [...(node.userData.original ?? []), ...(node.userData.flat ?? []), ...(Array.isArray(node.material) ? node.material : [node.material])];
    for (const material of new Set<THREE.Material>(list)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  textures.forEach((texture) => texture.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

