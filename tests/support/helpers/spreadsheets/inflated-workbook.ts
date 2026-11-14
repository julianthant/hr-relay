import { once } from 'node:events';
import { crc32, createDeflateRaw } from 'node:zlib';

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
}

/** A one-part xlsx of compressed zeros. The declared size and part name can lie. */
export async function xlsxWithInflatedWorkbookXml(uncompressedBytes: number, declaredUncompressedBytes: number, name = 'xl/workbook.xml'): Promise<ArrayBuffer> {
  const chunk = Buffer.alloc(1024 * 1024, 0);
  const deflator = createDeflateRaw({ level: 9 });
  const compressedParts: Buffer[] = [];
  const reading = (async () => {
    for await (const part of deflator) {
      if (!Buffer.isBuffer(part)) throw new Error('deflate produced a non-binary chunk');
      compressedParts.push(part);
    }
  })();
  let crc = 0;
  let remaining = uncompressedBytes;
  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    const piece = size === chunk.length ? chunk : chunk.subarray(0, size);
    crc = crc32(piece, crc);
    if (!deflator.write(piece)) await once(deflator, 'drain');
    remaining -= size;
  }
  deflator.end();
  await reading;
  const compressed = Buffer.concat(compressedParts);
  const nameBytes = Buffer.from(name);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(declaredUncompressedBytes),
    u16(nameBytes.length), u16(0), nameBytes, compressed,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(declaredUncompressedBytes),
    u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0),
    nameBytes,
  ]);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(local.length), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([local, central, end])).buffer;
}
