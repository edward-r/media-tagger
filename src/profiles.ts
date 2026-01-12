import path from "node:path";
import { AppConfig } from "./config.js";
import { TagProfile } from "./types.js";
import { fileExists, listFiles, readJson } from "./fsUtils.js";

export const loadProfile = async (
  cfg: AppConfig,
  profilePathOrName: string,
): Promise<TagProfile> => {
  if (profilePathOrName.endsWith(".json")) {
    const abs = path.isAbsolute(profilePathOrName)
      ? profilePathOrName
      : path.join(process.cwd(), profilePathOrName);

    if (!(await fileExists(abs))) throw new Error(`Profile not found: ${abs}`);
    return validateProfile(await readJson<TagProfile>(abs));
  }

  const abs = path.join(cfg.profilesDir, `${profilePathOrName}.json`);
  if (!(await fileExists(abs))) throw new Error(`Profile not found: ${abs}`);
  return validateProfile(await readJson<TagProfile>(abs));
};

export const listProfiles = async (
  cfg: AppConfig,
): Promise<readonly string[]> => {
  if (!(await fileExists(cfg.profilesDir))) return [];
  const files = await listFiles(cfg.profilesDir);
  return files
    .map((f) => path.basename(f))
    .filter((n) => n.toLowerCase().endsWith(".json"))
    .map((n) => n.replace(/\.json$/i, ""));
};

export const renderTag = (tpl: string, label: string): string => {
  return tpl.replaceAll("{label}", label.trim());
};

const validateProfile = (p: TagProfile): TagProfile => {
  if (!p || typeof p !== "object")
    throw new Error("Invalid profile: not an object.");
  if (typeof p.name !== "string" || p.name.trim() === "")
    throw new Error("Invalid profile: name.");
  if (typeof p.tagTemplate !== "string" || p.tagTemplate.trim() === "")
    throw new Error("Invalid profile: tagTemplate.");
  if (!p.queryDefaults || typeof p.queryDefaults !== "object")
    throw new Error("Invalid profile: queryDefaults.");

  const k = p.queryDefaults.k;
  const minScore = p.queryDefaults.minScore;

  if (typeof k !== "number" || !Number.isFinite(k) || k <= 0)
    throw new Error("Invalid profile: queryDefaults.k");
  if (typeof minScore !== "number" || !Number.isFinite(minScore))
    throw new Error("Invalid profile: queryDefaults.minScore");

  return p;
};
