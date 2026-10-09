import { deflateSync } from "node:zlib";



/** A 16x12 baseline (SOF0) JPEG written by macOS ImageIO through `sips`. */
export const BASELINE_JPEG_BASE64 = [
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKAC",
  "AAQAAAABAAAAEKADAAQAAAABAAAADAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZ",
  "jwCyBOmACZjs+EJ+/8AAEQgADAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB",
  "AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNE",
  "RUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfI",
  "ycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIB",
  "AgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpD",
  "REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG",
  "x8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgK",
  "CgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
  "EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+PfDnwP+5/o/6V754c+B/wBz/R/0r7R8N+Et",
  "D+T9xXvnhvwlony/uK7PHrxjxf7zc+U+jD4+4791v0/rc//Z",
].join("");

/** A 10x14 8-bit truecolour PNG written by `sips`; carries sRGB + eXIf. */
export const TRUECOLOUR_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAOCAIAAACZwRr8AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAAB",
  "AAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACqADAAQAAAABAAAADgAAAADO+B41AAAAHklEQVQYGWP8r8HwnEEE",
  "F2Jh4GfAA0alsQYOTYMFAC4pCvME7i4mAAAAAElFTkSuQmCC",
].join("");

/** A 16x12 single-component (greyscale) baseline JPEG. */
export const GRAYSCALE_JPEG_BASE64 = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwg",
  "IyYnKSopGR8tMC0oMCUoKSj/wAALCAAMABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED",
  "AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF",
  "RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJ",
  "ytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APPtN8JdP3f6V1Wm+Eun7v8ASvRdN0224+Suq03Tbbj5",
  "K//Z",
].join("");

/** A 16x12 four-component JPEG carrying an Adobe APP14 marker (inverted CMYK). */
export const CMYK_JPEG_BASE64 = [
  "/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMm",
  "JykqKRkfLTAtKDAlKCko/8AAFAgADAAQBEMRAE0RAFkRAEsRAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//E",
  "ALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2",
  "Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrC",
  "w8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAA4EQwBNAFkASwAAPwDx/wCG3/LL8K82/wCFZf8ATD9K",
  "7vxJ/HX1TX1X8Nv+WX4Uf8Ky/wCmH6V5T4k/jor5U+G3/LL8K+vf7A0//njXq3iT+Oivqv4bf8svwo/sDT/+eNeU+JP46K//",
  "2Q==",
].join("");

/** A 16x12 PROGRESSIVE (SOF2) JPEG — `/DCTDecode` renders nothing from this. */
export const PROGRESSIVE_JPEG_BASE64 = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwg",
  "IyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo",
  "KCgoKCgoKCgoKCgoKCj/wgARCAAMABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABQb/xAAVAQEBAAAAAAAAAAAA",
  "AAAAAAABA//aAAwDAQACEAMQAAABnlaNVj//xAAXEAEBAQEAAAAAAAAAAAAAAAADAAIE/9oACAEBAAEFAj5I+SM8xnm//8QA",
  "FxEAAwEAAAAAAAAAAAAAAAAAAAIFIf/aAAgBAwEBPwGTSfD/xAAXEQADAQAAAAAAAAAAAAAAAAAAAgQF/9oACAECAQE/AdG5",
  "j//EABYQAQEBAAAAAAAAAAAAAAAAADEAEP/aAAgBAQAGPwIjf//EABYQAQEBAAAAAAAAAAAAAAAAAABREP/aAAgBAQABPyHJ",
  "Jkz/2gAMAwEAAgADAAAAEMv/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EEf/xAAVEQEBAAAAAAAAAAAAAAAAAAAA",
  "If/aAAgBAgEBPxCx/8QAFxABAAMAAAAAAAAAAAAAAAAAACExwf/aAAgBAQABPxCnCnCCwX//2Q==",
].join("");

/** A 16x12 truecolour-with-alpha PNG (colour type 6). */
export const RGBA_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAAJElEQVR4nGNkYDjxX4DhBwO5mIVBlIEiwDJqAMNoGDAMgjAA",
  "ABRgElT5zBd/AAAAAElFTkSuQmCC",
].join("");

/** A 16x12 indexed-colour PNG (colour type 3, bit depth 4). */
export const PALETTE_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMBAMAAACZySCyAAAAMFBMVEXQ0mDQqGCIyIRI0qQQ0sAwqLDQfmCIfoRIfqQQfsDQ",
  "P2CIP4SwC3BIP6QQP8AwC7CuPLETAAAAR0lEQVR4nEWLiwnAIAxEn8EBupTTdpoOoHSCNgNoI9FA7zg47pMM+gWIwq3QsumD",
  "S/jAJQTyaer8E2Fsk8pB9WrdsTfuaxOYq28fjDIBcA0AAAAASUVORK5CYII=",
].join("");

/** A 16x12 greyscale PNG at bit depth 16. */
export const SIXTEEN_BIT_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMEAAAAAAeHL4eAAAAGElEQVR4nGMUmMSAFzDhl2YYVQAFlAcUAA2PALoT7izLAAAA",
  "AElFTkSuQmCC",
].join("");

/** A 16x12 truecolour PNG carrying a tRNS transparency chunk. */
export const TRNS_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAABnRSTlMAAAAAAMj7GU0TAAAAH0lEQVR4nGNkYDghwPCDeMTC",
  "IMpAEmAZ1UAEGA6hBADxmBFVlfsvMwAAAABJRU5ErkJggg==",
].join("");

/** A 4x4 truecolour PNG with Adam7 interlacing (interlace method 1). */
export const INTERLACED_PNG_BASE64 = [
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAFRlDm/AAAAN0lEQVR42g3EsQGAIAADwZ9EtEPsQLuga2WwDChXHLBhOni3",
  "b0TNSm7xCyrSaY1oQg7lcp7k+wE6UA4p2/W62wAAAABJRU5ErkJggg==",
].join("");

/** Decodes a fixture to the exact bytes the encoder wrote. */
export function fixtureBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}


export function syntheticDashboardPngBytes(): Uint8Array {
  const width = 1280;
  const height = 720;
  const scanlineLength = width * 3 + 1;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * scanlineLength;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const rgb = y < 72
        ? [34, 38, 44]
        : x < 240
          ? [246, 242, 235]
          : y < 142
            ? [231, 226, 217]
            : x >= 278 && x < 614 && y >= 180 && y < 324
              ? [214, 225, 218]
              : x >= 644 && x < 980 && y >= 180 && y < 324
                ? [232, 219, 212]
                : x >= 278 && x < 980 && y >= 356 && y < 590
                  ? [223, 224, 226]
                  : [252, 250, 246];
      const pixel = row + 1 + x * 3;
      raw[pixel] = rgb[0];
      raw[pixel + 1] = rgb[1];
      raw[pixel + 2] = rgb[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return Uint8Array.from(png);
}
