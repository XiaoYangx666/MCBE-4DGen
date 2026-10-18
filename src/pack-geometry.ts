import type { BedrockGeometryFile } from './bedrock-types.ts';

/** Structural checks for imported legacy cube/poly geometry; the converter keeps its stricter validator. */
export function validateImportedGeometry(file: any) {
  if (!file || typeof file !== 'object' || !['1.8.0','1.10.0','1.12.0'].includes(file.format_version)) throw Error('Unsupported imported geometry format');
  const identifiers = Object.keys(file).filter(k=>k.startsWith('geometry.'));
  const tuple = (v:any,n:number) => Array.isArray(v)&&v.length===n&&v.every((x:any)=>typeof x==='number'&&Number.isFinite(x));
  for(const id of identifiers){
    const g=file[id];
    if(!g || !Number.isInteger(g.texturewidth)||g.texturewidth<=0||!Number.isInteger(g.textureheight)||g.textureheight<=0||!Array.isArray(g.bones)) throw Error('Invalid imported geometry: '+id);
    for(const b of g.bones){
      if(typeof b.name!=='string'||!b.name||/[\x00-\x1f]/.test(b.name)) throw Error('Invalid imported bone name');
      for(const key of ['pivot','rotation'])if(b[key]!==undefined&&!tuple(b[key],3))throw Error('Invalid imported bone '+key);
      if(b.cubes!==undefined){if(!Array.isArray(b.cubes))throw Error('Invalid cubes');for(const c of b.cubes){if(!tuple(c.origin,3)||!tuple(c.size,3)||c.size.some((x:number)=>x<0))throw Error('Invalid cube bounds');if(c.rotation!==undefined&&!tuple(c.rotation,3))throw Error('Invalid cube rotation');if(c.pivot!==undefined&&!tuple(c.pivot,3))throw Error('Invalid cube pivot');if(c.inflate!==undefined&&!Number.isFinite(c.inflate))throw Error('Invalid cube inflation');}}
      if(b.poly_mesh){const p=b.poly_mesh;for(const [key,n]of [['positions',3],['normals',3],['uvs',2]] as const)if(!Array.isArray(p[key])||p[key].some((v:any)=>!tuple(v,n)))throw Error('Invalid imported poly '+key);if(!Array.isArray(p.polys))throw Error('Unsupported imported polygon stream');for(const poly of p.polys){if(!Array.isArray(poly)||![3,4].includes(poly.length))throw Error('Invalid imported polygon');for(const ref of poly)if(!tuple(ref,3)||ref.some((v:number,i:number)=>!Number.isInteger(v)||v<0||v>=[p.positions.length,p.normals.length,p.uvs.length][i]!))throw Error('Imported polygon index out of range');}}
    }
  }
  return {file:file as BedrockGeometryFile,geometries:identifiers.map(identifier=>({identifier}))};
}
