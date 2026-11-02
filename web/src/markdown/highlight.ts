import type { Root } from "hast";
import { type BundledLanguage, bundledLanguages, createCssVariablesTheme, createHighlighter } from "shiki";

const THEME_NAME = "timthink";

const theme = createCssVariablesTheme({ name: THEME_NAME, variablePrefix: "--shiki-", fontStyle: true });

const LANGUAGE_ALIASES: Record<string, string> = {
  shell: "bash",
  console: "bash",
  zsh: "bash",
  text: "",
  plaintext: "",
  txt: "",
};

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighter: Promise<Highlighter> | null = null;

function isBundledLanguage(lang: string): lang is BundledLanguage {
  return lang in bundledLanguages;
}

export async function highlightToHast(code: string, lang: string): Promise<Root | null> {
  const normalised = LANGUAGE_ALIASES[lang] ?? lang;
  if (!normalised || !isBundledLanguage(normalised)) return null;
  highlighter ??= createHighlighter({ themes: [theme], langs: [] });
  const instance = await highlighter;
  await instance.loadLanguage(normalised);
  return instance.codeToHast(code, { lang: normalised, theme: THEME_NAME });
}
