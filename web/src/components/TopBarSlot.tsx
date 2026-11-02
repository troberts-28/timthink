import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const TOP_BAR_SLOT_ID = "top-bar-slot";

export function TopBarSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById(TOP_BAR_SLOT_ID)), []);
  return target ? createPortal(children, target) : null;
}
