import { z } from "zod";
import { deepFreeze } from "./immutability.js";

/**
 * A pure, browser-safe QR Code (ISO/IEC 18004) encoder.
 *
 * 2i-F renders a capture-session URL as a scannable code so an operator can
 * move a phone onto the session without retyping an opaque id. That makes the
 * encoder BROWSER-REACHABLE: the dashboard bundle imports it, so this module
 * may value-import nothing but `zod` and this repo's own pure domain helpers.
 * A `node:*` import here is a latent production bug — Vite replaces an
 * externalized built-in with a proxy that throws at module evaluation, so the
 * dev server dies with a blank page while the production build only warns (see
 * the 2026-08-04 lesson in CLAUDE.md). `dashboard-wire-boundary.test.ts` walks
 * the bundle's import closure and fails on any Node built-in.
 *
 * **Byte mode only, and that is a decision, not a shortcut.** The payload is an
 * ASCII/UTF-8 URL. Numeric/alphanumeric/kanji modes would pack a few URLs into
 * a smaller symbol, but mode selection is where an encoder silently changes
 * what it encodes (alphanumeric mode uppercases nothing — it simply cannot
 * represent a lowercase host, so a segment optimizer that guesses wrong emits a
 * code that scans to a DIFFERENT url). One mode, always, keeps the mapping from
 * text to modules total and auditable.
 *
 * **Nothing here degrades gracefully.** If the payload does not fit the largest
 * symbol at the requested error-correction level, this throws naming the byte
 * length and the limit; it never truncates, never silently drops to a weaker
 * error-correction level, and never picks a different version than the one the
 * input requires. A QR code that encodes *most* of a URL is indistinguishable
 * at a glance from one that encodes all of it, and the operator finds out by
 * landing on a 404 — the exact silent-wrong-value failure this tree bans.
 *
 * The exported matrix type is derived from `QrCodeMatrixSchema` rather than
 * declared as a bare `interface` because `strict-boundary-schemas.test.ts`
 * requires every exported domain type to carry a schema; the shape is the plain
 * `{size, version, errorCorrection, modules}` record either way.
 *
 * The quiet zone is deliberately NOT baked into `size`/`modules`: the matrix
 * reports the true symbol, and the renderer adds the margin (see
 * `qrCodeSvgViewBox`). Folding a 4-module border into the module grid would
 * make every structural assertion — finder-pattern corners, timing rows, the
 * dark module at `(4 * version + 9, 8)` — off by four forever.
 */

export const QrErrorCorrectionSchema = z.enum(["L", "M", "Q", "H"]);
export type QrErrorCorrection = z.infer<typeof QrErrorCorrectionSchema>;

/** Symbol versions defined by the standard; both bounds are inclusive. */
export const MIN_QR_VERSION = 1;
export const MAX_QR_VERSION = 40;

/**
 * The standard's minimum light border around a symbol, in modules.
 *
 * ISO/IEC 18004 §6.3.8 requires four modules of light on all four sides. A
 * decoder that cannot find the border cannot lock the finder patterns, so a
 * renderer that skips it produces a picture of a QR code that does not scan.
 */
export const QR_QUIET_ZONE_MODULES = 4;

export const QrCodeMatrixSchema = z.strictObject({
  /** Modules per side; always `4 * version + 17`. */
  size: z.number().int().min(21).max(177),
  version: z.number().int().min(MIN_QR_VERSION).max(MAX_QR_VERSION),
  errorCorrection: QrErrorCorrectionSchema,
  /** Row-major; `true` is a dark module. Frozen. */
  modules: z.array(z.array(z.boolean()).readonly()).readonly(),
}).readonly();

export type QrCodeMatrix = z.infer<typeof QrCodeMatrixSchema>;

/** Byte mode (0100) — see the header on why this encoder emits no other mode. */
const BYTE_MODE_INDICATOR = 0b0100;

/** The two alternating pad codewords appended after the terminator (§7.4.10). */
const PAD_CODEWORDS = [0xec, 0x11] as const;

/** GF(256) primitive modulus x^8 + x^4 + x^3 + x^2 + 1. */
const GF_MODULUS = 0x11d;

