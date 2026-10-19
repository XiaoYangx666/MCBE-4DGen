import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { storage } from '../../src/workspace-storage.ts';
import { fileExists } from '../fs.ts';
import { json, safeName, withBusy } from '../http.ts';
import { modelPattern } from '../model-files.ts';
import type { Studio } from '../studio.ts';

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const MAX_UPLOAD_FILES = 2000;

export async function handleUploads(
  studio: Studio,
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/api/upload' && req.method === 'POST')
    return withBusy(studio, async () => {
      const form = await req.formData();
      const files = form.getAll('files');
      const names = form.getAll('paths');
      const uploadHash = createHash('sha256');
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!(file instanceof File)) throw Error('缺少模型文件');
        uploadHash.update(
          JSON.stringify([String(names[index] ?? file.name), file.size]),
        );
        uploadHash.update(new Uint8Array(await file.arrayBuffer()));
      }
      const digest = uploadHash.digest('hex');
      const uploadId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 36)}`;
      const folder = resolve(storage.sources, 'uploads', uploadId);
      await mkdir(folder, { recursive: true });
      let total = 0;
      const paths: string[] = [];

      async function save(name: string, bytes: Uint8Array): Promise<void> {
        total += bytes.length;
        if (total > MAX_UPLOAD_BYTES) throw Error('解压内容超过 256 MB');
        if (paths.length >= MAX_UPLOAD_FILES) throw Error('文件过多');
        const path = resolve(folder, safeName(name));
        if (paths.includes(path)) throw Error('重复文件路径');
        await mkdir(resolve(path, '..'), { recursive: true });
        if (!(await fileExists(path)))
          await writeFile(path, bytes, { flag: 'wx' });
        paths.push(path);
      }

      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!(file instanceof File)) throw Error('缺少模型文件');
        if (file.name.toLowerCase().endsWith('.zip')) {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue;
            const name =
              (entry as typeof entry & { unsafeOriginalName?: string })
                .unsafeOriginalName ?? entry.name;
            safeName(name);
            await save(name, await entry.async('uint8array'));
          }
        } else
          await save(
            String(names[index] ?? file.name),
            new Uint8Array(await file.arrayBuffer()),
          );
      }

      const candidates = paths.filter((path) => modelPattern.test(path));
      if (!candidates.length)
        throw Error('没有找到可导入的模型文件（PMX / VRM / GLB / OBJ…）');
      if (candidates.length > 1)
        return json({
          pending: basename(folder),
          candidates: candidates.map((path) => relative(folder, path)),
        });
      return json(
        await studio.load(candidates[0]!, basename(candidates[0]!), null),
      );
    });

  if (url.pathname === '/api/upload/select' && req.method === 'POST')
    return withBusy(studio, async () => {
      const body = (await req.json()) as { pending?: string; main?: string };
      const id = String(body.pending ?? '');
      if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('上传会话无效或已过期');
      const folder = resolve(storage.sources, 'uploads', id);
      const main = resolve(folder, safeName(String(body.main ?? '')));
      if (!main.startsWith(folder + '\\') && !main.startsWith(folder + '/'))
        throw Error('模型路径无效');
      if (!modelPattern.test(main)) throw Error('请选择模型文件');
      if (!(await fileExists(main))) throw Error('模型文件不存在');
      return json(await studio.load(main, basename(main), null));
    });

  return null;
}
