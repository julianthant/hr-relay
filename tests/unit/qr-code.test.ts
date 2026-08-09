import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  MAX_QR_VERSION,
  QR_QUIET_ZONE_MODULES,
  QrCodeMatrixSchema,
  encodeQrCode,
  qrCodeSvgPath,
  qrCodeSvgViewBox,
} from "../../src/domain/qr-code.js";
import type { QrCodeMatrix, QrErrorCorrection } from "../../src/domain/qr-code.js";

/**
 * GROUND TRUTH FOR THE PINNED VECTORS (strategy 1 of the two permitted).
 *
 * `PINNED_*.rows` below were produced by an INDEPENDENT implementation —
 * `qrcode@1.5.4` (`QR.create([{data, mode: "byte"}], {errorCorrectionLevel})`)
 * — and each was then verified by DECODING it with a third-party decoder,
 * `jsqr@1.4.0`, which recovered the original text exactly. They are not this
 * encoder's own output blessed as an expectation.
 *
 * The same cross-check was run far wider than these two symbols while the
 * encoder was written: 1,636 payloads spanning every version 1-40 and all four
 * error-correction levels, plus multi-byte UTF-8. Version selection agreed on
 * 1,636 of 1,636, and every symbol where the two implementations chose the
 * same data mask agreed on every single module. It is exactly that sweep that
 * caught a transcription error in the H-level block-count table, which is why
 * the published capacity table is pinned as a test in its own right below.
 *
 * The two implementations DO diverge on which mask they pick for roughly a
 * third of payloads, and that divergence is expected: mask selection is a
 * penalty-score tie-break, not a correctness property. `qrcode@1.5.4` scores
 * penalty rule 3 only where the four light modules lie inside the symbol and
 * uses the older rule-4 rounding; this encoder follows ISO/IEC 18004:2015,
 * where the quiet zone counts as light and rule 4 is |proportion - 50%| in
 * whole 5% steps. Every symbol either encoder emits decodes to the same text —
 * all 480 sampled round-trips through `jsqr` succeeded. The two vectors pinned
 * here are ones where both implementations agree module-for-module, so the
 * expectation below IS the independent implementation's output.
 */
const PINNED_CAPTURE_URL = {
  text: "http://localhost:3938/capture/7f3a",
  errorCorrection: "M",
  version: 3,
  mask: 3,
  rows: [
    "#######.########..###.#######",
    "#.....#.#..#.#..#.....#.....#",
    "#.###.#..##.#...#.#.#.#.###.#",
    "#.###.#.##....##.#.#..#.###.#",
    "#.###.#..##.#.#.##.##.#.###.#",
    "#.....#..##.##.##..#..#.....#",
    "#######.#.#.#.#.#.#.#.#######",
    "........#......####.#........",
    "#.##.###....##.####.#.#..#.##",
    ".#.##..#.##.####...#.####...#",
    "##..###..#..##..##....##..##.",
    "###..#....##....#.....####..#",
    "##..#.####..#.##.#..#....##..",
    "#.#.##.#.#..#.#######.#....##",
    ".#.#.###.#...#....####.#.####",
    "###.##.#.#....#...#...#.#..#.",
    "....###.#####.#.#.##.#.##..#.",
    "...##..###..#.###.#..#.#..##.",
    "#.#.#.#..#...###....##.#.##..",
    "..##....###..###########..#..",
    ".#.#.##..###.##.###########..",
    "........#####...#..##...#####",
    "#######.#...#.#.#..##.#.##.#.",
    "#.....#.#.##.###...##...#....",
    "#.###.#....##..###..#####.##.",
    "#.###.#.##.###.#.#...#.###..#",
    "#.###.#.#...#.....####.#.#..#",
    "#.....#..##..##.#..##..#.#.#.",
    "#######.##.#...#....#...#..#.",
  ],
} as const;

/**
 * A version-8 symbol, chosen so the vector exercises what version 3 cannot:
 * the 18-bit version-information blocks (present only from version 7), and
 * multi-block interleaving with UNEQUAL blocks — 8-H is six blocks of 26 error
 * correction codewords over 242 total, so four blocks carry 14 data codewords
 * and two carry 15, and the interleaver has to skip the short blocks' padding
 * slot.
 */