/** BCH(15,5) generator for format information, and its final XOR mask (§7.9.1). */
const FORMAT_BCH_GENERATOR = 0x537;
const FORMAT_BCH_MASK = 0x5412;

/** BCH(18,6) generator for version information, versions 7 and up (§7.10). */
const VERSION_BCH_GENERATOR = 0x1f25;

/**
 * Format-information bits per error-correction level (§7.9.1 Table 12).
 *
 * Deliberately NOT the declaration order: the standard assigns M=00, L=01,
 * H=10, Q=11, and reading these off an "obvious" enum ordinal is the classic
 * way to emit a symbol whose format bits disagree with its own error
 * correction — every scanner then de-masks with the wrong pattern.
 */
const FORMAT_BITS: Readonly<Record<QrErrorCorrection, number>> = Object.freeze({
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
});

/**
 * Error-correction codewords per block, indexed `[level][version]` (§7.5 Table 13-22).
 *
 * Index 0 of each row is unused padding so versions stay 1-based — the whole
 * module reads `version` straight out of the standard's tables, and re-basing
 * it here is how an off-by-one enters a table nobody re-derives.
 */
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<QrErrorCorrection, readonly number[]>> = Object.freeze({
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
});

/** Error-correction block count, indexed `[level][version]` (§7.5 Table 13-22). */
const ERROR_CORRECTION_BLOCKS: Readonly<Record<QrErrorCorrection, readonly number[]>> = Object.freeze({
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
});

/** Mask-selection penalty weights N1..N4 (§7.8.3 Table 24). */
const PENALTY_SAME_COLOR_RUN = 3;
const PENALTY_SAME_COLOR_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_DARK_PROPORTION = 10;

/** The eight data-mask patterns (§7.8.2 Table 23), indexed by mask number. */
const MASK_PREDICATES: readonly ((row: number, column: number) => boolean)[] = Object.freeze([
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
]);

/**
 * A symbol under construction.
 *
 * `isFunction` is not derivable from `modules` after the fact — a function
 * module and a data module can hold the same colour — so the two grids are
 * carried together and every write goes through one of the helpers below.
 * Internal, so no boundary schema applies.
 */
interface QrCanvas {
  readonly size: number;
  readonly version: number;
  readonly errorCorrection: QrErrorCorrection;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function appendBits(value: number, length: number, bits: number[]): void {
  if (!Number.isInteger(length) || length < 0 || length > 31) {
    throw new Error(`QR bit append refused: length ${length} is not an integer in 0..31.`);
  }
  if (value >>> length !== 0) {
    throw new Error(`QR bit append refused: value ${value} does not fit in ${length} bits.`);
  }
  for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
}

/** Total modules available to data and error correction, before codeword split (§7.5). */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignmentCount = Math.floor(version / 7) + 2;
    modules -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version: number, errorCorrection: QrErrorCorrection): number {
  return totalCodewords(version)
    - ECC_CODEWORDS_PER_BLOCK[errorCorrection][version] * ERROR_CORRECTION_BLOCKS[errorCorrection][version];
}

/** Byte-mode character-count indicator width (§7.4.1 Table 3). */
function characterCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Row/column centres of the alignment patterns for a version (§7.3.5 Annex E). */
function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  // Version 32 is the standard's one irregular entry; the general formula
  // yields 28 there, which puts a pattern off the symbol.
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

function reedSolomonMultiply(left: number, right: number): number {
  let product = 0;
  for (let index = 7; index >= 0; index -= 1) {
    product = (product << 1) ^ ((product >>> 7) * GF_MODULUS);
    product ^= ((right >>> index) & 1) * left;
  }
  return product;
}

