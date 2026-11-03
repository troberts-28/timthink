import type { Root as HastRoot } from "hast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { rehypeQuestionDetails } from "./questionDetails";
import {
  rehypeHeadingIds,
  rehypeSectionRanges,
  rehypeSourcePositions,
  rehypeTaskPrs,
  rehypeUnwrapFences,
  type TocEntry,
} from "./rehypePlugins";
import { type AutoLinkOptions, remarkAutoLinks } from "./remarkAutoLinks";
import { remarkCallouts, remarkDropLeadingTitle, remarkFences } from "./remarkBlocks";

export interface RenderedMarkdown {
  hast: HastRoot;
  toc: TocEntry[];
}

export function markdownToHast(raw: string, options: AutoLinkOptions): RenderedMarkdown {
  const toc: TocEntry[] = [];
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkGfm)
    .use(remarkDropLeadingTitle)
    .use(remarkFences)
    .use(remarkCallouts)
    .use(remarkAutoLinks, options)
    .use(remarkRehype)
    .use(rehypeUnwrapFences)
    .use(rehypeQuestionDetails, options)
    .use(rehypeHeadingIds, toc)
    .use(rehypeSourcePositions)
    .use(rehypeSectionRanges)
    .use(rehypeTaskPrs);
  const hast = processor.runSync(processor.parse(raw), raw);
  return { hast, toc };
}
