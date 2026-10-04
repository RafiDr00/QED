/**
 * Minimal PNG reader - enough to inspect Playwright screenshots without
 * pulling in an image dependency. Handles 8-bit truecolour with or without
 * alpha, which is what Chromium writes.
 */
import { inflateSync } from "node:zlib";

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): Bitmap {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body.readUInt8(8);
      colorType = body.readUInt8(9);
      if (body.readUInt8(12) !== 0) throw new Error("interlaced PNG");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    if (filter === undefined) throw new Error("truncated PNG");
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x] ?? 0;
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= channels ? (prev[x - channels] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown filter ${filter}`);
      }
      line[x] = value & 0xff;
    }
    src += stride;

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s] ?? 0;
      out[d + 1] = line[s + 1] ?? 0;
      out[d + 2] = line[s + 2] ?? 0;
      out[d + 3] = channels === 4 ? (line[s + 3] ?? 255) : 255;
    }
    prev.set(line);
  }

  return { width, height, data: out };
}

/** Rec. 709 luma, 0-255, ignoring alpha. */
export function luma(bitmap: Bitmap, index: number): number {
  const d = index * 4;
  return (
    0.2126 * (bitmap.data[d] ?? 0) +
    0.7152 * (bitmap.data[d + 1] ?? 0) +
    0.0722 * (bitmap.data[d + 2] ?? 0)
  );
}

export interface LumaStats {
  mean: number;
  stdDev: number;
  distinctValues: number;
}

export function lumaStats(bitmap: Bitmap): LumaStats {
  const n = bitmap.width * bitmap.height;
  const seen = new Set<number>();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = luma(bitmap, i);
    sum += l;
    seen.add(Math.round(l));
  }
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (luma(bitmap, i) - mean) ** 2;
  return {
    mean,
    stdDev: Math.sqrt(variance / n),
    distinctValues: seen.size,
  };
}

export interface Comparison {
  /** Fraction of compared pixels whose luma differs by more than `tolerance`. */
  ratio: number;
  /**
   * False when the two bitmaps are not the same size. A caller must decide
   * what that means rather than reading a ratio: an earlier version of this
   * function returned 1 for a size mismatch, which quietly turned two of three
   * glyph comparisons into a constant and made the gate that read them prove
   * nothing at all.
   */
  dimensionsMatch: boolean;
  /** The region actually compared. */
  width: number;
  height: number;
}

/** Compares the overlapping region, and says whether there was more to compare. */
export function compareBitmaps(
  a: Bitmap,
  b: Bitmap,
  tolerance = 4,
): Comparison {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const dimensionsMatch = a.width === b.width && a.height === b.height;
  if (width === 0 || height === 0) {
    return { ratio: 0, dimensionsMatch, width, height };
  }

  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = luma(a, y * a.width + x);
      const right = luma(b, y * b.width + x);
      if (Math.abs(left - right) > tolerance) differing++;
    }
  }
  return {
    ratio: differing / (width * height),
    dimensionsMatch,
    width,
    height,
  };
}

export function cropToBitmap(
  bitmap: Bitmap,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Bitmap {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * bitmap.width + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      data[d] = bitmap.data[s] ?? 0;
      data[d + 1] = bitmap.data[s + 1] ?? 0;
      data[d + 2] = bitmap.data[s + 2] ?? 0;
      data[d + 3] = bitmap.data[s + 3] ?? 0;
    }
  }
  return { width: w, height: h, data };
}
