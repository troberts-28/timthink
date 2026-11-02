import { createContext, useContext } from "react";

export interface PlanContextValue {
  repo: string;
  docPath: string;
}

export const PlanContext = createContext<PlanContextValue | null>(null);

export function usePlanContext(): PlanContextValue {
  const value = useContext(PlanContext);
  if (!value) throw new Error("usePlanContext must be used inside PlanContext");
  return value;
}
