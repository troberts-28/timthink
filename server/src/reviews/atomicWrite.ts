import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomic(target: string, contents: string): Promise<void> {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temp, contents, "utf8");
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
