import type { DocSummary, GithubRepo, PrLinkHost } from "@timthink/server";
import { GitBranch, GitPullRequest, Ticket, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { StatusChip } from "../components/StatusChip";
import { longDate, relativeTime } from "../lib/format";
import { prUrl, prUrlForGithubPull } from "../markdown/linkPatterns";

const PR_HOST_TITLES: Record<PrLinkHost, string> = { graphite: "Open in Graphite", github: "Open on GitHub" };

function prLink(pr: string, github: GithubRepo | null, host: PrLinkHost): { label: string; href: string | null } {
  const fromUrl = prUrlForGithubPull(pr, host);
  const number = /(\d+)\/?$/.exec(pr)?.[1];
  const label = number ? `#${number}` : pr;
  if (fromUrl) return { label, href: fromUrl };
  return { label, href: github && number ? prUrl(github, number, host) : null };
}

function MetaChip({
  icon,
  children,
  href,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  href?: string | null;
  title?: string;
}) {
  const className = "chip chip-neutral gap-1.5 font-mono text-[11.5px]";
  if (href) {
    return (
      <a className={`${className} hover:text-ink`} href={href} target="_blank" rel="noreferrer" title={title}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {icon}
      {children}
    </span>
  );
}

interface PlanMetaProps {
  doc: DocSummary;
  github: GithubRepo | null;
  prLinks: PrLinkHost;
}

export function PlanMeta({ doc, github, prLinks }: PlanMetaProps) {
  const prs = doc.prs.map((pr) => prLink(pr, github, prLinks));
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-meta text-ink-64">
      <StatusChip status={doc.status} />
      <time dateTime={doc.date} className="font-medium text-ink-64">
        {longDate(doc.date)}
      </time>
      {doc.branch ? (
        <MetaChip icon={<GitBranch className="size-3" aria-hidden />} title="Branch">
          {doc.branch}
        </MetaChip>
      ) : null}
      {prs.map((pr) => (
        <MetaChip
          key={pr.label}
          icon={<GitPullRequest className="size-3" aria-hidden />}
          href={pr.href}
          title={PR_HOST_TITLES[prLinks]}
        >
          {pr.label}
        </MetaChip>
      ))}
      {doc.linear ? (
        <MetaChip icon={<Ticket className="size-3" aria-hidden />} title="Linear issue">
          {doc.linear}
        </MetaChip>
      ) : null}
      {doc.frontmatterError ? (
        <span className="chip chip-bad" title={doc.frontmatterError}>
          <TriangleAlert className="size-3" aria-hidden />
          Frontmatter could not be parsed
        </span>
      ) : null}
      <span className="ml-auto text-ink-32">Edited {relativeTime(doc.mtime)}</span>
    </div>
  );
}