/** Coefficients of the degree-`degree` generator polynomial, highest power first. */
function reedSolomonDivisor(degree: number): number[] {
  const divisor = new Array<number>(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    for (let index = 0; index < degree; index += 1) {
      divisor[index] = reedSolomonMultiply(divisor[index], root);
      if (index + 1 < degree) divisor[index] ^= divisor[index + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return divisor;
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const remainder = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < remainder.length; index += 1) {
      remainder[index] ^= reedSolomonMultiply(divisor[index], factor);
    }
  }
  return remainder;
}

/**
 * Split the data codewords into blocks, append each block's error correction,
 * and interleave the result in the standard's transmission order (§7.6).
 *
 * Short blocks carry one fewer data codeword than long blocks. The padding
 * pushed onto a short block is a placeholder that keeps the interleave loop
 * rectangular; it is skipped on the way out, never transmitted.
 */
function addErrorCorrectionAndInterleave(
  data: readonly number[],
  version: number,
  errorCorrection: QrErrorCorrection,
): number[] {
  const blockCount = ERROR_CORRECTION_BLOCKS[errorCorrection][version];
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[errorCorrection][version];
  const rawCodewords = totalCodewords(version);
  const shortBlockCount = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);

  const divisor = reedSolomonDivisor(blockEccLength);
  const blocks: number[][] = [];
  let consumed = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const length = shortBlockLength - blockEccLength + (index < shortBlockCount ? 0 : 1);
    const block = data.slice(consumed, consumed + length);
    consumed += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (index < shortBlockCount) block.push(0);
    blocks.push([...block, ...ecc]);
  }

  const interleaved: number[] = [];
  for (let index = 0; index < blocks[0].length; index += 1) {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const isShortBlockPad = index === shortBlockLength - blockEccLength && blockIndex < shortBlockCount;
      if (!isShortBlockPad) interleaved.push(blocks[blockIndex][index]);
    }
  }
  return interleaved;
}

function createCanvas(version: number, errorCorrection: QrErrorCorrection): QrCanvas {
  const size = version * 4 + 17;
  const build = (): boolean[][] =>
    Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, version, errorCorrection, modules: build(), isFunction: build() };
}

function setFunctionModule(canvas: QrCanvas, column: number, row: number, isDark: boolean): void {
  canvas.modules[row][column] = isDark;
  canvas.isFunction[row][column] = true;
}

function drawFinderPattern(canvas: QrCanvas, column: number, row: number): void {
  for (let deltaRow = -4; deltaRow <= 4; deltaRow += 1) {
    for (let deltaColumn = -4; deltaColumn <= 4; deltaColumn += 1) {
      const distance = Math.max(Math.abs(deltaColumn), Math.abs(deltaRow));
      const targetColumn = column + deltaColumn;
      const targetRow = row + deltaRow;
      if (targetColumn < 0 || targetColumn >= canvas.size || targetRow < 0 || targetRow >= canvas.size) continue;
      // Ring distances 2 and 4 are light: 4 is the separator, 2 the inner gap.
      setFunctionModule(canvas, targetColumn, targetRow, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(canvas: QrCanvas, column: number, row: number): void {
  for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
    for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) {
      const distance = Math.max(Math.abs(deltaColumn), Math.abs(deltaRow));
      setFunctionModule(canvas, column + deltaColumn, row + deltaRow, distance !== 1);
    }
  }
}

/** Both copies of the 15-bit format information for a given mask (§7.9). */
function drawFormatBits(canvas: QrCanvas, mask: number): void {
  const data = (FORMAT_BITS[canvas.errorCorrection] << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * FORMAT_BCH_GENERATOR);
  }
  const bits = (((data << 10) | remainder) ^ FORMAT_BCH_MASK) >>> 0;

  for (let index = 0; index <= 5; index += 1) setFunctionModule(canvas, 8, index, getBit(bits, index));
  setFunctionModule(canvas, 8, 7, getBit(bits, 6));
  setFunctionModule(canvas, 8, 8, getBit(bits, 7));
  setFunctionModule(canvas, 7, 8, getBit(bits, 8));
  for (let index = 9; index < 15; index += 1) setFunctionModule(canvas, 14 - index, 8, getBit(bits, index));

  for (let index = 0; index < 8; index += 1) {
    setFunctionModule(canvas, canvas.size - 1 - index, 8, getBit(bits, index));
  }
  for (let index = 8; index < 15; index += 1) {
    setFunctionModule(canvas, 8, canvas.size - 15 + index, getBit(bits, index));
  }
  // The standard's always-dark module, at (row 4 * version + 9, column 8).
  setFunctionModule(canvas, 8, canvas.size - 8, true);
}

/** Both copies of the 18-bit version information; versions 1-6 carry none (§7.10). */
function drawVersionBits(canvas: QrCanvas): void {
  if (canvas.version < 7) return;
  let remainder = canvas.version;
  for (let step = 0; step < 12; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * VERSION_BCH_GENERATOR);
  }
  const bits = ((canvas.version << 12) | remainder) >>> 0;
  for (let index = 0; index < 18; index += 1) {
    const isDark = getBit(bits, index);
    const far = canvas.size - 11 + (index % 3);
    const near = Math.floor(index / 3);
    setFunctionModule(canvas, far, near, isDark);
    setFunctionModule(canvas, near, far, isDark);
  }
}

