import { useEffect, useState } from 'react';
import { api } from './api';
import { PackPreview } from './PackPage';
import { SaveSkinDialog } from './SaveSkinDialog';

export function TemplatesPage() {
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState('图片皮肤'),[height,setHeight]=useState(32);
  const [result,setResult]=useState<{id:string;name:string;width:number;height:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[save,setSave]=useState(false),[dirty,setDirty]=useState(false);
  const [preview,setPreview]=useState('');
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  useEffect(()=>{
    let active=true;
    const id=new URLSearchParams(location.hash.split('?')[1]).get('pack');
    if(!id)return;
    setBusy(true);
    void (async()=>{
      const packs=await api('/api/packs'),pack=packs.library?.find((p:any)=>p.id===id);
      if(!pack||pack.meta?.template!=='image')throw Error('找不到图片模板的源文件');
      const response=await fetch('/api/packs/'+encodeURIComponent(id)+'/source-image');
      if(!response.ok)throw Error('源图片读取失败');
      const file=new File([await response.blob()],pack.name+'.png',{type:'image/png'});
      if(active){setFile(file);setName(pack.name);setHeight(pack.meta.height??32);setPreview(URL.createObjectURL(file));setDirty(true);}
    })().catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[]);
  async function generate() {
    if(!file)return;
    setBusy(true);setError('');
    try {const form=new FormData();form.append('image',file);form.append('name',name.trim());form.append('height',String(height));setResult(await api('/api/templates/image',{method:'POST',body:form}));setDirty(false);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  return <main className="page-content templates-page"><div className="page-heading"><div><span className="eyebrow">SKIN TEMPLATES</span><h1>皮肤模板</h1><p>不用准备三维模型，从图片直接制作皮肤。</p></div></div>
    <div className="template-layout"><section className="template-settings"><div className="template-icon">▧</div><h2>图片 · 平面皮肤</h2><p>完整图片贴到竖直平面，两面可见。保留比例和透明背景，跟随身体移动。</p>
      <fieldset disabled={busy}><label>选择图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,image/avif" onChange={e=>{const f=e.target.files?.[0]??null;setFile(f);setDirty(true);if(preview)URL.revokeObjectURL(preview);setPreview(f?URL.createObjectURL(f):'');if(f)setName(f.name.replace(/\.[^.]+$/,''));}}/></label>
      {preview&&<img className="image-source-preview" src={preview} alt="源图片"/>}
      <label>皮肤名称<input maxLength={120} value={name} onChange={e=>{setName(e.target.value);setDirty(true);}}/></label><label>平面高度<input type="number" min={1} max={128} value={height} onChange={e=>{setHeight(Number(e.target.value));setDirty(true);}}/></label><p className="help">默认 32，约为玩家身高。宽度按图片比例计算。输出贴图为 128 × 128；动画图片使用第一帧。</p>
      <button className="primary" disabled={!file||!name.trim()||!Number.isFinite(height)||height<1||height>128} onClick={()=>void generate()}>{busy?'正在生成…':result?'重新生成':'生成图片皮肤'}</button></fieldset>
      {error&&<p className="error" role="alert">{error}</p>}
    </section><section className="template-result"><div className="detail-heading"><div><h2>{result?.name??'成品预览'}</h2><p>{result?`${result.width.toFixed(1)} × ${result.height} · 4 三角面 · 双面`:'导入图片并生成后，在这里检查平面方向与透明区域。'}</p></div></div>
      {result?<><PackPreview packId={result.id} baseUrl={'/api/job/'+result.id}/><div className="template-result-actions">{dirty&&<p role="status">图片或参数已修改，请重新生成。</p>}<button className="primary" disabled={busy||dirty} onClick={()=>setSave(true)}>保存皮肤…</button><a className="button-link" href={'/api/job/'+result.id+'/download'} download>下载{dirty?'上次结果 ':''}.mcpack</a></div></>:<div className="empty-state"><h2>一张图片，一张平面皮肤</h2><p>适合立绘、表情包、标志与透明 PNG。</p></div>}
    </section></div>
    {save&&result&&!dirty&&<SaveSkinDialog jobId={result.id} modelName={result.name} onClose={()=>setSave(false)} onSaved={id=>{setSave(false);location.hash='#/packs?pack='+encodeURIComponent(id);}}/>}
  </main>;
}
