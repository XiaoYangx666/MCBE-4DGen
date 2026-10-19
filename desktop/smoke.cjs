module.exports=async function(options){
  const post=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;};
  let nativeValidation=false;try{await window.desktop.chooseDirectory('invalid','');}catch(error){nativeValidation=String(error).includes('目录参数无效');}
  if(!nativeValidation)throw Error('Native IPC sender/argument validation failed');
  const probe=URL.createObjectURL(new Blob(['texture-buffer']));try{const response=await fetch(probe);if(await response.text()!=='texture-buffer')throw Error('Texture blob mismatch');}finally{URL.revokeObjectURL(probe);}
  const settings=await fetch('/api/settings').then(r=>r.json());
  const usage=await fetch('/api/settings/storage-usage').then(r=>r.json());
  const form=new FormData();form.append('files',new File([Uint8Array.from(atob(options.textureFixture),c=>c.charCodeAt(0))],'desktop-test.glb'));form.append('paths','desktop-test.glb');
  const response=await fetch('/api/upload',{method:'POST',body:form});const model=await response.json();if(!response.ok)throw Error(JSON.stringify(model));
  const job=await post('/api/convert',{session:model.id,excluded:[],binding:'static',ratio:1,maxError:.03,height:32,profile:null});
  let converted=false;
  for(let i=0;i<100;i++){const state=await fetch('/api/job/'+job.id).then(r=>r.json());if(state.status==='error')throw Error(state.message);if(state.status==='done'){converted=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}
  if(!converted)throw Error('Desktop conversion timed out');
  const archive=await fetch('/api/job/'+job.id+'/download');
  if(!archive.ok||!archive.headers.get('Content-Disposition')?.includes('.zip')||(await archive.arrayBuffer()).byteLength<100)throw Error('ZIP download failed');
  location.hash='#/settings';await new Promise(resolve=>setTimeout(resolve,600));
  const waitFor=async(predicate)=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Renderer assertion timed out: '+predicate.toString()+' '+document.documentElement.dataset.expanded+' '+document.querySelector('.viewport')?.outerHTML.slice(0,700));};
  await waitFor(()=>!!document.querySelector('.desktop-appbar'));
  if(document.querySelector('.app-nav'))throw Error('Duplicate navigation');
  await window.desktop.windowAction('maximize');
  await waitFor(()=>document.documentElement.dataset.expanded==='true');
  await window.desktop.windowAction('maximize');
  await waitFor(()=>document.documentElement.dataset.expanded==='false');
  await waitFor(()=>!!document.querySelector('.appearance-options'));
  for(const [theme,label] of [['light','浅色'],['dark','深色'],['system','跟随系统']]){
    [...document.querySelectorAll('.appearance-options button')].find(button=>button.textContent.includes(label)).click();
    await waitFor(()=>document.querySelector('.appearance-options button[aria-pressed="true"]')?.textContent.includes(label));
    if(await window.desktop.appearance()!==theme)throw Error('Appearance was not persisted');
    if(theme!=='system'&&document.documentElement.dataset.theme!==theme)throw Error('Appearance was not applied');
  }
  for(const palette of ['ocean','sand','rose','violet','graphite']){
    document.querySelector('.palette-preview.'+palette).parentElement.click();
    await waitFor(()=>document.documentElement.dataset.palette===palette);
    if(await window.desktop.palette()!==palette)throw Error('Palette was not persisted');
  }
  location.hash='#/models';
  await waitFor(()=>!!document.querySelector('.viewport[data-preview-state="ready"]')&&Number(document.querySelector('.viewport').dataset.previewTextures)>0);
  return {textured:true,appbar:true,title:document.title,nativeDirectory:typeof window.desktop?.chooseDirectory==='function',nodeExposed:typeof window.require!=='undefined',dataRoot:settings.dataRoot,bytes:usage.bytes,converted,zip:true};
};