function drawFunctionPatterns(canvas: QrCanvas): void {
  for (let index = 0; index < canvas.size; index += 1) {
    setFunctionModule(canvas, 6, index, index % 2 === 0);
    setFunctionModule(canvas, index, 6, index % 2 === 0);
  }

  drawFinderPattern(canvas, 3, 3);
  drawFinderPattern(canvas, canvas.size - 4, 3);
  drawFinderPattern(canvas, 3, canvas.size - 4);

  const positions = alignmentPatternPositions(canvas.version);
  const last = positions.length - 1;
  for (let rowIndex = 0; rowIndex < positions.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < positions.length; columnIndex += 1) {
      const overlapsFinder = (rowIndex === 0 && columnIndex === 0)
        || (rowIndex === 0 && columnIndex === last)
        || (rowIndex === last && columnIndex === 0);
      if (!overlapsFinder) drawAlignmentPattern(canvas, positions[columnIndex], positions[rowIndex]);
    }
  }

  // Mask 0 is a placeholder here; the real format bits are written once the
  // penalty comparison has chosen a mask.
  drawFormatBits(canvas, 0);
  drawVersionBits(canvas);
}

/**
 * Right-hand column of each two-module-wide zig-zag strip, right to left.
 *
 * Column 6 is the vertical timing pattern, so the strip that would straddle it
 * shifts one column left AND the walk continues from the shifted position —
 * stepping by two from the unshifted column would revisit one strip and drop
 * the leftmost one entirely.
 */
function zigZagStripColumns(size: number): number[] {
  const columns: number[] = [];
  let right = size - 1;
  while (right >= 1) {
    const rightColumn = right === 6 ? 5 : right;
    columns.push(rightColumn);
    right = rightColumn - 2;
  }
  return columns;
}

/** Two-module-wide zig-zag placement, upward then downward, skipping function modules (§7.7.3). */
function drawCodewords(canvas: QrCanvas, codewords: readonly number[]): void {
  let bitIndex = 0;
  for (const rightColumn of zigZagStripColumns(canvas.size)) {
    for (let vertical = 0; vertical < canvas.size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const column = rightColumn - offset;
        const upward = ((rightColumn + 1) & 2) === 0;
        const row = upward ? canvas.size - 1 - vertical : vertical;
        if (canvas.isFunction[row][column] || bitIndex >= codewords.length * 8) continue;
        canvas.modules[row][column] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
        bitIndex += 1;
      }
    }
  }
  if (bitIndex !== codewords.length * 8) {
    throw new Error(
      `QR placement consumed ${bitIndex} of ${codewords.length * 8} bits at version ${canvas.version}; the symbol geometry and codeword count disagree.`,
    );
  }
}

/** XOR the mask over every non-function module; applying it twice restores the symbol. */
function applyMask(canvas: QrCanvas, mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask >= MASK_PREDICATES.length) {
    throw new Error(`QR mask ${mask} is not one of the eight defined patterns.`);
  }
  const predicate = MASK_PREDICATES[mask];
  for (let row = 0; row < canvas.size; row += 1) {
    for (let column = 0; column < canvas.size; column += 1) {
      if (canvas.isFunction[row][column]) continue;
      canvas.modules[row][column] = canvas.modules[row][column] !== predicate(row, column);
    }
  }
}

/**
 * The finder-like-pattern detector of penalty rule 3.
 *
 * `history` holds the most recent seven run lengths, newest first; the
 * 1:1:3:1:1 core plus four modules of light on either side is what a decoder
 * would mistake for a finder pattern.
 */
function finderPenaltyCount(history: readonly number[]): number {
  const unit = history[1];
  const core = unit > 0
    && history[2] === unit
    && history[3] === unit * 3
    && history[4] === unit
    && history[5] === unit;
  return (core && history[0] >= unit * 4 && history[6] >= unit ? 1 : 0)
    + (core && history[6] >= unit * 4 && history[0] >= unit ? 1 : 0);
}

