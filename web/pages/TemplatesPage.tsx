import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LibraryPack } from "../packs/pack-types";
import { PackPreview } from "../packs/PackPreview";
import { SaveSkinDialog } from "../packs/SaveSkinDialog";

type TemplateKey = "image";

export function TemplatesPage() {
  const packQuery = new URLSearchParams(location.hash.split("?")[1]).get("pack");
  const [template, setTemplate] = useState<TemplateKey | null>(
    packQuery ? "image" : null,
  );
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState("图片皮肤"),
    [heightText, setHeightText] = useState("32");
  const [result, setResult] = useState<{
    id: string;
    name: string;
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [save, setSave] = useState(false),
    [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState("");
  const heightValue = Number(heightText);
  const heightValid =
    heightText.trim() !== "" &&
    Number.isFinite(heightValue) &&
    heightValue >= 1 &&
    heightValue <= 128;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(location.hash.split("?")[1]).get("pack");
    if (!id) return;
    setTemplate("image");
    setBusy(true);
    void (async () => {
      const packs = await api("/api/packs"),
        pack = packs.library?.find((pack: LibraryPack) => pack.id === id);
      if (!pack || pack.meta?.template !== "image")
        throw Error("找不到图片模板的源文件");
      const response = await fetch(
        "/api/packs/" + encodeURIComponent(id) + "/source-image",
      );
      if (!response.ok) throw Error("源图片读取失败");
      const file = new File([await response.blob()], pack.name + ".image", {
        type:
          response.headers.get("Content-Type") ?? "application/octet-stream",
      });
      if (active) {
        setFile(file);
        setName(pack.name);
        setHeightText(String(pack.meta.height ?? 32));
        setPreview(URL.createObjectURL(file));
        setDirty(true);
      }
    })()
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function generate() {
    if (!file || !heightValid) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("name", name.trim());
      form.append("height", String(heightValue));
      setResult(
        await api("/api/templates/image", { method: "POST", body: form }),
      );
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!template)
    return (
      <main className="page-content templates-page">
        <div className="template-gallery">
          <p className="template-gallery-lead">选择一种模板开始制作。</p>
          <div className="template-grid">
            <button
              type="button"
              className="template-card"
              onClick={() => setTemplate("image")}
            >
              <span className="template-thumb" aria-hidden="true">
                <svg viewBox="0 0 64 64">
                  <rect x="12" y="10" width="40" height="44" rx="4" />
                  <circle cx="24" cy="22" r="3.5" />
                  <path d="M15 45l10-10 7 7 6-6 11 11" />
                </svg>
              </span>
              <span className="template-card-body">
                <b>图片 · 平面皮肤</b>
                <small>
                  把立绘、表情包或透明 PNG 做成双面平面皮肤，不需要三维模型。
                </small>
              </span>
              <span className="template-card-foot">
                <span>1 张图片 · 4 三角面</span>
                <span>开始制作 →</span>
              </span>
            </button>
          </div>
          <p className="template-gallery-note">更多模板会陆续加入。</p>
        </div>
      </main>
    );
  return (
    <main className="page-content templates-page">
      <div className="template-backbar">
        <button
          type="button"
          onClick={() => {
            setTemplate(null);
            location.hash = "#/templates";
          }}
        >
          ← 所有模板
        </button>
        <span>图片 · 平面皮肤</span>
      </div>
      <div className="template-layout">
        <section className="template-settings">
          <div className="template-icon">▧</div>
          <h2>图片 · 平面皮肤</h2>
          <p>
            完整图片贴到竖直平面，两面可见。保留比例和透明背景，跟随身体移动。
          </p>
          <fieldset disabled={busy}>
            <label>
              选择图片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,image/avif"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setDirty(true);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(f ? URL.createObjectURL(f) : "");
                  if (f) setName(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </label>
            {preview && (
              <img
                className="image-source-preview"
                src={preview}
                alt="源图片"
              />
            )}
            <label>
              皮肤名称
              <input
                maxLength={120}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <label>
              平面高度
              <input
                type="number"
                min={1}
                max={128}
                value={heightText}
                aria-invalid={!heightValid}
                onChange={(e) => {
                  setHeightText(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            {!heightValid && (
              <p className="field-error">平面高度需为 1–128</p>
            )}
            <p className="help">
              默认 32，约为玩家身高。宽度按图片比例计算。输出贴图为 128 ×
              128；动画图片使用第一帧。
            </p>
            <button
              className="primary"
              disabled={!file || !name.trim() || !heightValid}
              onClick={() => void generate()}
            >
              {busy ? "正在生成…" : result ? "重新生成" : "生成图片皮肤"}
            </button>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="template-result">
          <div className="detail-heading">
            <div>
              <h2>{result?.name ?? "成品预览"}</h2>
              <p>
                {result
                  ? `${result.width.toFixed(1)} × ${result.height} · 4 三角面 · 双面`
                  : "导入图片并生成后，在这里检查平面方向与透明区域。"}
              </p>
            </div>
          </div>
          {result ? (
            <>
              <PackPreview
                packId={result.id}
                baseUrl={"/api/job/" + result.id}
              />
              <div className="template-result-actions">
                {dirty && <p role="status">图片或参数已修改，请重新生成。</p>}
                <button
                  className="primary"
                  disabled={busy || dirty}
                  onClick={() => setSave(true)}
                >
                  保存皮肤…
                </button>
                <a
                  className="button-link"
                  href={"/api/job/" + result.id + "/download"}
                  download
                >
                  下载{dirty ? "上次结果 " : ""}.zip
                </a>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>一张图片，一张平面皮肤</h2>
              <p>适合立绘、表情包、标志与透明 PNG。</p>
            </div>
          )}
        </section>
      </div>
      {save && result && !dirty && (
        <SaveSkinDialog
          jobId={result.id}
          modelName={result.name}
          onClose={() => setSave(false)}
          onSaved={(id) => {
            setSave(false);
            location.hash = "#/packs?pack=" + encodeURIComponent(id);
          }}
        />
      )}
    </main>
  );
}
