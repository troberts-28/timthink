import type { AreaDetail, ProjectEntry } from "@timthink/server";
import { Layers } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useArea, useDocsIndex } from "../api/queries";
import { ArchivedDocs } from "../components/ArchivedDocs";
import { DocsByKind } from "../components/DocsByKind";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { partitionArchived } from "../lib/archive";
import { pluralise, relativeTime } from "../lib/format";
import { findArea } from "../lib/indexNav";
import { projectEntryHref } from "../lib/routes";
import { AreaAuthoredPage } from "../page/AuthoredPage";
import { ProjectPrs } from "./ProjectPrs";
import { ProjectStatusDot } from "./ProjectStatus";

export function AreaPage() {
  const { area: areaId } = useParams();
  const { data: index, isLoading } = useDocsIndex();
  const area = findArea(index, areaId);
  const { data: detail } = useArea(areaId ?? "");
  const [showSettled, setShowSettled] = useState(false);
  if (isLoading) {
    return <PageContainer>{null}</PageContainer>;
  }
  if (!area) {
    return (
      <PageContainer>
        <EmptyState icon={Layers}>There is no area with that name.</EmptyState>
      </PageContainer>
    );
  }
  const live = area.projects.filter((project) => !isSettled(project));
  const settled = area.projects.filter(isSettled);
  const { active, archived } = partitionArchived(area.docs);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Area"
        title={area.title}
        meta={
          <>
            {pluralise(live.length, "live project")}
            {area.repos.length > 0 ? ` · ${area.repos.join(", ")}` : ""}
          </>
        }
      />
      {area.summary ? (
        <p className="m-0 -mt-4 mb-8 max-w-[72ch] text-[16px] leading-[1.6] text-ink-64">{area.summary}</p>
      ) : null}
      {detail ? <AreaAuthoredPage detail={detail} /> : null}
      <section className="mb-10">
        <SectionHeading>Projects</SectionHeading>
        {live.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {live.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-line bg-surface">
            <EmptyState>{`No live projects. Create one with timthink project create ${area.id}/<name>.`}</EmptyState>
          </div>
        )}
        {settled.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSettled((current) => !current)}
              className="text-meta font-medium text-ink-32 hover:text-ink-64"
            >
              {showSettled ? "Hide" : "Show"} {pluralise(settled.length, "shipped or dropped project")}
            </button>
            {showSettled ? (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {settled.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      {detail ? <AreaPrs detail={detail} /> : null}
      <DocsByKind docs={active} />
      <ArchivedDocs docs={archived} />
    </PageContainer>
  );
}

function AreaPrs({ detail }: { detail: AreaDetail }) {
  if (detail.projectPrs.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <SectionHeading aside={pluralise(detail.projectPrs.length, "project")}>Pull requests</SectionHeading>
      {detail.projectPrs.map((entry) => (
        <div key={entry.projectId} className="mb-5 last:mb-0">
          <Link
            to={projectEntryHref(entry.projectId)}
            className="mb-2 inline-block text-ui font-medium text-ink hover:underline"
          >
            {entry.title}
          </Link>
          <ProjectPrs
            projectId={entry.projectId}
            prs={entry.prs}
            repoLinks={detail.repoLinks}
            showRepo={new Set(entry.prs.stacks.map((stack) => stack.repo)).size > 1}
          />
        </div>
      ))}
    </section>
  );
}

function isSettled(project: ProjectEntry) {
  return project.status === "shipped" || project.status === "dropped";
}

function ProjectCard({ project }: { project: ProjectEntry }) {
  const { active } = partitionArchived(project.docs);
  return (
    <Link
      to={projectEntryHref(project.id)}
      className="group flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5 transition-colors duration-150 hover:border-ink-32"
    >
      <span className="flex items-center gap-2">
        <ProjectStatusDot status={project.status} />
        <span className="truncate text-ui font-medium text-ink">{project.title}</span>
      </span>
      {project.summary ? <span className="line-clamp-2 text-meta text-ink-64">{project.summary}</span> : null}
      <span className="flex items-center justify-between gap-3 text-meta text-ink-64">
        <span>{pluralise(active.length, "active doc")}</span>
        {project.lastActivity > 0 ? (
          <span className="text-ink-32 tabular-nums">{relativeTime(project.lastActivity)}</span>
        ) : null}
      </span>
    </Link>
  );
}