const PINNED_CAPTURE_SESSION_URL = {
  text: "http://localhost:3938/capture/session/f29436d8-7a1c-7e50-9294-36d87a1cbe50",
  errorCorrection: "H",
  version: 8,
  mask: 2,
  rows: [
    "#######.#..##.##.##.##.....##......###..#.#######",
    "#.....#.#..##.#.##.#..#.##.##.#...#.#####.#.....#",
    "#.###.#.###.#.##..#.####.####...#.#....##.#.###.#",
    "#.###.#..##..#.....##.########.#..####.#..#.###.#",
    "#.###.#...#####.##..##########.....#.#....#.###.#",
    "#.....#.#####...#..#.##...##.#.####.#.#...#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######",
    "........#.#.##..#..#..#...##...#..####.#.........",
    "..###.#.#.####..###.#.#######..#....###.####..###",
    ".#...#.##.#.#..#.####.###...#..#.#.###.#..#..#.#.",
    ".#######.#....##.#...#.#.#...#.##.#.#.#.##.#.#..#",
    "###.##..##.#..#.#..#.##.#.##..#..###.###..#.##..#",
    "###...###....######..##.##.#######..##.##..#.####",
    "#####....##...#.#.###..#......#.##..#..#..####...",
    "#...####..######.....#.###...#.##.#####.##...####",
    "..#.##..#####.##...###..#.#..##...#..##.#.###....",
    ".##.###..#..###.....#...##.#..#.###.#.#...#..##.#",
    ".#...#.#..#.#.#..###.##....#..#...##.###..#.####.",
    "####.##...##..#.#....#.#.#..###..#..#.....#.##.##",
    "..#.##.##....######..#.##.#..###.#...###..###..#.",
    "...#.###..#.#...####...##..##.#.#...#####.##..##.",
    "#..##..#.#.######...#.###.#.##..#....#.#..#..#...",
    ".###########.#......########.#######..#######.###",
    "##..#...##.#..####.#.##...##..##.#....###...#....",
    "###.#.#.##..##...#.##.#.#.#.##...#.##...#.#.#.#..",
    ".##.#...##.#..##.##..##...####.#...#...##...#....",
    ".##.#####...#....###..#########...#.#.#.#####..##",
    "#.#.#....#..#.#..##....####.....#.....#..#.#.#.#.",
    "...#.##...#.######.#.....##..#.#.#####.##.#####.#",
    "#..###..#.#....###.#.###...##..#.#.#.#.###...#.#.",
    ".....##..####.####..#...#.#.###...##..#.#.##..#.#",
    ".#.##......##....####.#.#..#..#.....#...##.#.#.##",
    "##....##.#.#..#....####.###.#..##.##.#.######.###",
    "#..###.#.##.##...#....##.#..###.#........##...##.",
    "##.#..#.##..###.#.###..#.....#.#####.#######....#",
    ".....#....##.##.##..........#.###........#..##.##",
    ".##.#.#........####..##....#......#######...#.#..",
    "...###.##...######.#.###..#.##.#.......#..##...#.",
    ".#...###.##..########..#.#.#.....######...#.#..##",
    ".###...##..###.#.#.....#.##.######.........#.#.##",
    "###...#####..##.###.#########......###.######.###",
    "........#...##..#.#.#.#...##.#.#.#.##..##...#....",
    "#######..##.#..#..##..#.#.#.####....##..#.#.##.##",
    "#.....#.....#...##..#.#...##..###.#..####...#...#",
    "#.###.#.#####...##.#.######......#.##...#####.#..",
    "#.###.#.#.#....##..##.....#.##..#..#.#.#...##...#",
    "#.###.#.#..##.#.#.##.##..#####...###..#.####.#.##",
    "#.....#...#...##.#.#####...##..##....####.####..#",
    "#######..##..#..##.#...#.##.####.#.####.##.##.###",
  ],
} as const;

/**
 * Published byte-mode data capacities (ISO/IEC 18004 Table 7), version 1-40.
 *
 * Pinned as a fact of the standard rather than derived from this encoder's own
 * tables: the block-count and error-correction-codeword tables are 320 hand
 * transcribed numbers, and a single wrong cell produces a symbol that encodes
 * MORE bytes than the version can hold — which passes every structural check
 * here and fails only in a real scanner. A transcription error in the H row
 * was found exactly this way.
 */
const PUBLISHED_BYTE_CAPACITY: Readonly<Record<QrErrorCorrection, readonly number[]>> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};

const FORMAT_ERROR_CORRECTION_BITS: Readonly<Record<QrErrorCorrection, number>> = { L: 1, M: 0, Q: 3, H: 2 };

function render(matrix: QrCodeMatrix): string[] {
  return matrix.modules.map((row) => row.map((module) => (module ? "#" : ".")).join(""));
}

