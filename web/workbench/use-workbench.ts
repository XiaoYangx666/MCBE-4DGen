import { useEffect, useRef, useState } from "react";
import type { HumanoidProfile } from "../../src/humanoid";
import { api, post } from "../lib/api";
import { estimateTriangles } from "./estimate";
import type { Result, Session } from "./types";
import type { TextureMode, TextureTarget } from "../shared/texture-types";
import type { StudioWorkspace } from "../shared/WorkspaceTabs";
import { toServerTextureTarget } from "../shared/texture-target";

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
  const [workspace, setWorkspace] = useState<StudioWorkspace>("model");
  const [mode, setMode] = useState("pose");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [includedParts, setIncludedParts] = useState<Set<string>>(new Set());
  const [textureMode, setTextureMode] = useState<TextureMode>("budget");
  const [textureTarget, setTextureTarget] = useState<TextureTarget>("density");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [materialDeltas, setMaterialDeltas] = useState<Map<string, number>>(new Map());
  const [materialWeights, setMaterialWeights] = useState<
    Record<string, number>
  >({});
  const [selected, setSelected] = useState("");
  const [solo, setSolo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [released, setReleased] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseRef = useRef<() => void>(() => {});
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
  const revisionRef = useRef(0);
  const resultRef = useRef<Result | null>(null);
  const convertRef = useRef<((preview: boolean) => Promise<void>) | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewQueued = useRef(false);
  const previewRunning = useRef(false);
  const previewFailedRevision = useRef(-1);
  const finalQueued = useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  revisionRef.current = revision;
  resultRef.current = result;

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
    setReleased(false);
    // Material-level exclusion was removed: geometry is now decided by parts
    // only. Convert saved exclusions into dropped parts so old projects keep
    // their intent instead of silently applying a hidden filter.
    const legacyExcluded = new Set(saved?.excluded ?? []);
    setExcluded([]);
    const availableParts = (next.parts ?? []).map((part) => part.id);
    const savedParts = saved?.includedParts
      ? saved.includedParts.filter((id) => availableParts.includes(id))
      : [];
    const included = new Set(savedParts.length ? savedParts : availableParts);
    if (legacyExcluded.size) {
      for (const part of next.parts ?? []) {
        if (legacyExcluded.has(part.materialKey)) included.delete(part.id);
      }
    }
    setIncludedParts(included);
    // Allocation is density-only now: legacy/retention saves are migrated.
    setTextureMode("budget");
    setTextureTarget("density");
    setSelectedPart(null);
    setMaterialDeltas(new Map());
    setMaterialWeights(saved?.materialWeights ?? {});
    setRatio(saved?.ratio ?? 0.2);
    setMaxError(saved?.maxError ?? 0.03);
    setHeight(saved?.height ?? 32);
    setMode("pose");
    setFocus("all");
    setSelected("");
    setSolo(null);
    setWorkspace("model");
    setPreviewBusy(false);
    previewQueued.current = false;
    previewRunning.current = false;
    previewFailedRevision.current = -1;
    finalQueued.current = false;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setProfile(loadedProfile);
    setProfileText(JSON.stringify(loadedProfile, null, 2));
    setBinding(saved?.binding ?? (next.profile ? "humanoid" : "static"));
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
    } finally {
      setBusy(false);
    }
  }

  async function runConvert(previewMode: boolean) {
    if (!session) return;
    if (previewMode && (busy || previewRunning.current)) {
      previewQueued.current = true;
      return;
    }
    if (!previewMode && (busy || previewRunning.current)) {
      if (previewRunning.current) {
        finalQueued.current = true;
      }
      return;
    }
    const token = ++run.current;
    const before = resultRef.current;
    const runRevision = revisionRef.current;
    if (previewMode) {
      previewRunning.current = true;
      setPreviewBusy(true);
    } else {
      setBusy(true);
    }
    setError("");
    try {
      const job = await post("/api/convert", {
        session: session.id,
        excluded,
        includedParts: [...includedParts],
        materialWeights,
        textureMode,
        textureTarget: toServerTextureTarget(textureTarget),
        atlasSharing: textureMode === "budget",
        binding,
        ratio,
        maxError,
        height,
        profile,
        preview: previewMode,
      });
      for (;;) {
        const state = await api("/api/job/" + job.id);
        if (token !== run.current) return;
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
          const nextResult = { id: job.id, ...state.result, cached: !!job.cached };
          setResult(nextResult);
          resultRef.current = nextResult;
          setResultRevision(runRevision);
          previewFailedRevision.current = -1;
          if (!previewMode) {
            setSavedRevision(runRevision);
            setMode("result");
            setFocus("all");
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (reason) {
      if (token === run.current) {
        if (previewMode) previewFailedRevision.current = runRevision;
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (token === run.current) {
        setBusy(false);
        setPreviewBusy(false);
      }
      previewRunning.current = false;
      if (!previewMode) finalQueued.current = false;
      if (previewMode && finalQueued.current) {
        finalQueued.current = false;
        previewQueued.current = false;
        if (token === run.current)
          window.setTimeout(() => void convertRef.current?.(false), 0);
      } else if (previewMode && previewQueued.current) {
        previewQueued.current = false;
        if (token === run.current)
          window.setTimeout(() => void convertRef.current?.(true), 0);
      }
    }
  }

  convertRef.current = runConvert;

  function preview() {
    void runConvert(true);
  }

  /** Reuse a completed preview's exact atlas/geometry for the final pack. */
  async function finalizeResult() {
    if (!result?.preview || stale) {
      void runConvert(false);
      return;
    }
    const token = ++run.current;
    setBusy(true);
    setError("");
    try {
      await post(`/api/job/${result.id}/finalize`, {});
      const state = await api("/api/job/" + result.id);
      if (token !== run.current) return;
      const nextResult = { id: result.id, ...state.result, cached: false };
      setResult(nextResult);
      resultRef.current = nextResult;
      setResultRevision(revisionRef.current);
      setSavedRevision(revisionRef.current);
    } catch (reason) {
      if (token === run.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (token === run.current) setBusy(false);
    }
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
    textureTarget: toServerTextureTarget(textureTarget),
    atlasSharing: textureMode === "budget",
  };
  const dirty = !!session && revision !== savedRevision;
  const stale = !!result && revision !== resultRevision;

  // Editing workspaces keep the preview in sync with the latest settings
  // without making the user press "generate": the model page and the texture
  // page both recalculate after a short debounce. The debounce is followed by a
  // latest-wins queue, so old jobs cannot overwrite newer results.
  useEffect(() => {
    if (workspace === "export" || !session) return;
    if (busy || previewBusy) return;
    if (previewFailedRevision.current === revision) return;
    if (result && revision === resultRevision) return;
    if (!includedParts.size) return;
    if (!session.materials.some((material) => !excluded.includes(material.key)))
      return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      void convertRef.current?.(true);
    }, 650);
    return () => {
      if (previewTimer.current) {
        clearTimeout(previewTimer.current);
        previewTimer.current = null;
      }
    };
  }, [workspace, session, busy, previewBusy, result, revision, resultRevision, includedParts, excluded]);

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
    if (!session?.modelId) return false;
    let saved = false;
    await action(async () => {
      await post("/api/models/update", { id: session.modelId, settings });
      setSavedRevision(revision);
      saved = true;
    });
    return saved;
  }

  /**
   * Idle sessions hold the imported model, the prepared geometry and the
   * preview job in the backend. After a long pause the settings are saved and
   * those buffers are dropped; opening the model again restores everything.
   */
  async function releaseIdle() {
    if (!session || busy || previewBusy) return;
    try {
      if (dirty && !(await saveSettings())) return;
      await api(`/api/session/${session.id}`, { method: "DELETE" });
    } catch {
      // The session may already have been replaced; clearing the client copy
      // is still the right thing to do.
    }
    setSession(null);
    setResult(null);
    resultRef.current = null;
    setPreviewBusy(false);
    setWorkspace("model");
    setSelected("");
    setSolo(null);
    setReleased(true);
  }
  releaseRef.current = () => {
    void releaseIdle();
  };

  useEffect(() => {
    if (!session) return;
    const schedule = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => releaseRef.current(), 20 * 60 * 1000);
    };
    schedule();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events)
      window.addEventListener(event, schedule, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, schedule);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = null;
    };
  }, [session?.id, busy, previewBusy]);

  return {
    session,
    result,
    workspace,
    setWorkspace,
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
    materialDeltas,
    materialWeights,
    setMaterialWeights,
    selected,
    setSelected,
    solo,
    setSolo,
    busy,
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
    preview,
    finalizeResult,
    previewBusy,
    saveSettings,
    estimate,
    dirty,
    stale,
    released,
  };
}
