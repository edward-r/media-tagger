import path from "node:path";
import { Asset } from "./types.js";
import { AppConfig } from "./config.js";
import { ensureDir, fileExists, readJson, writeJson } from "./fsUtils.js";
import { exec } from "./exec.js";
import { loadProgress, markRepDone, saveProgress } from "./progress.js";

export const generateRepresentatives = async (
  cfg: AppConfig,
): Promise<readonly Asset[]> => {
  const assetsPath = path.join(cfg.dataDir, "assets.json");
  const assets = await readJson<readonly Asset[]>(assetsPath);

  await ensureDir(cfg.repsDir);
  let prog = await loadProgress(cfg);

  const updated: Asset[] = [];

  for (const a of assets) {
    const repPath = path.join(cfg.repsDir, `${a.id}.jpg`);

    const already = prog.repsDone[a.id] === true;
    const exists = await fileExists(repPath);

    if (!already || !exists) {
      const ok = await makeRep(cfg, a.absPath, a.kind, repPath);
      if (ok) prog = markRepDone(prog, a.id);
    }

    updated.push((await fileExists(repPath)) ? { ...a, repPath } : a);
  }

  await writeJson(assetsPath, updated);
  await saveProgress(cfg, prog);
  return updated;
};

const makeRep = async (
  cfg: AppConfig,
  input: string,
  kind: "image" | "video",
  outputJpg: string,
): Promise<boolean> => {
  const common = ["-y", "-hide_banner", "-loglevel", "error"];

  const args =
    kind === "video"
      ? [
          ...common,
          "-ss",
          `${cfg.videoFrameSecond}`,
          "-i",
          input,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          outputJpg,
        ]
      : [
          ...common,
          "-i",
          input,
          "-vf",
          `scale='if(gt(iw,ih),${cfg.repMaxSizePx},-2)':'if(gt(iw,ih),-2,${cfg.repMaxSizePx})'`,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          outputJpg,
        ];

  const r = await exec("ffmpeg", args);
  return r.code === 0;
};
