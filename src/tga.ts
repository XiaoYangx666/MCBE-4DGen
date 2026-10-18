export interface DecodedImage {
  width: number;
  height: number;
  /** Tightly packed RGBA, top-left origin. */
  data: Uint8Array;
}

/** Minimal TGA reader for the true-color/greyscale files found in MMD packs. */
export function decodeTGA(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 18) throw new Error("Invalid TGA: truncated header");
  const idLength = bytes[0]!,
    colorMapType = bytes[1]!,
    imageType = bytes[2]!,
    width = bytes[12]! | (bytes[13]! << 8),
    height = bytes[14]! | (bytes[15]! << 8),
    depth = bytes[16]!,
    descriptor = bytes[17]!;
  if (!width || !height) throw new Error("Invalid TGA: zero dimensions");
  if (colorMapType !== 0) throw new Error("Unsupported TGA: color-mapped image");
  if (![2, 3, 10, 11].includes(imageType))
    throw new Error(`Unsupported TGA image type ${imageType}`);
  const bytesPerPixel = depth === 8 ? 1 : depth === 24 ? 3 : depth === 32 ? 4 : 0;
  if (!bytesPerPixel) throw new Error(`Unsupported TGA bit depth ${depth}`);
  if (imageType === 3 || imageType === 11) {
    if (bytesPerPixel !== 1)
      throw new Error("Unsupported TGA: greyscale depth must be 8 bits");
  }
  const pixels = width * height,
    rgba = new Uint8Array(pixels * 4);
  let offset = 18 + idLength;
  const readPixel = (index: number) => {
    if (offset + bytesPerPixel > bytes.length)
      throw new Error("Invalid TGA: truncated pixel data");
    let red: number, green: number, blue: number, alpha = 255;
    if (bytesPerPixel === 1) {
      red = green = blue = bytes[offset]!;
    } else {
      blue = bytes[offset]!;
      green = bytes[offset + 1]!;
      red = bytes[offset + 2]!;
      if (bytesPerPixel === 4) alpha = bytes[offset + 3]!;
    }
    offset += bytesPerPixel;
    const out = index * 4;
    rgba[out] = red;
    rgba[out + 1] = green;
    rgba[out + 2] = blue;
    rgba[out + 3] = alpha;
  };

  if (imageType === 2 || imageType === 3) {
    for (let index = 0; index < pixels; index++) readPixel(index);
  } else {
    let index = 0;
    while (index < pixels) {
      if (offset >= bytes.length) throw new Error("Invalid TGA: truncated RLE data");
      const packet = bytes[offset++]!,
        count = Math.min((packet & 0x7f) + 1, pixels - index);
      if (packet & 0x80) {
        readPixel(index);
        const red = rgba[index * 4]!,
          green = rgba[index * 4 + 1]!,
          blue = rgba[index * 4 + 2]!,
          alpha = rgba[index * 4 + 3]!;
        for (let step = 1; step < count; step++) {
          const out = (index + step) * 4;
          rgba[out] = red;
          rgba[out + 1] = green;
          rgba[out + 2] = blue;
          rgba[out + 3] = alpha;
        }
      } else {
        for (let step = 0; step < count; step++) readPixel(index + step);
      }
      index += count;
    }
  }

  const topOrigin = (descriptor & 0x20) !== 0,
    rightOrigin = (descriptor & 0x10) !== 0;
  if (topOrigin && !rightOrigin) return { width, height, data: rgba };
  const flipped = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    const sourceRow = topOrigin ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sourceColumn = rightOrigin ? width - 1 - x : x;
      const source = (sourceRow * width + sourceColumn) * 4,
        target = (y * width + x) * 4;
      flipped[target] = rgba[source]!;
      flipped[target + 1] = rgba[source + 1]!;
      flipped[target + 2] = rgba[source + 2]!;
      flipped[target + 3] = rgba[source + 3]!;
    }
  }
  return { width, height, data: flipped };
}
