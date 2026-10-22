import { useEffect, useRef, useState } from "react";
import { api, post } from "../lib/api";
import { Modal } from "../ui/Modal";
import type { Session } from "../workbench/types";
import { errorMessage } from "./model-types";

/** Show the backend's current import stage plus elapsed time. */
function BusyStatus({ label }: { label: string }) {
  const [activity, setActivity] = useState<{
    label: string;
    startedAt: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      api("/api/activity")
        .then((value) => {
          if (!cancelled) setActivity(value.activity ?? null);
        })
        .catch(() => {});
    void poll();
    const poller = setInterval(poll, 600);
    const ticker = setInterval(() => setNow(Date.now()), 500);
    return () => {
      cancelled = true;
      clearInterval(poller);
      clearInterval(ticker);
    };
  }, [label]);
  const stage = activity?.label ?? label;
  const seconds = activity
    ? Math.max(0, Math.round((now - activity.startedAt) / 1000))
    : 0;
  return (
    <p role="status">
      {stage}
      {seconds >= 1 ? `（${seconds} 秒）` : ""}
    </p>
  );
}

export function ImportModelDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (session: Session) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [main, setMain] = useState("");
  const [pending, setPending] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  function acceptImport(
    data: Session | { pending?: string; local?: string; candidates: string[] },
  ) {
    if ("candidates" in data) {
      setCandidates(data.candidates);
      setMain(
        data.candidates.find((candidate) => !/(weapon|闭眼)/i.test(candidate)) ??
          data.candidates[0],
      );
      setPending(data.pending ?? "");
    } else {
      onImported(data);
    }
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    await run("正在导入文件…", async () => {
      const form = new FormData();
      for (const file of Array.from(list)) {
        form.append("files", file);
        form.append("paths", file.webkitRelativePath || file.name);
      }
      acceptImport(await api("/api/upload", { method: "POST", body: form }));
    });
  }

  return (
    <Modal
      title="导入模型"
      label="导入模型"
      className="import-dialog"
      busy={!!busy}
      closeLabel="关闭导入"
      onClose={onClose}
    >
      <p>
        将模型与贴图一起复制到数据目录。支持本机路径、ZIP 或完整模型文件夹。
      </p>
      <label>
        本地 ZIP / 模型 / 文件夹路径
        <input
          aria-label="本地模型路径"
          value={path}
          onChange={(event) => {
            setPath(event.target.value);
            setCandidates([]);
            setPending("");
          }}
          placeholder="E:\\下载\\角色.zip"
        />
      </label>
      <div className="button-row">
        <button
          disabled={!!busy || !path.trim()}
          onClick={() =>
            void run("本地服务器正在导入…", async () =>
              acceptImport(
                await post("/api/local-import", { path: path.trim() }),
              ),
            )
          }
        >
          读取本地路径
        </button>
        <button disabled={!!busy} onClick={() => files.current?.click()}>
          选择文件
        </button>
        <button disabled={!!busy} onClick={() => folder.current?.click()}>
          选择文件夹
        </button>
      </div>
      <input
        hidden
        multiple
        ref={files}
        type="file"
        accept=".zip,.pmx,.vrm,.glb,.gltf,.obj,.fbx,.dae,.stl,.ply,.png,.jpg,.tga,.bin,.mtl"
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        hidden
        multiple
        ref={folder}
        type="file"
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      {!!candidates.length && (
        <>
          <h3>选择包内模型</h3>
          <div className="pick-list">
            {candidates.map((candidate) => (
              <label key={candidate}>
                <input
                  type="radio"
                  checked={main === candidate}
                  onChange={() => setMain(candidate)}
                />
                <span>{candidate}</span>
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={!!busy || !main}
            onClick={() =>
              void run("正在导入所选模型…", async () =>
                acceptImport(
                  await post(
                    pending ? "/api/upload/select" : "/api/local-import",
                    pending
                      ? { pending, main }
                      : { path: path.trim(), main },
                  ),
                ),
              )
            }
          >
            导入所选模型
          </button>
        </>
      )}
      {busy && <BusyStatus label={busy} />}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
