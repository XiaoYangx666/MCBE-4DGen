import {bindViewportAppearance} from "./viewport-appearance";
import { createDemandRender } from "./demand-render";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { decodeGeometryTriangles } from "../../src/geometry-validator";
import type { BedrockGeometryFile } from "../../src/bedrock-types";
import { createPosePreview } from "./pose-preview";
import type { Result, Session } from "./types";
import { api } from "../lib/api";
import { preparePreviewMaterial } from "./preview-material";
import { HoldOriginalButton } from "./HoldOriginalButton";
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
  previewUrl,
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
  profile: any;
  height: number;
  binding: string;
  onSelect: (name: string) => void;
}) {
  const viewKind = mode === "result" && result ? "result" : "source";
  const [compareOriginal, setCompareOriginal] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const poseSettings = useRef({ profile, height, binding });
  poseSettings.current = { profile, height, binding };
  const settings = useRef({ excluded, wire, unlit, focus, solo, mode, compareOriginal, ...poseSettings.current, onSelect });
  settings.current = { excluded, wire, unlit, focus, solo, mode, compareOriginal, ...poseSettings.current, onSelect };
  const frameRef = useRef<((part?: string) => void) | null>(null);
  const frontRef = useRef<(() => void) | null>(null);
  const invalidate = useRef<(() => void) | null>(null);
  useEffect(()=>{invalidate.current?.();},[excluded,wire,unlit,focus,solo,mode,compareOriginal,profile,height,binding]);
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15191e");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x707984, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(20, 40, 30);
    scene.add(light);
    const grid = new THREE.GridHelper(64, 32, 0x46515b, 0x282f36);
    scene.add(grid);
    const forward = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.1, 0), 18, 0xa8dfb8, 3, 1.5);
    scene.add(forward);
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 80;
    const labelContext = labelCanvas.getContext("2d")!;
    labelContext.fillStyle = "#a8dfb8";
    labelContext.font = "32px sans-serif";
    labelContext.textAlign = "center";
    labelContext.fillText("玩家正前方（−Z）", 256, 48);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const directionLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, depthWrite: false }));
    directionLabel.position.set(0, 1, -21);
    directionLabel.scale.set(18, 2.8, 1);
    scene.add(directionLabel);
    const group = new THREE.Group();
    scene.add(group);
    let poseController: ReturnType<typeof createPosePreview> | null = null;
    let poseSignature = "";

    function applyPose() {
      if (!poseController) return;
      const current = settings.current;
      const options = {
        profile: current.compareOriginal ? null : current.profile,
        height: current.height,
        humanoid: !current.compareOriginal && current.binding === "humanoid",
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
      const object = part === "all" ? group : group.children.find((child) => child.name === part);
      const box = new THREE.Box3();
      if (part.startsWith("material:")) {
        group.traverse((object) => {
          if (object instanceof THREE.Mesh && object.userData.materialNames?.includes(part.slice(9))) {
            box.union(new THREE.Box3().setFromObject(object));
          }
        });
      } else {
        if (!object) return;
        box.setFromObject(object);
      }
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      controls.target.copy(center);
      camera.position.copy(center).add(front
        ? new THREE.Vector3(0, 0, -size * 1.65)
        : new THREE.Vector3(size * 0.65, size * 0.25, size * 1.65));
      camera.up.set(0, 1, 0);
      camera.zoom = 1;
      camera.near = Math.max(0.001, size / 1000);
      camera.far = Math.max(100, size * 100);
      camera.updateProjectionMatrix();
      controls.update();
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
        } else {
          const [file, texture] = await Promise.all([
            api("/api/job/" + result.id + "/geometry"),
            new THREE.TextureLoader().loadAsync("/api/job/" + result.id + "/texture"),
          ]);
          if (disposed) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          const triangles = decodeGeometryTriangles(file as BedrockGeometryFile, "geometry.skin0");
          const parts = new Map<string, typeof triangles>();
          for (const triangle of triangles) {
            const name = triangle[0]!.bone;
            const list = parts.get(name) ?? [];
            list.push(triangle);
            parts.set(name, list);
          }
          for (const [name, tris] of parts) {
            const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
            for (const triangle of tris) for (const corner of triangle) {
              positions.push(-corner.position[0], corner.position[1], corner.position[2]);
              normals.push(-corner.normal[0], corner.normal[1], corner.normal[2]);
              uvs.push(...corner.uv);
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
            geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
            const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
              map: texture,
              side: THREE.FrontSide,
              transparent: false,
              alphaTest: 0.5,
              depthWrite: true,
              roughness: 1,
            }));
            mesh.name = name;
            group.add(mesh);
          }
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

    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      invalidate.current?.();
    });
    resize.observe(el);
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
      const hit = ray.intersectObject(group, true).find((intersection) => intersection.object.visible);
      if (hit) {
        const names = hit.object.userData.materialNames;
        const currentMode = settings.current.mode;
        settings.current.onSelect(currentMode !== "result" ? (names?.[0] ?? hit.object.name) : hit.object.name);
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    let modelDirty = true;
    const render = createDemandRender(() => {
      if(modelDirty) {
        modelDirty = false;
        applyPose();
        group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const current = settings.current;
          object.visible = current.mode !== "result"
            ? current.solo !== null
              ? object.userData.materialNames?.includes(current.solo)
              : !object.userData.materialNames?.some((name: string) => current.excluded.includes(name))
            : current.focus === "all" || object.name === current.focus;
          const materials = current.unlit ? object.userData.flat : object.userData.original;
          if (materials) {
            object.material = materials.length === 1 ? materials[0] : materials;
            for (const material of materials) material.wireframe = current.wire;
          }
        });
      }
      const moving = controls.update();
      renderer.render(scene, camera);
      return moving;
    });
    invalidate.current = () => {modelDirty = true;render.request();};
    controls.addEventListener("change",render.request);
    render.request();
    const unbindAppearance=bindViewportAppearance(scene, grid, render.request);
    return () => {
      unbindAppearance();
      disposed = true;
      setLoading(false);
      cameraState.current = {
        sessionId: session?.id ?? "",
        ...captureCameraView(camera.position, controls.target, camera.up, camera.zoom),
      };
      invalidate.current = null;
      controls.removeEventListener("change",render.request);
      render.dispose();
      resize.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      controls.dispose();
      forward.line.geometry.dispose();
      forward.cone.geometry.dispose();
      (forward.line.material as THREE.Material).dispose();
      (forward.cone.material as THREE.Material).dispose();
      directionLabel.material.dispose();
      labelTexture.dispose();
      disposeObject(group);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
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
      <div className="orientation-hint">{compareOriginal && mode === "pose" ? "原始状态对照 · 松开恢复调整" : "正面检查：脸和胸前应朝向绿色箭头"}</div>
      <div className="view-buttons">
        {session && mode === "pose" && <HoldOriginalButton key={session.id} onChange={setCompareOriginal} />}
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

