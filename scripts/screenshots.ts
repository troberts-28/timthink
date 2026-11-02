import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: "http://127.0.0.1:7420" },
    out: { type: "string", default: "screenshots" },
    widths: { type: "string", default: "1440" },
    themes: { type: "string", default: "light,dark" },
    "full-page": { type: "boolean", default: false },
  },
});

if (positionals.length === 0) {
  console.error("Usage: pnpm screenshots [--out dir] [--widths 1440,1024] name=/path ...");
  process.exit(1);
}

const targets = positionals.map((entry) => {
  const [name = "", ...rest] = entry.split("=");
  return { name, urlPath: rest.join("=") };
});
const widths = values.widths.split(",").map(Number);
const themes = values.themes.split(",");

await mkdir(values.out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      await context.addInitScript((value) => {
        try {
          localStorage.setItem("timthink-theme", value);
        } catch {}
      }, theme);
      const page = await context.newPage();
      for (const { name, urlPath } of targets) {
        await page.goto(`${values.base}${urlPath}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
        const file = path.join(values.out, `${name}-${theme}-${width}.png`);
        await page.screenshot({ path: file, fullPage: values["full-page"] });
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
