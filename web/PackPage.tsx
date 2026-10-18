import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { decodeGeometryTriangles } from "../src/geometry-validator";
import type { BedrockGeometryFile } from "../src/bedrock-types";
import { api, post } from "./api";

type PackMeta = {
  importWarnings?: string[];
  versionName?: string;
  modelId?: string;
  materialWeights?: Record<string, number>;
  source?: string;
  binding?: string;
  ratio?: number;
  maxError?: number;
  height?: number;
  excluded?: string[];
  profile?: unknown;
};
type PackStats = {
  triangles: number;
  vertices: number;
  bones: number;
  texture: { width: number; height: number } | null;
  bytes: number;
};
export type LibraryPack = {
  id: string;
  revision: string;
  name: string;
  skins: number;
  imported: string;
  warnings: string[];
  removed?: boolean;
  draft?: boolean;
  meta?: PackMeta;
  stats?: PackStats;
};
type SlotStatus = {
  slot: string;
  target: string;
  exists: boolean;
  managed: boolean;
  skins: number | null;
  active: { id: string; revision: string }[];
  presetSources?: string[];
  changedOutsideManager: boolean | null;
  pending: unknown;
  originalBackup: string | null;
};
export type Packs = {
  configured: boolean;
  configPath?: string;
  error?: string;
  root?: string;
  stateDir?: string;
  slots?: Record<string, { manifestFormat: number }>;
  status?: SlotStatus[];
  library?: LibraryPack[];
};
type Scene = {
  name: string;
  identifier: string;
  geometry: BedrockGeometryFile | null;
  skins: number;
  texture: string;
};

const SLOT_LABELS: Record<string, string> = { custom: "自定义", persona: "Persona" };
const slotLabel = (slot: string) =>
  SLOT_LABELS[slot] ? `${SLOT_LABELS[slot]}（${slot}）` : slot;
