import { Folder } from "lucide-react";
import { Link, useParams } from "react-router";
import { useDocsIndex } from "../api/queries";
import { ArchivedDocs } from "../components/ArchivedDocs";
import { FilesCard } from "../components/AttachmentList";
import { DocList } from "../components/DocList";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { partitionArchived } from "../lib/archive";
import { pluralise } from "../lib/format";
import { findProject, findRepo } from "../lib/indexNav";
import { repoHref } from "../lib/routes";

export function ProjectPage() {
  const { repo: repoName, project: projectName } = useParams();
  const { data: index, isLoading } = useDocsIndex();
  const repo = findRepo(index, repoName);
  const project = findProject(repo, projectName);
  if (isLoading) return <PageContainer>{null}</PageContainer>;
  if (!repo || !project) {
    return (
      <PageContainer>
        <EmptyState icon={Folder}>There is no project with that name.</EmptyState>
      </PageContainer>
    );
  }
  const { active, archived } = partitionArchived(project.docs);
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link to={repoHref(repo.name)} className="hover:text-ink">
            {repo.name}
          </Link>
        }
        title={project.name}
        meta={`${pluralise(active.length, "active plan")} · ${pluralise(project.attachmentCount, "file")}`}
      />
      <section className="mb-10">
        <SectionHeading>Plans</SectionHeading>
        {active.length > 0 ? (
          <DocList docs={active} />
        ) : (
          <div className="rounded-card border border-line bg-surface">
            <EmptyState>
              {archived.length > 0 ? "Every plan here is archived." : "This project has files but no plans."}
            </EmptyState>
          </div>
        )}
      </section>
      <ArchivedDocs docs={archived} />
      {project.attachmentCount > 0 ? (
        <section>
          <SectionHeading aside={pluralise(project.attachmentCount, "file")}>Files</SectionHeading>
          <FilesCard repo={repo.name} project={project.name} />
        </section>
      ) : null}
    </PageContainer>
  );
}
