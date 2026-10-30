import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  buildPolyMeshPreview,
  type PolyMeshPreview,
} from "../shared/poly-mesh-preview";
import {
  createPreviewViewport,
  type PreviewViewport,
} from "../shared/preview-viewport";
import { ViewLightingButton } from "../shared/ViewLightingButton";
import type { Scene } from "./pack-types";

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
  const viewRef = useRef<PreviewViewport | null>(null);
  const fitRef = useRef<{ front: () => void; reset: () => void } | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [unlit, setUnlit] = useState(false);
  const unlitRef = useRef(unlit);
  unlitRef.current = unlit;
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
    setError("");
    let view: PreviewViewport | null = null;
    let preview: PolyMeshPreview | null = null;
    try {
      view = createPreviewViewport({
        host: el,
        theme: true,
        grid: {
          size: 48,
          divisions: 24,
          color: 0x46515b,
          centerColor: 0x282f36,
          y: -0.01,
        },
        lit: !unlitRef.current,
        renderMode: "demand",
        controls: { enablePan: true },
        orientation: { direction: -1, label: "玩家正前方（−Z）" },
        // Pack previews stay framed until the user starts orbiting.
        refitOnResize: "until-user-moves",
      });
      viewRef.current = view;
      preview = buildPolyMeshPreview(scene.geometry, scene.texture, {
        identifier: scene.identifier as `geometry.${string}`,
        groupByBone: true,
        mirrorX: true,
        side: THREE.FrontSide,
        alphaTest: 0.5,
        onTextureLoad: () => view?.invalidate(),
      });
      view.setObject(preview.object);
      fitRef.current = {
        front: () => {
          view?.fit("front");
        },
        reset: () => {
          view?.reset();
        },
      };
    } catch (cause) {
      preview?.dispose();
      view?.dispose();
      viewRef.current = null;
      fitRef.current = null;
      setError(
        cause instanceof Error ? cause.message : "三维预览不可用",
      );
      return;
    }
    return () => {
      viewRef.current = null;
      fitRef.current = null;
      view?.dispose();
      preview?.dispose();
      view = null;
      preview = null;
    };
  }, [scene]);

  const toggleLighting = (next: boolean) => {
    setUnlit(next);
    viewRef.current?.setLit(!next);
  };

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
      {scene?.geometry && !error && (
        <>
          <div className="packs-preview-hint">
            初始视角：游戏正前方（−Z）· 拖动旋转 · 右键平移 · 滚轮缩放
          </div>
          <ViewLightingButton unlit={unlit} onChange={toggleLighting} />
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
