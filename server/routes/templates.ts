import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createImageSkin } from '../../src/image-template.ts';
import { storage } from '../../src/workspace-storage.ts';
import { fileExists } from '../fs.ts';
import { json, withBusy } from '../http.ts';
import type { Studio } from '../studio.ts';

export async function handleTemplates(
  studio: Studio,
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== '/api/templates/image' || req.method !== 'POST')
    return null;
  return withBusy(studio, async () => {
    const form = await req.formData();
    const file = form.get('image');
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
      throw Error('请选择 20 MB 以内的图片');
    const name = String(
      form.get('name') || file.name.replace(/\.[^.]+$/, ''),
    ).trim();
    const height = Number(form.get('height') ?? 32);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = await createImageSkin(bytes, { name, height });
    const imageId = createHash('sha256').update(bytes).digest('hex');
    const source = resolve(storage.sources, 'images', imageId + '.image');
    await mkdir(dirname(source), { recursive: true });
    if (!(await fileExists(source)))
      await writeFile(source, image.sourceImage);
    const id = crypto.randomUUID();
    studio.addJob(id, {
      status: 'done',
      message: '图片皮肤已生成',
      files: image.files,
      geometry: image.geometry,
      texture: image.png,
      meta: {
        source,
        sourceMime: image.sourceMime,
        template: 'image',
        height,
      },
      result: { report: { triangles: 4 }, details: {}, excluded: [] },
    });
    return json({ id, name, width: image.width, height, source });
  });
}
