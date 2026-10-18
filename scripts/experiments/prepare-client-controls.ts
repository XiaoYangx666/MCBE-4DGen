import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('outputs/client-controls', { recursive: true });
// Opaque, bright texture: a visible standard-geometry control independent of the converter.
await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff8040' } })
  .png().toFile('outputs/client-controls/control64.png');
for (const sample of ['avocado', 'shino']) {
  await sharp(`outputs/${sample}/skin0.png`).resize(128, 128).png()
    .toFile(`outputs/client-controls/${sample}128.png`);
}
await writeFile('outputs/client-controls/README.txt', 'Local diagnostic textures; not a Minecraft client acceptance result.\n');
