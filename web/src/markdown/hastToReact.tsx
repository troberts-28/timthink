import type { Root } from "hast";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

export function hastToReact(tree: Root, components: Partial<Components> = {}): ReactNode {
  return toJsxRuntime(tree, { Fragment, jsx, jsxs, components, ignoreInvalidStyle: true });
}

export function dataAttribute(props: object, name: string): string | undefined {
  const value: unknown = (props as Record<string, unknown>)[name];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function sourceAttributes(props: object): { "data-s"?: string; "data-e"?: string } {
  const start = dataAttribute(props, "data-s");
  const end = dataAttribute(props, "data-e");
  return start !== undefined && end !== undefined ? { "data-s": start, "data-e": end } : {};
}
