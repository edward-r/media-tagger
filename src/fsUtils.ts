import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

export const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export const sha1 = (s: string): string =>
  crypto.createHash("sha1").update(s, "utf8").digest("hex");

export const toPosixRel = (rootAbs: string, abs: string): string =>
  path.relative(rootAbs, abs).split(path.sep).join("/");

export const writeJson = async <T>(p: string, value: T): Promise<void> => {
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf8");
};

export const readJson = async <T>(p: string): Promise<T> => {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as T;
};

export const readText = async (p: string): Promise<string> => {
  return await fs.readFile(p, "utf8");
};

export const listFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
};
