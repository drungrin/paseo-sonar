// Theme colors with transparency, for the tinted fills of live and failed stations.

/** `color` at `alpha` (0–1). Hex and rgb()/rgba() are tinted; anything else is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const value = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
    const base = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return `rgba(${r}, ${g}, ${b}, ${round(base * a)})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(value);
  if (rgb) {
    const raw = rgb[4];
    const base = raw === undefined ? 1 : raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${round(base * a)})`;
  }
  return value;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function channels(color: string): [number, number, number, number] | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
    return [r, g, b, full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(value);
  if (!rgb) return null;
  const raw = rgb[4];
  const alpha = raw === undefined ? 1 : raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
}

/**
 * `tint` laid over `base` at `amount` (0–1), as one opaque color, so what is drawn behind does not
 * show through. A color it cannot read leaves `base` as it is.
 */
export function mix(base: string, tint: string, amount: number): string {
  const under = channels(base);
  const over = channels(tint);
  if (!under || !over) return base;
  const a = Math.max(0, Math.min(1, amount)) * over[3];
  const [r, g, b] = [0, 1, 2].map((i) => Math.round(under[i]! * (1 - a) + over[i]! * a));
  return `rgb(${r}, ${g}, ${b})`;
}
