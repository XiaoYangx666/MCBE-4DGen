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
import { prepareSourcePreviewMaterials } from "./preview-material";
import {
  createPreviewViewport,
  type PreviewViewport,
} from "../shared/preview-viewport";
import { ViewLightingButton } from "../shared/ViewLightingButton";

/** Loaded source/result object kept for instant source/result switching. */
type CachedContent = {
  object: THREE.Object3D;
  pose: ReturnType<typeof createPosePreview> | null;
  textures: number;
  warning: string;
};

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
  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  useEffect(()=>{invalidate.current?.();},[excluded,wire,unlit,focus,solo,mode,profile,height,binding,parts,includedParts,selectedPart]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [textures, setTextures] = useState(0);
  const [textureWarning, setTextureWarning] = useState("");

  // The viewport and the wrapper group live across source/result switches so the
  // camera pose is never saved, restored or reset. Only the attached content
  // changes.
  const viewRef = useRef<PreviewViewport | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const contentRef = useRef<THREE.Object3D | null>(null);
  const poseRef = useRef<ReturnType<typeof createPosePreview> | null>(null);
  const poseSignature = useRef("");
  const partStatesRef = useRef<ReturnType<typeof collectPartMeshes>>([]);
  const dirtyRef = useRef(true);
  const loadToken = useRef(0);
  const viewedSession = useRef<string | null>(null);
  const applyPoseRef = useRef<() => void>(() => {});
  /** Source + recent result objects, reused when switching modes. */
  const cacheRef = useRef(new Map<string, CachedContent>());
  const cacheSession = useRef<string | null>(null);

  function trimCache(keepKey: string) {
    // Keep the source plus the last two results; the current job only keeps two
    // result buffers anyway.
    while (cacheRef.current.size > 3) {
      const oldest = cacheRef.current.keys().next().value;
      if (!oldest || oldest === keepKey) break;
      const entry = cacheRef.current.get(oldest)!;
      cacheRef.current.delete(oldest);
      if (entry.object !== contentRef.current) disposeObject(entry.object);
    }
  }

  function fit(part = "all", front = false) {
    const view = viewRef.current, group = groupRef.current;
    if (!view || !group) return;
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
  frameRef.current = (part) => fit(part ?? "all", !!previewUrlRef.current);
  frontRef.current = () => fit("all", true);

  applyPoseRef.current = () => {
    const poseController = poseRef.current;
    if (!poseController) return;
    const current = settings.current;
    const options = {
      profile: current.profile,
      height: current.height,
      humanoid: current.binding === "humanoid",
      excluded: current.excluded,
    };
    const signature = JSON.stringify(options);
    if (signature === poseSignature.current) return;
    poseSignature.current = signature;
    try {
      poseController(options);
      setError("");
    } catch (e) {
      poseController({ profile: null, height: 32, humanoid: false });
      setError(String(e));
    }
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let view: PreviewViewport;
    const beforeRender = () => {
      const currentView = viewRef.current, group = groupRef.current;
      if (!currentView || !group || !dirtyRef.current) return;
      dirtyRef.current = false;
      applyPoseRef.current();
      const current = settings.current;
      const partStateByMesh = new Map(partStatesRef.current.map((state) => [state.mesh, state]));
      const selectedPartMapped = current.selectedPart &&
        partStatesRef.current.some((state) =>
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
      currentView.setLit(!current.unlit, { invalidate: false });
      currentView.lighting.fit(group);
      currentView.orientation?.fit(group);
    };

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
        onBeforeRender: beforeRender,
        releaseContextOnDispose: true,
        onContextLost: () =>
          setError("WebGL 上下文丢失，请刷新页面后重试。"),
      });
    } catch (e) {
      setError(String(e));
      setLoading(false);
      return;
    }
    const group = new THREE.Group();
    viewRef.current = view;
    groupRef.current = group;
    view.setObject(group, { frame: false });

    const ray = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pointerUp = (event: PointerEvent) => {
      const currentView = viewRef.current, currentGroup = groupRef.current;
      if (!currentView || !currentGroup || event.button !== 0) return;
      if (Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 4) return;
      const rect = view.renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ), currentView.camera);
      const hits = ray
        .intersectObject(currentGroup, true)
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

    invalidate.current = () => {
      dirtyRef.current = true;
      viewRef.current?.invalidate();
    };
    view.invalidate();

    return () => {
      loadToken.current++;
      setLoading(false);
      invalidate.current = null;
      view.renderer.domElement.removeEventListener("pointerdown", pointerDown);
      view.renderer.domElement.removeEventListener("pointerup", pointerUp);
      const content = contentRef.current;
      if (content) {
        group.remove(content);
        contentRef.current = null;
      }
      for (const entry of cacheRef.current.values()) disposeObject(entry.object);
      cacheRef.current.clear();
      cacheSession.current = null;
      poseRef.current = null;
      partStatesRef.current = [];
      viewedSession.current = null;
      view.dispose();
      viewRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current, group = groupRef.current;
    if (!view || !group || !session) return;
    let cancelled = false;
    const token = ++loadToken.current;
    setError("");
    setTextures(0);
    setTextureWarning("");
    setLoading(true);
    setProgress(0);
    const run = async () => {
      const previous = contentRef.current;
      if (previous) {
        group.remove(previous);
        contentRef.current = null;
      }
      // A new model invalidates every cached object from the old session.
      if (cacheSession.current !== session.id) {
        for (const entry of cacheRef.current.values()) disposeObject(entry.object);
        cacheRef.current.clear();
        cacheSession.current = session.id;
      }
      // The source pose scales/positions this wrapper; the exported poly_mesh
      // is already in block units. Reset before attaching the next content.
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.scale.setScalar(1);
      poseRef.current = null;
      poseSignature.current = "";
      partStatesRef.current = [];
      const key = viewKind === "result" && result
        ? `result:${result.id}`
        : `source:${session.id}:${previewUrl ?? "session"}`;
      try {
        const cached = cacheRef.current.get(key);
        let object: THREE.Object3D;
        let textureCount = 0;
        let warning = "";
        if (cached) {
          object = cached.object;
          textureCount = cached.textures;
          warning = cached.warning;
        } else if (viewKind !== "result" || !result) {
          const manager = new THREE.LoadingManager();
          let textureFailed = false;
          manager.onError = () => { textureFailed = true; };
          const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
          const gltf = await loader.loadAsync(previewUrl ?? ("/api/session/" + session.id + "/preview"), (event) => {
            if (!cancelled && token === loadToken.current && event.total)
              setProgress(Math.min(1, event.loaded / event.total));
          });
          object = gltf.scene;
          for (const [child, association] of gltf.parser.associations) {
            if (association.nodes !== undefined) {
              child.userData.sourceName = gltf.parser.json.nodes?.[association.nodes]?.name;
            }
          }
          const maps = new Set<THREE.Texture>();
          object.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
              if (material.map?.image) maps.add(material.map);
            }
          });
          textureCount = maps.size;
          if (textureFailed) warning = "部分纹理未能加载，请检查模型的贴图文件。";
        } else {
          const [file, texture] = await Promise.all([
            api("/api/job/" + result.id + "/geometry"),
            new THREE.TextureLoader().loadAsync("/api/job/" + result.id + "/texture"),
          ]);
          const preview = buildPolyMeshPreview(file as BedrockGeometryFile, "", {
            identifier: "geometry.skin0",
            groupByBone: true,
            mirrorX: true,
            texture,
            // Backfaces are already duplicated by the exporter; FrontSide
            // avoids blending translucent parts twice.
            side: THREE.FrontSide,
            alphaTest: 0.01,
            transparent: true,
            roughness: 1,
          });
          object = preview.object;
        }
        if (cancelled || token !== loadToken.current) {
          if (!cached) disposeObject(object);
          return;
        }
        if (viewKind !== "result" && session.format === "ysm") {
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
              const map = (material as THREE.MeshStandardMaterial).map;
              if (!map) continue;
              map.magFilter = THREE.NearestFilter;
              map.minFilter = THREE.NearestFilter;
              map.generateMipmaps = false;
              map.needsUpdate = true;
            }
          });
        }
        group.add(object);
        contentRef.current = object;
        if (viewKind !== "result" || !result) {
          if (cached?.pose) poseRef.current = cached.pose;
          else {
            const pose = createPosePreview(group);
            poseRef.current = pose;
            cacheRef.current.set(key, { object, pose, textures: textureCount, warning });
          }
        } else if (!cached) {
          cacheRef.current.set(key, { object, pose: null, textures: textureCount, warning });
        }
        trimCache(key);
        partStatesRef.current = collectPartMeshes(group, settings.current.parts ?? []);
        if (!cached) group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const old = Array.isArray(child.material) ? child.material : [child.material];
          prepareSourcePreviewMaterials(old, viewKind !== "result" || !result);
          child.userData.materialNames = old.map((material) => material.name);
          child.userData.original = old;
          child.userData.flat = old.map((material) => new THREE.MeshBasicMaterial({
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
        setTextures(textureCount);
        if (warning) setTextureWarning(warning);
        applyPoseRef.current();
        view.setLit(!settings.current.unlit, { invalidate: false });
        view.lighting.fit(group);
        view.orientation?.fit(group);
        const newSession = viewedSession.current !== session.id;
        viewedSession.current = session.id;
        // Only frame the first content of a session. Switching source/result or
        // regenerating must keep the camera exactly where the user left it.
        if (newSession) fit("all", !!previewUrlRef.current);
        dirtyRef.current = true;
        view.invalidate();
      } catch (e) {
        if (!cancelled && token === loadToken.current) setError(String(e));
      } finally {
        if (!cancelled && token === loadToken.current) {
          setProgress(1);
          setLoading(false);
          view.invalidate();
        }
      }
    };
    void run();
    return () => { cancelled = true; };
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
