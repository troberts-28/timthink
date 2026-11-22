import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectDetail } from "@timthink/server";
import type { ReactNode } from "react";
import { ThemeContext } from "../lib/theme";
import { ToastProvider } from "../lib/toast";
import { ProjectContext } from "./projectContext";

const CHECK_THEME = { setting: "light", effective: "light", setSetting: () => {} } as const;

export function CheckHarness({ project, children }: { project: ProjectDetail; children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThemeContext.Provider value={CHECK_THEME}>
        <ToastProvider>
          <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>
        </ToastProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
