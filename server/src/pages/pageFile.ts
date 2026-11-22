export const PROJECT_PAGE_FILE = "project.page.tsx";

const BLOCK_ID_QUOTE = /^id="([^"]+)"$/;

export function isPageFile(relPath: string) {
  return relPath.endsWith(".page.tsx");
}

export function blockIdQuote(blockId: string) {
  return `id="${blockId}"`;
}

export function blockIdOf(quote: string) {
  return BLOCK_ID_QUOTE.exec(quote)?.[1] ?? null;
}