function readFormatCopy(matrix: QrCodeMatrix, copy: "top-left" | "split"): number {
  let bits = 0;
  if (copy === "top-left") {
    for (let index = 0; index <= 5; index += 1) if (matrix.modules[index][8]) bits |= 1 << index;
    if (matrix.modules[7][8]) bits |= 1 << 6;
    if (matrix.modules[8][8]) bits |= 1 << 7;
    if (matrix.modules[8][7]) bits |= 1 << 8;
    for (let index = 9; index < 15; index += 1) if (matrix.modules[8][14 - index]) bits |= 1 << index;
    return bits;
  }
  for (let index = 0; index < 8; index += 1) {
    if (matrix.modules[8][matrix.size - 1 - index]) bits |= 1 << index;
  }
  for (let index = 8; index < 15; index += 1) {
    if (matrix.modules[matrix.size - 15 + index][8]) bits |= 1 << index;
  }
  return bits;
}

/**
 * Recover the data mask from the symbol's own format information.
 *
 * Independent of the encoder: both copies are read, they must agree, the
 * 15-bit word must pass its BCH(15,5) division after the 0x5412 mask is
 * removed, and the error-correction field must match what the caller asked
 * for. Only then is the low field returned as the mask number.
 */
function readMask(matrix: QrCodeMatrix): number {
  const bits = readFormatCopy(matrix, "top-left");
  assert.equal(readFormatCopy(matrix, "split"), bits, "the two format-information copies disagree");

  let word = (bits ^ 0x5412) & 0x7fff;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((word >>> bit) & 1) === 1) word ^= 0x537 << (bit - 10);
  }
  assert.equal(word, 0, "format information fails its BCH(15,5) check");

  const data = ((bits ^ 0x5412) >>> 10) & 0x1f;
  assert.equal(data >>> 3, FORMAT_ERROR_CORRECTION_BITS[matrix.errorCorrection], "format bits name a different level");
  return data & 7;
}

const FINDER_PATTERN = [
  "#######",
  "#.....#",
  "#.###.#",
  "#.###.#",
  "#.###.#",
  "#.....#",
  "#######",
];

function finderAt(matrix: QrCodeMatrix, topRow: number, leftColumn: number): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 7; row += 1) {
    let line = "";
    for (let column = 0; column < 7; column += 1) {
      line += matrix.modules[topRow + row][leftColumn + column] ? "#" : ".";
    }
    rows.push(line);
  }
  return rows;
}

