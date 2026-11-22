import { encode } from "uqr";

const QR_BORDER = 2;

export function QrLink({ id, href, label }: { id?: string; href: string; label?: string }) {
  const { data, size } = encode(href, { border: QR_BORDER });
  const modules = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  return (
    <div data-block-id={id} className="mb-[18px] flex items-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="size-28 flex-none rounded-button bg-white"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code for ${href}`}
      >
        <path d={modules} fill="#000" />
      </svg>
      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 break-all text-ui">
        {label ?? href}
      </a>
    </div>
  );
}
