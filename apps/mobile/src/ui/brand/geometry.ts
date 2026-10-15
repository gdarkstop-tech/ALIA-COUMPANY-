/** Pure geometry for the Alia Group architectural motifs (shared by mobile SVG and asset scripts). */

/** Pointed (two-centred, Mamluk-style) arch outline as an SVG path, closed at the bottom. */
export function pointedArchPath(width: number, height: number, crownRatio = 0.42): string {
  const k = Math.min(height, width * crownRatio);
  const r = width * 0.78;
  const mid = width / 2;
  return `M0 ${height} L0 ${k} A${r} ${r} 0 0 1 ${mid} 0 A${r} ${r} 0 0 1 ${width} ${k} L${width} ${height} Z`;
}

/** Same arch, open at the bottom (stroke-only outline). */
export function pointedArchOutline(width: number, height: number, crownRatio = 0.42): string {
  const k = Math.min(height, width * crownRatio);
  const r = width * 0.78;
  return `M0 ${height} L0 ${k} A${r} ${r} 0 0 1 ${width / 2} 0 A${r} ${r} 0 0 1 ${width} ${k} L${width} ${height}`;
}

/**
 * One tile of a restrained mashrabiya / khatam lattice: an eight-pointed star made of two
 * interlaced squares, joined to its neighbours along the tile edges and corners.
 */
export function latticeTilePath(cell: number): string {
  const c = cell;
  const m = c / 2;
  const a = c * 0.25; // axis-aligned square half-size
  const b = c * 0.3536; // rotated square half-diagonal
  const sq = `M${m - a} ${m - a} L${m + a} ${m - a} L${m + a} ${m + a} L${m - a} ${m + a} Z`;
  const rot = `M${m} ${m - b} L${m + b} ${m} L${m} ${m + b} L${m - b} ${m} Z`;
  const ties = [
    `M${m} ${m - b} L${m} 0`,
    `M${m} ${m + b} L${m} ${c}`,
    `M${m - b} ${m} L0 ${m}`,
    `M${m + b} ${m} L${c} ${m}`,
    `M${m - a} ${m - a} L0 0`,
    `M${m + a} ${m - a} L${c} 0`,
    `M${m + a} ${m + a} L${c} ${c}`,
    `M${m - a} ${m + a} L0 ${c}`,
  ].join(' ');
  return `${sq} ${rot} ${ties}`;
}
