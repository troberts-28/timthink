import type { InboxItem } from "@timthink/server";
import { Clock, Inbox } from "lucide-react";
import { useDocsIndex, useInbox } from "../api/queries";
import { DocList } from "../components/DocList";
import { EmptyState } from "../components/EmptyState";
import { PageContainer, PageHeader, SectionHeading } from "../components/PageHeader";
import { InboxRow } from "../inbox/InboxRow";
import { groupByRepo, INBOX_SECTIONS, type SectionSpec } from "../inbox/inboxModel";
import { pluralise } from "../lib/format";
import { recentDocs } from "../lib/indexNav";

const RECENT_LIMIT = 12;

function InboxSectionCard({ spec, items }: { spec: SectionSpec; items: InboxItem[] }) {
  const groups = groupByRepo(items);
  const showRepos = groups.length > 1;
  return (
    <section aria-label={spec.title} className="mb-10">
      <SectionHeading aside={spec.hint}>
        {spec.title} <span className="ml-1 text-ink-32 tabular-nums">{items.length}</span>
      </SectionHeading>
      <ul className="m-0 list-none overflow-hidden rounded-card border border-line bg-surface p-0">
        {groups.map((group) => (
          <li key={group.repo} className="border-b border-line-soft last:border-b-0">
            {showRepos ? (
              <p className="m-0 border-b border-line-soft bg-bg-sunken/60 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-64">
                {group.repo}
              </p>
            ) : null}
            <ul className="m-0 list-none p-0">
              {group.items.map((item) => (
                <InboxRow key={item.id} item={item} showRepo={!showRepos} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function headline(attention: number, waiting: number): string {
  if (attention > 0) return `${pluralise(attention, "thing needs", "things need")} you`;
  return waiting > 0
    ? `All caught up. ${pluralise(waiting, "review is", "reviews are")} with Claude.`
    : "All caught up";
}

export function InboxPage() {
  const { data: inbox, isLoading } = useInbox();
  const { data: index } = useDocsIndex();
  if (isLoading || !inbox) return <PageContainer>{null}</PageContainer>;
  const waiting = inbox.items.filter((item) => item.section === "waiting").length;
  const sections = INBOX_SECTIONS.map((spec) => ({
    spec,
    items: inbox.items.filter((item) => item.section === spec.id),
  }));
  const recent = index ? recentDocs(index, RECENT_LIMIT) : [];
  return (
    <PageContainer>
      <PageHeader eyebrow="Across every repo" title="Inbox" meta={headline(inbox.attention.total, waiting)} />
      {inbox.attention.total === 0 ? (
        <div className="mb-10 rounded-card border border-line bg-surface">
          <EmptyState icon={Inbox}>Nothing needs you. Nice.</EmptyState>
        </div>
      ) : null}
      {sections
        .filter(({ items }) => items.length > 0)
        .map(({ spec, items }) => (
          <InboxSectionCard key={spec.id} spec={spec} items={items} />
        ))}
      <section aria-label="Recent plans">
        <SectionHeading aside="Most recently edited first">Recent plans</SectionHeading>
        {recent.length > 0 ? (
          <DocList docs={recent} showLocation />
        ) : (
          <EmptyState icon={Clock}>No plans yet. Markdown files in your docs folder will show up here.</EmptyState>
        )}
      </section>
    </PageContainer>
  );
}