function finderPenaltyAddHistory(runLength: number, history: number[], size: number): void {
  // An empty history means this is the first run on the line, which the light
  // border extends.
  const extended = history[0] === 0 ? runLength + size : runLength;
  history.pop();
  history.unshift(extended);
}

function finderPenaltyTerminate(isDarkRun: boolean, runLength: number, history: number[], size: number): number {
  let pending = runLength;
  if (isDarkRun) {
    finderPenaltyAddHistory(pending, history, size);
    pending = 0;
  }
  finderPenaltyAddHistory(pending + size, history, size);
  return finderPenaltyCount(history);
}

/** Penalty rules 1-4 (§7.8.3); the mask with the lowest total is the one emitted. */
function penaltyScore(canvas: QrCanvas): number {
  const { size, modules } = canvas;
  let score = 0;

  for (let row = 0; row < size; row += 1) {
    let runIsDark = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let column = 0; column < size; column += 1) {
      if (modules[row][column] === runIsDark) {
        runLength += 1;
        if (runLength === 5) score += PENALTY_SAME_COLOR_RUN;
        else if (runLength > 5) score += 1;
      } else {
        finderPenaltyAddHistory(runLength, history, size);
        if (!runIsDark) score += finderPenaltyCount(history) * PENALTY_FINDER_LIKE;
        runIsDark = modules[row][column];
        runLength = 1;
      }
    }
    score += finderPenaltyTerminate(runIsDark, runLength, history, size) * PENALTY_FINDER_LIKE;
  }

  for (let column = 0; column < size; column += 1) {
    let runIsDark = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let row = 0; row < size; row += 1) {
      if (modules[row][column] === runIsDark) {
        runLength += 1;
        if (runLength === 5) score += PENALTY_SAME_COLOR_RUN;
        else if (runLength > 5) score += 1;
      } else {
        finderPenaltyAddHistory(runLength, history, size);
        if (!runIsDark) score += finderPenaltyCount(history) * PENALTY_FINDER_LIKE;
        runIsDark = modules[row][column];
        runLength = 1;
      }
    }
    score += finderPenaltyTerminate(runIsDark, runLength, history, size) * PENALTY_FINDER_LIKE;
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const color = modules[row][column];
      if (color === modules[row][column + 1]
        && color === modules[row + 1][column]
        && color === modules[row + 1][column + 1]) {
        score += PENALTY_SAME_COLOR_BLOCK;
      }
    }
  }

  let dark = 0;
  for (const line of modules) for (const module of line) if (module) dark += 1;
  const total = size * size;
  // Deviation of the dark proportion from 50%, in steps of 5%.
  const deviation = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += deviation * PENALTY_DARK_PROPORTION;

  return score;
}

/**
 * The smallest version whose data capacity holds `byteLength` at `errorCorrection`.
 *
 * Throws rather than dropping to a weaker level or truncating: both would
 * produce a code that scans cleanly to the wrong thing.
 */
function selectVersion(byteLength: number, errorCorrection: QrErrorCorrection): number {
  for (let version = MIN_QR_VERSION; version <= MAX_QR_VERSION; version += 1) {
    const capacityBits = dataCodewords(version, errorCorrection) * 8;
    const requiredBits = 4 + characterCountBits(version) + byteLength * 8;
    if (requiredBits <= capacityBits) return version;
  }
  const maximumBits = dataCodewords(MAX_QR_VERSION, errorCorrection) * 8
    - 4
    - characterCountBits(MAX_QR_VERSION);
  throw new Error(
    `QR payload does not fit: ${byteLength} UTF-8 bytes exceeds the ${Math.floor(maximumBits / 8)}-byte maximum for error correction level ${errorCorrection} at version ${MAX_QR_VERSION}.`,
  );
}

