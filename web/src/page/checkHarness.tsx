import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AreaDetail, ProjectDetail } from "@timthink/server";
import type { ReactNode } from "react";
import { ThemeContext } from "../lib/theme";
import { ToastProvider } from "../lib/toast";
import {
  AreaContext,
  areaPageScope,
  type PageScope,
  PageScopeContext,
  ProjectContext,
  projectPageScope,
} from "./projectContext";

const CHECK_THEME = { setting: "light", effective: "light", setSetting: () => {} } as const;

interface CheckHarnessProps<Detail> {
  detail: Detail;
  pagePath: string;
  children: ReactNode;
}

export function ProjectCheckHarness({ detail, pagePath, children }: CheckHarnessProps<ProjectDetail>) {
  return (
    <CheckProviders scope={projectPageScope(detail, pagePath)}>
      <ProjectContext.Provider value={detail}>{children}</ProjectContext.Provider>
    </CheckProviders>
  );
}

export function AreaCheckHarness({ detail, pagePath, children }: CheckHarnessProps<AreaDetail>) {
  return (
    <CheckProviders scope={areaPageScope(detail, pagePath)}>
      <AreaContext.Provider value={detail}>{children}</AreaContext.Provider>
    </CheckProviders>
  );
}

function CheckProviders({ scope, children }: { scope: PageScope; children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThemeContext.Provider value={CHECK_THEME}>
        <ToastProvider>
          <PageScopeContext.Provider value={scope}>{children}</PageScopeContext.Provider>
        </ToastProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
