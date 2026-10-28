import { describe, expect, it } from 'vitest';
import { indexResources, joinModelPath } from '../webapp/engine/resources.ts';

function fileAt(path: string, bytes = path): File {
  const file = new File([bytes], path.slice(path.lastIndexOf('/') + 1));
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('archive resource lookup', () => {
  it('prefers textures from the selected model folder over same-named files', () => {
    const other = fileAt('卡提希娅/卡提希娅/textures/Down_D.png');
    const target = fileAt('芙露德莉斯/芙露德利斯/textures/Down_D.png');
    const targetMetal = fileAt('芙露德莉斯/芙露德利斯/textures/Down_Metal.png');
    const model = fileAt('芙露德莉斯/芙露德利斯/芙露德利斯.pmx');
    const index = indexResources([other, target, targetMetal, model], '芙露德莉斯/芙露德利斯/芙露德利斯.pmx');

    expect(index.find('textures/Down_D.png')).toBe(target);
    expect(index.find('textures\\Down_D.png')).toBe(target);
    expect(index.find('textures/down_d.PNG')).toBe(target);
    expect(index.find('Down_D.png')).toBe(target);
    expect(index.find('textures/Down_Metal.png')).toBe(targetMetal);
    expect(index.localPath(target)).toBe('textures/down_d.png');
    expect(index.files[0]).toBe(target);
  });

  it('resolves parent references and falls back to other folders', () => {
    const shared = fileAt('芙露德莉斯/shared/global.png');
    const onlyOther = fileAt('卡提希娅/卡提希娅/textures/Only_Other.png');
    const model = fileAt('芙露德莉斯/芙露德利斯/芙露德利斯.pmx');
    const index = indexResources([shared, onlyOther, model], '芙露德莉斯/芙露德利斯/芙露德利斯.pmx');

    expect(index.find('../shared/global.png')).toBe(shared);
    expect(index.find('textures/Only_Other.png')).toBe(onlyOther);
    expect(index.find('textures/missing.png')).toBeUndefined();
  });

  it('joins references with dot segments', () => {
    expect(joinModelPath('model/tex', '../shared/a.png')).toBe('model/shared/a.png');
    expect(joinModelPath('', 'tex/a.png')).toBe('tex/a.png');
    expect(joinModelPath('a/b', 'c/./d.png')).toBe('a/b/c/d.png');
  });
});
