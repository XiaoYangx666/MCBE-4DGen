import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

/** Model files are local; resources stay within the model's containing directory. */
export class ModelResources {
  readonly virtual = new Map<string, Uint8Array>();
  readonly root: string;

  constructor(root: string) { this.root = root; }

  path(name: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(name) && !isAbsolute(name)) throw new Error(`Resource URI schemes are unsupported: ${name}`);
    const path = resolve(this.root, name.replaceAll('\\', '/'));
    this.assertInside(path);
    return path;
  }

  private assertInside(path: string): void {
    const part = relative(this.root, path);
    if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) {
      throw new Error(`Resource is outside the model directory: ${path}`);
    }
  }

  async read(name: string): Promise<Uint8Array<ArrayBuffer>> {
    const path = this.path(name);
    const virtual = this.virtual.get(path);
    if (virtual) return Uint8Array.from(virtual);
    const actual = await realpath(path);
    this.assertInside(actual); // Includes symlinks, not just lexical ../ checks.
    return Uint8Array.from(await readFile(actual));
  }
}

/** Keeps Assimp's generated GLB in memory while resolving its original image sidecars. */
export class ModelIO extends NodeIO {
  readonly resources: ModelResources;
  constructor(resources: ModelResources) {
    super();
    this.resources = resources;
  }

  protected override readURI(uri: string, type: 'view'): Promise<Uint8Array<ArrayBuffer>>;
  protected override readURI(uri: string, type: 'text'): Promise<string>;
  protected override async readURI(uri: string, type: 'view' | 'text'): Promise<Uint8Array<ArrayBuffer> | string> {
    const bytes = await this.resources.read(uri);
    return type === 'text' ? new TextDecoder().decode(bytes) : bytes;
  }
}
