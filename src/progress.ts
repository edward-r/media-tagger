import path from "node:path";
import { AppConfig } from "./config.js";
import { fileExists, readJson, writeJson } from "./fsUtils.js";

export type Progress = Readonly<{
  repsDone: Readonly<Record<string, true>>;
  embedsDone: Readonly<Record<string, true>>;
}>;

export const loadProgress = async (cfg: AppConfig): Promise<Progress> => {
  const p = path.join(cfg.dataDir, "progress.json");
  if (!(await fileExists(p))) return { repsDone: {}, embedsDone: {} };
  return await readJson<Progress>(p);
};

export const saveProgress = async (
  cfg: AppConfig,
  prog: Progress,
): Promise<void> => {
  const p = path.join(cfg.dataDir, "progress.json");
  await writeJson(p, prog);
};

export const markRepDone = (prog: Progress, id: string): Progress => ({
  ...prog,
  repsDone: { ...prog.repsDone, [id]: true },
});

export const markEmbedDone = (prog: Progress, id: string): Progress => ({
  ...prog,
  embedsDone: { ...prog.embedsDone, [id]: true },
});
