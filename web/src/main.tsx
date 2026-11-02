import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import { InboxPage } from "./pages/InboxPage";
import { PlanPage } from "./pages/PlanPage";
import { ProjectPage } from "./pages/ProjectPage";
import { RepoPage } from "./pages/RepoPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<InboxPage />} />
                <Route path="r/:repo" element={<RepoPage />} />
                <Route path="r/:repo/:project" element={<ProjectPage />} />
                <Route path="d/:repo/*" element={<PlanPage />} />
                <Route path="*" element={<EmptyState>Nothing lives at this address.</EmptyState>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
