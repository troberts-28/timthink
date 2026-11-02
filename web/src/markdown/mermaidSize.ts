export interface SvgSize {
  width: number;
  height: number;
}

const ROOT_SVG_TAG = /<svg\b[^>]*>/;
const VIEW_BOX = /\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/;

export function svgNaturalSize(svg: string): SvgSize | null {
  const rootTag = ROOT_SVG_TAG.exec(svg)?.[0];
  const match = rootTag ? VIEW_BOX.exec(rootTag) : null;
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function withoutFixedSize(svg: string): string {
  return svg.replace(ROOT_SVG_TAG, (tag) =>
    tag
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace(/\sstyle="[^"]*"/, (style) => style.replace(/max-width:\s*[\d.]+px;?\s*/g, "")),
  );
}
