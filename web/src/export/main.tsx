import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectExport } from "@timthink/server";
import { EXPORT_DATA_ELEMENT_ID } from "@timthink/server/shared";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { queryKeys } from "../api/queries";
import { ThemeProvider } from "../lib/theme";
import { ToastProvider } from "../lib/toast";
import { type PageScope, PageScopeContext, ProjectContext, projectPageScope } from "../page/projectContext";
import { ExportApp, exportFileHref } from "./ExportApp";

export function renderExport(Page: ComponentType | null) {
  const dataElement = document.getElementById(EXPORT_DATA_ELEMENT_ID);
  const root = document.getElementById("root");
  if (!dataElement || !root) {
    throw new Error("This export is missing its data");
  }
  const data: ProjectExport = JSON.parse(dataElement.textContent ?? "");
  const scope: PageScope = {
    ...projectPageScope(data.detail, data.pagePath),
    readOnly: true,
    fileHref: exportFileHref,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  for (const [checklistId, results] of Object.entries(data.checklists)) {
    queryClient.setQueryData(queryKeys.checklist(scope.ownerId, checklistId), results);
  }
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <PageScopeContext.Provider value={scope}>
            <ProjectContext.Provider value={data.detail}>
              <ExportApp data={data} Page={Page} />
            </ProjectContext.Provider>
          </PageScopeContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