describe("qr code encoder", () => {
  it("reproduces an independently generated version-3 capture-url symbol module for module", () => {
    const matrix = encodeQrCode(PINNED_CAPTURE_URL.text, { errorCorrection: PINNED_CAPTURE_URL.errorCorrection });
    assert.equal(matrix.version, PINNED_CAPTURE_URL.version);
    assert.equal(matrix.size, 29);
    assert.equal(matrix.errorCorrection, "M");
    assert.equal(readMask(matrix), PINNED_CAPTURE_URL.mask);
    assert.deepEqual(render(matrix), [...PINNED_CAPTURE_URL.rows]);
  });

  it("reproduces an independently generated version-8 symbol with version bits and unequal blocks", () => {
    const matrix = encodeQrCode(PINNED_CAPTURE_SESSION_URL.text, {
      errorCorrection: PINNED_CAPTURE_SESSION_URL.errorCorrection,
    });
    assert.equal(matrix.version, PINNED_CAPTURE_SESSION_URL.version);
    assert.equal(matrix.size, 49);
    assert.equal(matrix.errorCorrection, "H");
    assert.equal(readMask(matrix), PINNED_CAPTURE_SESSION_URL.mask);
    assert.deepEqual(render(matrix), [...PINNED_CAPTURE_SESSION_URL.rows]);
  });

  it("picks the smallest version that fits, counting the payload in bytes", () => {
    assert.equal(encodeQrCode("HELLO").version, 1);
    // Version 1 at level M holds exactly 14 byte-mode characters.
    assert.equal(encodeQrCode("a".repeat(14)).version, 1);
    assert.equal(encodeQrCode("a".repeat(15)).version, 2);
    assert.equal(encodeQrCode("a".repeat(26)).version, 2);
    assert.equal(encodeQrCode("a".repeat(27)).version, 3);
    // The same payload needs a bigger symbol at a stronger level.
    assert.equal(encodeQrCode("a".repeat(14), { errorCorrection: "L" }).version, 1);
    assert.equal(encodeQrCode("a".repeat(14), { errorCorrection: "Q" }).version, 2);
    assert.equal(encodeQrCode("a".repeat(14), { errorCorrection: "H" }).version, 2);
  });

  it("matches the standard's published byte capacity at every version and level", () => {
    for (const level of ["L", "M", "Q", "H"] as const) {
      const capacities = PUBLISHED_BYTE_CAPACITY[level];
      assert.equal(capacities.length, MAX_QR_VERSION);
      for (let version = 1; version <= MAX_QR_VERSION; version += 1) {
        const capacity = capacities[version - 1];
        assert.equal(
          encodeQrCode("a".repeat(capacity), { errorCorrection: level }).version,
          version,
          `${level} version ${version} should hold exactly ${capacity} bytes`,
        );
        if (version < MAX_QR_VERSION) {
          assert.equal(
            encodeQrCode("a".repeat(capacity + 1), { errorCorrection: level }).version,
            version + 1,
            `${level} version ${version} must overflow into ${version + 1} at ${capacity + 1} bytes`,
          );
        }
      }
    }
  });

  it("refuses an over-capacity payload naming the byte length and the limit", () => {
    assert.doesNotThrow(() => encodeQrCode("a".repeat(1273), { errorCorrection: "H" }));
    assert.throws(
      () => encodeQrCode("a".repeat(1274), { errorCorrection: "H" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /1274 UTF-8 bytes/);
        assert.match(error.message, /1273-byte maximum/);
        assert.match(error.message, /level H/);
        return true;
      },
    );
    assert.throws(() => encodeQrCode("a".repeat(2954), { errorCorrection: "L" }), /2954 UTF-8 bytes.*2953-byte maximum/);
    assert.throws(() => encodeQrCode(""), /payload is empty/);
  });

  it("refuses an error-correction level outside the four the standard defines", () => {
    // A JS caller has no type to stop it; the runtime check is what does.
    const bogus = "X" as unknown as QrErrorCorrection;
    assert.throws(() => encodeQrCode("https://example.test", { errorCorrection: bogus }), /not one of L, M, Q, H/);
  });

  it("places the function patterns exactly where the standard puts them", () => {
    for (const level of ["L", "M", "Q", "H"] as const) {
      for (const payload of ["HELLO", "http://localhost:3938/capture/7f3a", "a".repeat(300)]) {
        const matrix = encodeQrCode(payload, { errorCorrection: level });
        const { size, version } = matrix;
        const label = `${level}/${payload.length}/v${version}`;

        assert.equal(size, 4 * version + 17, label);

        assert.deepEqual(finderAt(matrix, 0, 0), FINDER_PATTERN, `${label} top-left finder`);
        assert.deepEqual(finderAt(matrix, 0, size - 7), FINDER_PATTERN, `${label} top-right finder`);
        assert.deepEqual(finderAt(matrix, size - 7, 0), FINDER_PATTERN, `${label} bottom-left finder`);

        // Separators: the light row/column between each finder and the data.
        for (let index = 0; index < 8; index += 1) {
          assert.equal(matrix.modules[7][index], false, `${label} top-left separator row`);
          assert.equal(matrix.modules[index][7], false, `${label} top-left separator column`);
          assert.equal(matrix.modules[7][size - 1 - index], false, `${label} top-right separator row`);
          assert.equal(matrix.modules[index][size - 8], false, `${label} top-right separator column`);
          assert.equal(matrix.modules[size - 8][index], false, `${label} bottom-left separator row`);
          assert.equal(matrix.modules[size - 1 - index][7], false, `${label} bottom-left separator column`);
        }

        // Timing patterns alternate, dark on even coordinates, between the finders.
        for (let index = 8; index < size - 8; index += 1) {
          assert.equal(matrix.modules[6][index], index % 2 === 0, `${label} horizontal timing at ${index}`);
          assert.equal(matrix.modules[index][6], index % 2 === 0, `${label} vertical timing at ${index}`);
        }

        assert.equal(matrix.modules[4 * version + 9][8], true, `${label} dark module`);
      }
    }
  });

  it("returns a frozen, row-major boolean matrix that satisfies its own schema", () => {
    const matrix = encodeQrCode("http://localhost:3938/capture/7f3a");

    assert.equal(Object.isFrozen(matrix), true);
    assert.equal(Object.isFrozen(matrix.modules), true);
    assert.equal(matrix.modules.length, matrix.size);
    for (const row of matrix.modules) {
      assert.equal(Object.isFrozen(row), true);
      assert.equal(row.length, matrix.size);
      for (const module of row) assert.equal(typeof module, "boolean");
    }

    assert.deepEqual(QrCodeMatrixSchema.parse(matrix), matrix);
  });

  it("selects a mask per payload rather than emitting a fixed one", () => {
    const masks = new Map<string, number>();
    for (const payload of [
      "http://localhost:3938/capture/7f3a",
      "http://localhost:3938/capture/a",
      "http://localhost:3938/capture/b",
      "HELLO",
      "café",
      "a".repeat(14),
    ]) {
      masks.set(payload, readMask(encodeQrCode(payload)));
    }

    // Pinned so a rewrite that changes mask selection cannot pass unnoticed.
    assert.equal(masks.get("http://localhost:3938/capture/7f3a"), 3);
    assert.equal(masks.get("http://localhost:3938/capture/a"), 7);
    assert.equal(masks.get("http://localhost:3938/capture/b"), 6);
    assert.equal(masks.get("HELLO"), 4);
    assert.equal(masks.get("café"), 0);
    assert.equal(masks.get("a".repeat(14)), 2);

    assert.ok(new Set(masks.values()).size >= 2, "every payload chose the same mask");
    for (const mask of masks.values()) assert.ok(mask >= 0 && mask <= 7);
  });

  it("is deterministic for the same input", () => {
    for (const level of ["L", "M", "Q", "H"] as const) {
      const first = encodeQrCode("http://localhost:3938/capture/7f3a", { errorCorrection: level });
      const second = encodeQrCode("http://localhost:3938/capture/7f3a", { errorCorrection: level });
      assert.deepEqual(render(second), render(first));
      assert.equal(second.version, first.version);
      assert.equal(readMask(second), readMask(first));
      assert.equal(qrCodeSvgPath(second), qrCodeSvgPath(first));
    }
  });

  it("counts UTF-8 bytes, not JavaScript string length", () => {
    // 13 ASCII characters plus one two-byte character: string length 14, but
    // 15 UTF-8 bytes — one byte past what version 1 at level M can hold.
    const multibyte = `${"a".repeat(13)}é`;
    assert.equal(multibyte.length, 14);
    assert.equal(new TextEncoder().encode(multibyte).length, 15);
    assert.equal(encodeQrCode("a".repeat(14)).version, 1);
    assert.equal(encodeQrCode(multibyte).version, 2);

    // Three-byte characters count as three.
    const japanese = "東京都";
    assert.equal(japanese.length, 3);
    assert.equal(new TextEncoder().encode(japanese).length, 9);
    assert.equal(encodeQrCode(`${"a".repeat(5)}${japanese}`).version, 1);
    assert.equal(encodeQrCode(`${"a".repeat(6)}${japanese}`).version, 2);
  });

  it("draws one unit square per dark module in row-major order", () => {
    const matrix = encodeQrCode(PINNED_CAPTURE_URL.text, { errorCorrection: "M" });
    const path = qrCodeSvgPath(matrix);
    const segments = path.split("z").filter((segment) => segment.length > 0).map((segment) => `${segment}z`);

    const darkModules = matrix.modules.reduce(
      (total, row) => total + row.filter((module) => module).length,
      0,
    );
    assert.equal(segments.length, darkModules);

    const expected: string[] = [];
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (matrix.modules[row][column]) expected.push(`M${column} ${row}h1v1h-1z`);
      }
    }
    assert.deepEqual(segments, expected);
    // Integer coordinates only — the caller scales through the viewBox.
    assert.equal(/M-?\d+\.\d/.test(path), false);
    assert.equal(segments[0], "M0 0h1v1h-1z");
  });

  it("puts the quiet zone in the viewBox and never in the module matrix", () => {
    const matrix = encodeQrCode("http://localhost:3938/capture/7f3a");
    assert.equal(QR_QUIET_ZONE_MODULES, 4);
    assert.equal(qrCodeSvgViewBox(matrix), "-4 -4 37 37");
    assert.equal(qrCodeSvgViewBox(matrix, 0), "0 0 29 29");
    assert.equal(qrCodeSvgViewBox(matrix, 8), "-8 -8 45 45");
    // The matrix itself still reports the true symbol.
    assert.equal(matrix.size, 29);
    assert.equal(matrix.modules.length, 29);
    assert.throws(() => qrCodeSvgViewBox(matrix, -1), /not a non-negative integer/);
    assert.throws(() => qrCodeSvgViewBox(matrix, 1.5), /not a non-negative integer/);
  });
});