/** Full-size rotatable preview of a library pack's first skin. */
export function PackPreview({ packId, skinIndex = 0, revision = "", baseUrl }: { packId: string; skinIndex?: number; revision?: string; baseUrl?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ front: () => void; reset: () => void } | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setError("");
    fetch(`${baseUrl ?? `/api/packs/${encodeURIComponent(packId)}`}/scene?skin=${skinIndex}&revision=${encodeURIComponent(revision)}`)
      .then(async (response) => {
        const body = (await response.json()) as Scene & { error?: string };
        if (!response.ok) throw Error(body.error ?? "预览加载失败");
        if (!cancelled) setScene(body);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [packId, skinIndex, revision, baseUrl]);

  useEffect(() => {
    const el = host.current;
    if (!el || !scene?.geometry) return;
    let disposed = false;
    let frame = 0;
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

    const texture = new THREE.TextureLoader().load(scene.texture);
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
      const positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [];
      for (const triangle of list)
        for (const corner of triangle) {
          positions.push(-corner.position[0], corner.position[1], corner.position[2]);
          normals.push(-corner.normal[0], corner.normal[1], corner.normal[2]);
          uvs.push(...corner.uv);
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
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
      const width = el?.clientWidth || 1,
        height = el?.clientHeight || 1;
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
      const width = el.clientWidth || 1,
        height = el.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (!userMoved) view(currentView);
    });
    resize.observe(el);
    function animate() {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(world, camera);
    }
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
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
      {!scene && !error && <div className="packs-preview-hint">正在加载预览…</div>}
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

type SkinItem = { index: number; name: string; geometry: string; texture: string };
type Contents = { id: string; name: string; revision: string; skins: SkinItem[] };
const gameSlot = (slot: string) => ({ custom: '自定义皮肤', persona: '角色皮肤' }[slot] ?? slot);

type PackRow = { key: string; id: string; name: string; skins: number; revision: string; preset: boolean; pack?: LibraryPack };

export function PackPage() {
  const [data, setData] = useState<Packs | null>(null);
  const [selected, setSelected] = useState(new URLSearchParams(location.hash.split('?')[1]).get('pack') ?? '@custom');
  const [models, setModels] = useState<{id:string; name:string; path:string; packIds?:string[]}[]>([]);
  const [linkTarget, setLinkTarget] = useState('');
  const [query, setQuery] = useState('');
  const [contents, setContents] = useState<Contents | null>(null);
  const [skinIndex, setSkinIndex] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<'create' | 'import' | 'delete' | 'rename-pack' | 'rename-skin' | 'add' | null>(null);
  const [name, setName] = useState('');
  const [importPath, setImportPath] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourceContents, setSourceContents] = useState<Contents | null>(null);
  const [indices, setIndices] = useState<number[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() { const [packs, sources] = await Promise.all([api('/api/packs'), api('/api/models')]); setData(packs); setModels(sources); setTick(v => v + 1); }
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  const library = data?.library?.filter(p => !p.removed) ?? [];
  const presets: PackRow[] = ['custom', 'persona'].filter(id => data?.slots?.[id]).map(id => {
    const state = data?.status?.find(s => s.slot === id);
    return { key: '@' + id, id, name: id, preset: true, skins: state?.skins ?? 0, revision: JSON.stringify(state?.active) + state?.changedOutsideManager };
  });
  const presetSourceIds = new Set(data?.status?.flatMap(s => s.presetSources ?? []) ?? []);
  const local: PackRow[] = library.filter(p => !presetSourceIds.has(p.id)).map(pack => ({ key: pack.id, id: pack.id, name: pack.name, skins: pack.skins, revision: pack.revision, preset: false, pack }));
  const matches = (p: PackRow) => !query || p.name.toLowerCase().includes(query.toLowerCase());
  const visible = [...presets.filter(matches), ...local.filter(matches)];
  const row = visible.find(p => p.key === selected) ?? visible[0];
  const sourceModel = row && !row.preset ? models.find(m => m.packIds?.includes(row.id)) ?? models.find(m => m.id === row.pack?.meta?.modelId) ?? models.find(m => [m.name, m.path.split(/[\\/]/).pop()].includes(row.pack?.meta?.source ?? '')) : undefined;
  const baseUrl = row ? `/api/${row.preset ? 'preset-packs' : 'packs'}/${row.id}` : '';
  const enabled = (id: string) => data?.status?.filter(s => s.active.some(p => p.id === id)) ?? [];
  const state = row?.preset ? data?.status?.find(s => s.slot === row.id) : undefined;
  const locked = !!state?.pending || !!state?.changedOutsideManager;
  const skin = contents?.skins.find(s => s.index === skinIndex);

  useEffect(() => {
    if (!row) { setContents(null); return; }
    let cancelled = false;
    setContents(null);
    api(baseUrl + '/skins').then(c => {
      if (!cancelled) { setContents(c); setSkinIndex(i => c.skins.some((s: SkinItem) => s.index === i) ? i : 0); }
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [row?.key, row?.revision, tick]);
  useEffect(() => {
    setSourceContents(null); setIndices([]);
    if (!sourceId || dialog !== 'add') return;
    let cancelled = false;
    api(`/api/packs/${sourceId}/skins`).then(c => {
      if (!cancelled) { setSourceContents(c); setIndices(c.skins.map((s: SkinItem) => s.index)); }
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [sourceId, dialog]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setDialog(null); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [busy]);

  async function run(label: string, fn: () => Promise<unknown>, message = '操作已完成') {
    setBusy(label); setError(''); setNotice('');
    try { await fn(); await refresh(); setNotice(message); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  function show(kind: NonNullable<typeof dialog>) { setDialog(kind); setError(''); setName(kind === 'rename-pack' ? row?.name ?? '' : kind === 'rename-skin' ? skin?.name ?? '' : ''); if (kind === 'add') setSourceId(''); }
  async function importFile(file?: File) {
    if (!file) return;
    await run('正在导入皮肤包…', async () => {
      const form = new FormData(); form.append('file', file);
      const pack = await api('/api/packs/import', { method: 'POST', body: form });
      setQuery(''); setSelected(pack.id); setDialog(null);
    }, '皮肤包已导入');
  }
  const sourceOptions = library.filter(p => p.skins > 0 && p.id !== row?.id && (!row?.preset || !enabled(p.id).some(s => s.slot === row.id)));
  function packageButton(p: PackRow) {
    const game = p.preset ? data?.status?.find(s => s.slot === p.id)?.exists : enabled(p.id).length > 0;
    return <button key={p.key} className={'pack-library-row text-only' + (p.key === row?.key ? ' selected' : '')} onClick={() => { setSelected(p.key); setSkinIndex(0); setNotice(''); setError(''); }}>
      <span><b>{p.name}</b><small>{p.skins} 套皮肤{p.preset ? ' · 预制包' : p.pack?.draft ? ' · 空包' : ''}</small></span>
      {game && <span className="pack-game-badge">{p.preset ? '游戏中' : '游戏中 · ' + enabled(p.id).map(s => s.slot).join(' / ')}</span>}
    </button>;
  }

  return <div className="page-content pack-manager-page">
    <div className="pack-toolbar"><div><h1>皮肤包</h1><span>{presets.length} 个预制包 · {local.length} 个本地包</span></div><div className="pack-top-actions"><button disabled={!!busy} onClick={() => void run('正在刷新…', refresh)}>刷新</button><button disabled={!!busy || !data?.configured} onClick={() => show('import')}>导入皮肤包</button><button className="primary" disabled={!!busy || !data?.configured} onClick={() => show('create')}>＋ 新建皮肤包</button></div></div>
    {error && <div role="alert" className="pack-message error">{error}</div>}{notice && <div role="status" className="pack-message">{notice}</div>}{busy && <div role="status" className="busy-line"><span className="spinner"/>{busy}</div>}
    {!data ? <div className="empty-state">正在读取皮肤包…</div> : !data.configured ? <div className="empty-state"><h2>尚未配置游戏目录</h2><p>{data.error}</p></div> : <>
      <div className="pack-browser"><aside className="pack-list-pane organized-packs"><div className="pack-sidebar-head"><h2>我的皮肤包</h2><input aria-label="搜索皮肤包" placeholder="搜索皮肤包…" value={query} onChange={e => setQuery(e.target.value)}/></div>
        <div className="pack-sidebar-scroll"><div className="pane-caption">游戏预制 · 置顶</div>{presets.filter(matches).map(packageButton)}<div className="pane-caption local-pack-caption">本地皮肤包</div>{local.filter(matches).map(packageButton)}{!local.filter(matches).length && <div className="small-empty">{query ? '没有匹配的本地包' : '新建或导入你的皮肤包'}</div>}</div>
      </aside><section className="pack-content-pane">{row ? <>
        <div className="pack-detail-bar"><div><h2>{row.name}{row.preset && <span className="preset-title-badge">游戏预制</span>}</h2><span>{contents?.skins.length ?? row.skins} 套皮肤{row.preset ? ' · 来自游戏目录' : ' · 本地皮肤包'}</span></div><div className="pack-detail-actions">
          <button disabled={!!busy || locked} onClick={() => show('add')}>＋ 添加皮肤</button>
          {row.preset ? <><button disabled={!!busy || !state?.managed || !state.active.length || locked} onClick={() => void run('正在恢复…', () => post('/api/packs/restore', { slot: row.id }), '已恢复初始皮肤包')}>恢复初始</button>{!!state?.pending && <button disabled={!!busy} onClick={() => void run('正在恢复…', () => post('/api/packs/recover', { slot: row.id }))}>恢复中断</button>}</> : <><button disabled={!!busy} onClick={() => show('rename-pack')}>修改包名</button><button className="danger-button" disabled={!!busy || enabled(row.id).length > 0} title={enabled(row.id).length ? '先从游戏中移除，才能删除本地包' : ''} onClick={() => show('delete')}>{enabled(row.id).length ? '游戏中，暂不可删除' : '删除包'}</button></>}
        </div></div>
        {row && !row.preset && <div className="inline-note">{sourceModel ? <>关联源模型：<a href={'#/models?model='+encodeURIComponent(sourceModel.id)}>{sourceModel.name} →</a></> : <div className="button-row"><span>未关联源模型</span><select aria-label="关联源模型" value={linkTarget} onChange={e => setLinkTarget(e.target.value)}><option value="">选择源模型…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button disabled={!linkTarget || !!busy} onClick={() => void run('正在关联…', async () => { await post('/api/models/update', {id:linkTarget, packId:row.id}); setLinkTarget(''); }, '已关联源模型')}>关联</button></div>}</div>}
        {state?.changedOutsideManager && <p className="inline-note">游戏目录有外部改动，已暂停写入。你仍可查看包内皮肤。</p>}
        {!!row.pack?.meta?.importWarnings?.length && <details className="inline-note"><summary>导入提示：{row.pack?.meta.importWarnings.length} 条无效皮肤未导入</summary>{row.pack?.meta.importWarnings.map((message, index) => <p key={index}>{message}</p>)}</details>}
        <div className="skin-content-layout"><div className="skin-list-pane"><div className="pane-caption">包内皮肤</div>{!contents ? <p className="muted">正在读取…</p> : contents.skins.map(s => <button className={'skin-item text-only' + (s.index === skinIndex ? ' selected' : '')} key={s.index} onClick={() => setSkinIndex(s.index)}><span className="skin-order">{s.index + 1}</span><span><b>{s.name}</b></span></button>)}</div>
        <div className="skin-detail-pane">{skin ? <><div className="skin-title"><h3>{skin.name}</h3>{!row.preset && <button disabled={!!busy} onClick={() => show('rename-skin')}>修改皮肤名</button>}</div><PackPreview packId={row.id} baseUrl={baseUrl} skinIndex={skinIndex} revision={contents?.revision ?? row.revision}/>
          {row.preset ? <div className="preset-sources"><span>已加入此预制包</span>{state?.active.filter(p => !presetSourceIds.has(p.id)).map(p => <button key={p.id} onClick={() => { setSelected(p.id); setQuery(''); }}>{library.find(x => x.id === p.id)?.name ?? p.id} →</button>)}{!state?.active.some(p => !presetSourceIds.has(p.id)) && <span>预制皮肤</span>}</div> : <div className="skin-actions"><span>添加到游戏</span>{presets.map(p => { const slot = data.status?.find(s => s.slot === p.id); const active = slot?.active.find(x => x.id === row.id); const pendingUpdate = active && active.revision !== row.revision; const disabled = !!busy || !!slot?.pending || !!slot?.changedOutsideManager; return <div key={p.id} className="skin-action-group">{active ? <><span className="enabled-label">游戏中 · {p.id}</span>{pendingUpdate && <button disabled={disabled} onClick={() => void run('正在更新…', () => post('/api/packs/apply-update', { slot: p.id, id: row.id }), '已更新到游戏')}>更新到游戏</button>}<button disabled={disabled} onClick={() => void run('正在移除…', () => post('/api/packs/disable', { slot: p.id, id: row.id }), '已从游戏中移除，本地包保留')}>从 {p.id} 移除</button></> : <button disabled={disabled || !row.skins} onClick={() => void run('正在加入游戏…', () => post('/api/packs/enable', { slot: p.id, id: row.id }), '已加入游戏')}>加入 {p.id}</button>}</div>; })}</div>}
          <p className="game-write-note">写入或恢复游戏皮肤前，请完全退出 Minecraft。{row.preset ? '预制包的名称与位置固定。' : '修改本地包后，可手动更新到游戏。'}</p>
        </> : contents && <div className="empty-state empty-pack"><h2>{row.preset ? '此预制包暂无皮肤' : '这是一个空皮肤包'}</h2><p>添加已有皮肤，或先到工作台生成新皮肤。</p><div className="button-row"><button className="primary" disabled={!!busy || locked} onClick={() => show('add')}>添加已有皮肤</button><a className="button-link" href="#/models">去生成皮肤 →</a></div></div>}</div></div>
      </> : <div className="empty-state">没有匹配的皮肤包。</div>}</section></div>
      <details className="connection-details"><summary>游戏目录与连接信息</summary><p>游戏目录：{data.root}</p><p>本地管理：{data.stateDir}</p></details>
    </>}
    {dialog && <div className="pick-overlay" role="dialog" aria-modal="true" aria-label={dialog === 'create' ? '新建皮肤包' : dialog === 'import' ? '导入皮肤包' : dialog === 'delete' ? '删除皮肤包' : dialog === 'add' ? '添加皮肤' : '修改名称'}><div className="pick-box pack-operation-dialog">
      <div className="card-top"><h2>{dialog === 'create' ? '新建皮肤包' : dialog === 'import' ? '导入皮肤包' : dialog === 'delete' ? '删除皮肤包？' : dialog === 'add' ? '添加皮肤' : dialog === 'rename-pack' ? '修改包名' : '修改皮肤名'}</h2><button disabled={!!busy} aria-label="关闭弹窗" onClick={() => setDialog(null)}>×</button></div>
      {['create','rename-pack','rename-skin'].includes(dialog) && <form onSubmit={e => {e.preventDefault(); void run('正在保存…', async () => {if (dialog === 'create') { const p = await post('/api/packs/create', {name}); setQuery(''); setSelected(p.id); } else if (row) await post('/api/packs/rename', dialog === 'rename-pack' ? {id:row.id,name} : {id:row.id,skinIndex,skinName:name}); setDialog(null); }, dialog === 'create' ? '皮肤包已创建，可以开始添加皮肤' : '名称已保存'); }}><label>名称<input aria-label="名称" autoFocus maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>{dialog === 'create' && <p>先创建一个空包，再选择要放进去的皮肤。</p>}<div className="pick-actions"><button type="button" disabled={!!busy} onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={!!busy || !name.trim()}>{dialog === 'create' ? '创建皮肤包' : '保存名称'}</button></div></form>}
      {dialog === 'import' && <><p>支持 .mcpack、皮肤包 ZIP，或本地皮肤包文件夹。</p><button className="primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>选择皮肤包文件</button><input hidden ref={fileInput} type="file" accept=".mcpack,.zip" onChange={e => {void importFile(e.target.files?.[0]);e.target.value='';}}/><label className="import-path-label">也可以输入本地路径<input aria-label="皮肤包本地路径" placeholder="E:/下载/角色.mcpack" value={importPath} onChange={e => setImportPath(e.target.value)}/></label><div className="pick-actions"><button disabled={!!busy} onClick={() => setDialog(null)}>取消</button><button disabled={!!busy || !importPath.trim()} onClick={() => void run('正在导入…', async () => { const p = await post('/api/packs/import', {path:importPath.trim()}); setSelected(p.id); setQuery(''); setDialog(null); }, '皮肤包已导入')}>从本地导入</button></div></>}
      {dialog === 'delete' && row && <><p>永久删除本地皮肤包「{row.name}」及其中的皮肤副本。来源模型和其他包不受影响。</p><div className="pick-actions"><button disabled={!!busy} onClick={() => setDialog(null)}>取消</button><button className="danger-button" disabled={!!busy} onClick={() => void run('正在删除…', async () => {await post('/api/packs/delete',{id:row.id});setDialog(null);setSelected('@custom');}, '本地皮肤包已删除')}>确认删除</button></div></>}
      {dialog === 'add' && row && <><p>{row.preset ? `选择一个本地包，将其中全部皮肤加入 ${row.id}。写入前请退出游戏。` : `从已有包中选择皮肤，复制到「${row.name}」。来源包保持不变。`}</p><label>来源皮肤包<select aria-label="来源皮肤包" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">请选择</option>{sourceOptions.map(p => <option key={p.id} value={p.id}>{p.name}（{p.skins} 套）</option>)}</select></label>{sourceContents && <div className="skin-copy-list">{sourceContents.skins.map(s => <label key={s.index}><input type="checkbox" checked={indices.includes(s.index)} disabled={row.preset || !!busy} onChange={e => setIndices(a => e.target.checked ? [...a,s.index] : a.filter(i => i!==s.index))}/>{s.name}</label>)}</div>}{!sourceOptions.length && <p>没有可添加的本地皮肤。先导入皮肤包，或在工作台生成皮肤。</p>}<div className="pick-actions"><button disabled={!!busy} onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={!!busy || !sourceId || !indices.length} onClick={() => void run('正在添加皮肤…', async () => {await post(row.preset ? '/api/packs/enable' : '/api/packs/add-skins', row.preset ? {slot:row.id,id:sourceId} : {target:row.id,source:sourceId,indices});setDialog(null);}, '皮肤已添加')}>添加 {indices.length || ''} 套皮肤</button></div></>}
      {busy && <p role="status">{busy}</p>}{error && <p className="error" role="alert">{error}</p>}
    </div></div>}
  </div>;
}

