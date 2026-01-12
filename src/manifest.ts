import fs from "node:fs/promises";
import path from "node:path";

export const manifestPath = (dataDir: string): string =>
  path.join(dataDir, "assets.json");

export const walkFiles = async (root: string): Promise<readonly string[]> => {
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) out.push(abs);
    }
  }

  return out;
};
