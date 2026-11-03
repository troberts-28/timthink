import { type ComponentProps, useState } from "react";
import { createPortal } from "react-dom";
import { usePrStatus } from "./PrStatusContext";
import { PrCard, PrStateDot } from "./PrVisuals";

const CARD_GAP_PX = 6;

export function PrLink({ href, children, ...rest }: ComponentProps<"a">) {
  const info = usePrStatus(href);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (element: HTMLElement) => setAnchor(element.getBoundingClientRect());
  const hide = () => setAnchor(null);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={hide}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={hide}
      {...rest}
    >
      {children}
      {info ? <PrStateDot state={info.state} className="ml-1 align-middle" /> : null}
      {info && anchor
        ? createPortal(
            <span className="pr-card pr-card-floating" style={{ top: anchor.bottom + CARD_GAP_PX, left: anchor.left }}>
              <PrCard info={info} bare />
            </span>,
            document.body,
          )
        : null}
    </a>
  );
}
