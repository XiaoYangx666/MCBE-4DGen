import { useEffect, useRef, useState } from "react";
import type { HumanoidProfile } from "../../src/humanoid";
import { api, post } from "../lib/api";
import { estimateTriangles } from "./estimate";
import type { Result, Session } from "./types";
import type { TextureMode, TextureTarget } from "../shared/TextureStudio";

export type Workbench = ReturnType<typeof useWorkbench>;

/**
 * Owns the editing session shared by the workbench and the model library.
 * The model library starts a session through `accept`, so this state must live
 * above the page switch rather than inside the workbench page itself.
 */
export function useWorkbench() {
  const [savedRevision, setSavedRevision] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [mode, setMode] = useState("pose");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [includedParts, setIncludedParts] = useState<Set<string>>(new Set());
  const [textureMode, setTextureMode] = useState<TextureMode>("legacy");
  const [textureTarget, setTextureTarget] = useState<TextureTarget>("retention");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [showKeptParts, setShowKeptParts] = useState(true);
  const [materialDeltas, setMaterialDeltas] = useState<Map<string, number>>(new Map());
  const [materialWeights, setMaterialWeights] = useState<
    Record<string, number>
  >({});
  const [selected, setSelected] = useState("");
  const [solo, setSolo] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("从模型管理打开模型，开始调整。");
  const [error, setError] = useState("");
  const [wire, setWire] = useState(false);
  const [unlit, setUnlit] = useState(true);
  const [focus, setFocus] = useState("all");
  const [ratio, setRatio] = useState(0.2);
  const [maxError, setMaxError] = useState(0.03);
  const [height, setHeight] = useState(32);
  const [binding, setBinding] = useState("humanoid");
  const [profile, setProfile] = useState<HumanoidProfile>({
    rotationYDegrees: 0,
    shoulderOutset: 0,
    armSpreadDegrees: 0,
  });
  const [profileText, setProfileText] = useState("");
  const [revision, setRevision] = useState(0);
  const [resultRevision, setResultRevision] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed((Date.now() - started) / 1000),
      250,
    );
    return () => clearInterval(timer);
  }, [busy]);

  function changed() {
    setRevision((value) => value + 1);
  }

  function accept(next: Session, fromVersion = false) {
    const saved = next.settings;
    const loadedProfile =
      saved?.profile ??
      (next.profile
        ? { ...next.profile, shoulderOutset: 0 }
        : { rotationYDegrees: 0, shoulderOutset: 0, armSpreadDegrees: 0 });
    setSession(next);
    setResult(null);
    setExcluded(saved?.excluded ?? []);
    const availableParts = (next.parts ?? []).map((part) => part.id);
    const savedParts = saved?.includedParts
      ? saved.includedParts.filter((id) => availableParts.includes(id))
      : [];
    setIncludedParts(
      new Set(savedParts.length ? savedParts : availableParts),
    );
    setTextureMode(saved?.textureMode ?? "legacy");
    setTextureTarget(saved?.textureTarget ?? "retention");
    setSelectedPart(null);
    setShowKeptParts(true);
    setMaterialDeltas(new Map());
    setMaterialWeights(saved?.materialWeights ?? {});
    setRatio(saved?.ratio ?? 0.2);
    setMaxError(saved?.maxError ?? 0.03);
    setHeight(saved?.height ?? 32);
    setMode("pose");
    setFocus("all");
    setSelected("");
    setSolo(null);
    setProfile(loadedProfile);
    setProfileText(JSON.stringify(loadedProfile, null, 2));
    setBinding(saved?.binding ?? (next.profile ? "humanoid" : "static"));
    setMessage("模型已加载，先检查材质和姿势。");
    setRevision(0);
    setSavedRevision(fromVersion ? -1 : 0);
    location.hash = "#/workbench";
  }

  async function action(run: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await run();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMessage("操作未完成");
    } finally {
      setBusy(false);
    }
  }

  function convert() {
    void action(async () => {
      if (!session) return;
      const token = ++run.current;
      const before = result;
      setMessage("提交转换任务…");
      const job = await post("/api/convert", {
        session: session.id,
        excluded,
        includedParts: [...includedParts],
        materialWeights,
        textureMode,
        textureTarget,
        atlasSharing: textureMode === "budget",
        binding,
        ratio,
        maxError,
        height,
        profile,
      });
      for (;;) {
        const state = await api("/api/job/" + job.id);
        if (token !== run.current) return;
        setMessage(state.message);
        if (state.status === "error") throw Error(state.message);
        if (state.status === "done") {
          const previous = new Map(
            (before?.details?.texture?.materials ?? []).map((material) => [
              material.key ?? material.name,
              material.pixels,
            ]),
          );
          const nextDeltas = new Map<string, number>();
          for (const material of state.result.details?.texture?.materials ?? []) {
            const key = material.key ?? material.name;
            if (previous.has(key))
              nextDeltas.set(key, material.pixels - previous.get(key)!);
          }
          setMaterialDeltas(nextDeltas);
          setResult({ id: job.id, ...state.result, cached: !!job.cached });
          setResultRevision(revision);
          setSavedRevision(revision);
          setMode("result");
          setFocus("all");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });
  }

  function updateProfile(key: string, value: number) {
    setMode("pose");
    setProfile((current) => ({ ...current, [key]: value }));
    changed();
  }

  const estimate = estimateTriangles(
    session?.materials ?? [],
    excluded,
    ratio,
    binding,
    session?.parts ?? [],
    includedParts,
  );
  const settings = {
    binding,
    ratio,
    maxError,
    height,
    excluded,
    materialWeights,
    profile,
    includedParts: [...includedParts],
    textureMode,
    textureTarget,
    atlasSharing: textureMode === "budget",
  };
  const dirty = !!session && revision !== savedRevision;
  const stale = !!result && revision !== resultRevision;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function saveSettings() {
    if (!session?.modelId) return;
    await action(async () => {
      await post("/api/models/update", { id: session.modelId, settings });
      setSavedRevision(revision);
      setMessage("编辑配置已保存");
    });
  }

  return {
    session,
    result,
    mode,
    setMode,
    excluded,
    setExcluded,
    includedParts,
    setIncludedParts,
    textureMode,
    setTextureMode,
    textureTarget,
    setTextureTarget,
    selectedPart,
    setSelectedPart,
    showKeptParts,
    setShowKeptParts,
    materialDeltas,
    materialWeights,
    setMaterialWeights,
    selected,
    setSelected,
    solo,
    setSolo,
    elapsed,
    busy,
    message,
    error,
    setError,
    wire,
    setWire,
    unlit,
    setUnlit,
    focus,
    setFocus,
    ratio,
    setRatio,
    maxError,
    setMaxError,
    height,
    setHeight,
    binding,
    setBinding,
    profile,
    setProfile,
    profileText,
    setProfileText,
    updateProfile,
    changed,
    accept,
    convert,
    saveSettings,
    estimate,
    dirty,
    stale,
  };
}