/** Mode indicator, character count, payload, terminator, bit padding, pad codewords (§7.4). */
function buildCodewords(bytes: readonly number[], version: number, errorCorrection: QrErrorCorrection): number[] {
  const capacityBits = dataCodewords(version, errorCorrection) * 8;
  const bits: number[] = [];
  appendBits(BYTE_MODE_INDICATOR, 4, bits);
  appendBits(bytes.length, characterCountBits(version), bits);
  for (const byte of bytes) appendBits(byte, 8, bits);

  appendBits(0, Math.min(4, capacityBits - bits.length), bits);
  appendBits(0, (8 - (bits.length % 8)) % 8, bits);

  for (let index = 0; bits.length < capacityBits; index += 1) {
    appendBits(PAD_CODEWORDS[index % PAD_CODEWORDS.length], 8, bits);
  }

  const codewords = new Array<number>(bits.length / 8).fill(0);
  for (let index = 0; index < bits.length; index += 1) {
    codewords[index >>> 3] |= bits[index] << (7 - (index & 7));
  }
  return codewords;
}

/**
 * Encode `text` as a QR Code symbol in byte mode.
 *
 * The version is the smallest one that fits the UTF-8 payload at the requested
 * error-correction level, and the mask is the one of eight with the lowest
 * standard penalty score — neither is configurable, because a caller that
 * could pin either could produce a symbol that no longer matches its own
 * format bits.
 */
export function encodeQrCode(
  text: string,
  options?: { readonly errorCorrection?: QrErrorCorrection },
): QrCodeMatrix {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("QR encode refused: the payload is empty; there is no url to encode.");
  }
  // An omitted option is a genuinely valid state with a documented default —
  // "M" is the level this program renders capture URLs at. A SUPPLIED value
  // that is not one of the four levels is a caller bug and fails loud.
  const requested = options?.errorCorrection ?? "M";
  const parsed = QrErrorCorrectionSchema.safeParse(requested);
  if (!parsed.success) {
    throw new Error(`QR encode refused: error correction level ${String(requested)} is not one of L, M, Q, H.`);
  }
  const errorCorrection = parsed.data;

  const bytes = [...new TextEncoder().encode(text)];
  const version = selectVersion(bytes.length, errorCorrection);

  const canvas = createCanvas(version, errorCorrection);
  drawFunctionPatterns(canvas);
  drawCodewords(canvas, addErrorCorrectionAndInterleave(buildCodewords(bytes, version, errorCorrection), version, errorCorrection));

  let bestMask = -1;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASK_PREDICATES.length; mask += 1) {
    applyMask(canvas, mask);
    drawFormatBits(canvas, mask);
    const penalty = penaltyScore(canvas);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(canvas, mask);
  }
  if (bestMask < 0) {
    throw new Error(`QR mask selection produced no candidate at version ${version}; the penalty comparison is broken.`);
  }
  applyMask(canvas, bestMask);
  drawFormatBits(canvas, bestMask);

  return deepFreeze({
    size: canvas.size,
    version,
    errorCorrection,
    modules: canvas.modules,
  });
}

/**
 * An SVG `d` attribute drawing one 1x1 rectangle per dark module.
 *
 * Row-major, integer coordinates, no canvas and no floating point: the caller
 * scales it with a `viewBox`, so the same matrix renders identically at any
 * size. Coordinates are matrix-relative — see `qrCodeSvgViewBox` for the quiet
 * zone, which is deliberately not part of the path.
 */
export function qrCodeSvgPath(matrix: QrCodeMatrix): string {
  const segments: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row][column]) segments.push(`M${column} ${row}h1v1h-1z`);
    }
  }
  return segments.join("");
}

/**
 * The `viewBox` that surrounds a matrix with its quiet zone.
 *
 * The margin lives here, in the renderer's coordinate system, and never in
 * `size`/`modules`. A caller that draws `qrCodeSvgPath` without this — or with
 * a `viewBox` of its own that omits the border — ships an unscannable picture,
 * which is exactly the mistake this helper exists to make hard.
 */
export function qrCodeSvgViewBox(
  matrix: QrCodeMatrix,
  quietZoneModules: number = QR_QUIET_ZONE_MODULES,
): string {
  if (!Number.isInteger(quietZoneModules) || quietZoneModules < 0) {
    throw new Error(`QR quiet zone refused: ${quietZoneModules} is not a non-negative integer number of modules.`);
  }
  const side = matrix.size + quietZoneModules * 2;
  return `${-quietZoneModules} ${-quietZoneModules} ${side} ${side}`;
}
