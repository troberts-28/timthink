import type { ProjectIndex } from "@timthink/server";
import { FileText, Folder } from "lucide-react";
import { Link, useParams } from "react-router";
import { useDocsIndex } from "../api/queries";
import { FilesCard } from "../components/AttachmentList";
import { DocList } from "../components/DocList";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { compactDate, pluralise } from "../lib/format";
import { findRepo } from "../lib/indexNav";
import { projectHref } from "../lib/routes";

function ProjectCard({ repo, project }: { repo: string; project: ProjectIndex }) {
  const latest = project.docs[0];
  return (
    <Link
      to={projectHref(repo, project.name)}
      className="group flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5 transition-colors duration-150 hover:border-ink-32"
    >
      <span className="flex items-center gap-2">
        <Folder className="size-4 flex-none text-ink-32" strokeWidth={1.75} aria-hidden />
        <span className="truncate text-ui font-medium text-ink">{project.name}</span>
      </span>
      <span className="flex items-center justify-between gap-3 text-meta text-ink-64">
        <span>
          {pluralise(project.docs.length, "plan")}
          {project.attachmentCount > 0 ? ` · ${pluralise(project.attachmentCount, "file")}` : ""}
        </span>
        {latest ? <span className="text-ink-32 tabular-nums">{compactDate(latest.date)}</span> : null}
      </span>
    </Link>
  );
}

export function RepoPage() {
  const { repo: repoName } = useParams();
  const { data: index, isLoading } = useDocsIndex();
  const repo = findRepo(index, repoName);
  if (isLoading) return <PageContainer>{null}</PageContainer>;
  if (!repo) {
    return (
      <PageContainer>
        <EmptyState icon={FileText}>There is no repo with that name in your docs folder.</EmptyState>
      </PageContainer>
    );
  }
  const github = repo.github ? (
    <>
      {" · "}
      <a
        className="text-ink-64 underline decoration-line underline-offset-3 hover:text-ink"
        href={`https://github.com/${repo.github.owner}/${repo.github.repo}`}
        target="_blank"
        rel="noreferrer"
      >
        {repo.github.owner}/{repo.github.repo}
      </a>
    </>
  ) : null;
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Repo"
        title={repo.name}
        meta={
          <>
            {pluralise(repo.docCount, "plan")} · {pluralise(repo.projects.length, "project")}
            {github}
          </>
        }
      />
      {repo.projects.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Projects</SectionHeading>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {repo.projects.map((project) => (
              <ProjectCard key={project.name} repo={repo.name} project={project} />
            ))}
          </div>
        </section>
      ) : null}
      {repo.ungrouped.length > 0 ? (
        <section className="mb-10">
          <SectionHeading aside={pluralise(repo.ungrouped.length, "plan")}>Plans</SectionHeading>
          <DocList docs={repo.ungrouped} />
        </section>
      ) : null}
      {repo.rootAttachmentCount > 0 ? (
        <section>
          <SectionHeading aside={pluralise(repo.rootAttachmentCount, "file")}>Files</SectionHeading>
          <FilesCard repo={repo.name} project={null} />
        </section>
      ) : null}
    </PageContainer>
  );
}
