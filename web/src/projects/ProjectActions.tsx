import type { ProjectEntry, ProjectStatus } from "@timthink/server";
import { Archive, PencilLine, RotateCcw } from "lucide-react";
import { useState } from "react";
import { renameProject, setProjectStatus } from "../api/projects";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { RenameDialog } from "../components/RenameDialog";
import { TopBarSlot } from "../components/TopBarSlot";
import { useToast } from "../lib/toast";
import { PublishButton } from "./ProjectPublishing";

type ProjectEnd = Extract<ProjectStatus, "shipped" | "dropped">;

const PROJECT_ENDS: Array<{ status: ProjectEnd; label: string; hint: string }> = [
  { status: "shipped", label: "Shipped", hint: "The work landed." },
  { status: "dropped", label: "Dropped", hint: "We stopped before it landed." },
];

export function isArchivedProject(project: Pick<ProjectEntry, "status">) {
  return project.status === "shipped" || project.status === "dropped";
}

export function ProjectActions({ project }: { project: ProjectEntry }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <TopBarSlot>
      <span className="flex items-center gap-2">
        <Button size="sm" icon={<PencilLine className="size-3.5" aria-hidden />} onClick={() => setRenaming(true)}>
          Rename
        </Button>
        <ArchiveProjectButton project={project} />
        <PublishButton projectId={project.id} />
      </span>
      {renaming ? (
        <RenameDialog
          heading="Rename this project"
          currentTitle={project.title}
          hint="Changes the title in project.yaml. The folder and project id stay the same."
          rename={(title) => renameProject(project.id, title)}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </TopBarSlot>
  );
}

function ArchiveProjectButton({ project }: { project: ProjectEntry }) {
  const { archiving, setArchiving, restore, pending } = useProjectArchive(project);
  if (isArchivedProject(project)) {
    return (
      <Button
        size="sm"
        icon={<RotateCcw className="size-3.5" aria-hidden />}
        disabled={pending}
        onClick={() => void restore()}
      >
        Unarchive
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" icon={<Archive className="size-3.5" aria-hidden />} onClick={() => setArchiving(true)}>
        Archive
      </Button>
      {archiving ? <ArchiveProjectDialog project={project} onClose={() => setArchiving(false)} /> : null}
    </>
  );
}

export function useProjectArchive(project: Pick<ProjectEntry, "id">) {
  const toast = useToast();
  const [archiving, setArchiving] = useState(false);
  const [pending, setPending] = useState(false);
  const restore = async () => {
    setPending(true);
    try {
      await setProjectStatus(project.id, "active");
      toast("Unarchived. The project is active again.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't unarchive the project", "bad");
    } finally {
      setPending(false);
    }
  };
  return { archiving, setArchiving, restore, pending };
}

export function ArchiveProjectDialog({
  project,
  onClose,
}: {
  project: Pick<ProjectEntry, "id" | "title">;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const archive = async (status: ProjectEnd) => {
    setPending(true);
    try {
      await setProjectStatus(project.id, status);
      toast(`Archived ${project.title} as ${status}.`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't archive the project", "bad");
      setPending(false);
    }
  };
  return (
    <Dialog title={`Archive ${project.title}`} onClose={onClose} busy={pending}>
      <p className="m-0 text-ui text-ink-64">
        Archived projects move to Archived in the sidebar, and their docs leave the active lists. How did it end?
      </p>
      <div className="flex flex-col gap-2">
        {PROJECT_ENDS.map((end) => (
          <button
            key={end.status}
            type="button"
            disabled={pending}
            onClick={() => void archive(end.status)}
            className="flex flex-col items-start rounded-button border border-line bg-surface px-4 py-2.5 text-left hover:border-ink-32 disabled:opacity-50"
          >
            <span className="text-ui font-medium text-ink">{end.label}</span>
            <span className="text-meta text-ink-64">{end.hint}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
