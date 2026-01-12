import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { Asset, TagProfile } from "./types.js";
import { readJson } from "./fsUtils.js";
import { exec } from "./exec.js";

type ApprovedFile = Readonly<{ approved: readonly string[] }>;

export const applyTagsViaSidecars = async (
  cfg: AppConfig,
  approvedJsonPath: string,
  baseTag: string,
  autoTags: readonly ("year" | "camera" | "location")[],
): Promise<void> => {
  const assets = await readJson<readonly Asset[]>(
    path.join(cfg.dataDir, "assets.json"),
  );
  const approved = await readApproved(approvedJsonPath);
  const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));

  for (const id of approved) {
    const a = idToAsset.get(id);
    if (!a) continue;

    const xmpPath = sidecarBasenamePath(a.absPath);

    const derived = await deriveAutoTags(a.absPath, autoTags);
    const tags = [baseTag, ...derived].filter((t) => t.trim() !== "");

    const subjectArgs = tags.flatMap((t) => [`-XMP:Subject+=${t}`]);

    const args = [
      "-overwrite_original",
      ...subjectArgs,
      "-o",
      xmpPath,
      a.absPath,
    ];

    const r = await exec("exiftool", args);
    if (r.code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`exiftool failed for: ${a.absPath}\n${r.stderr}`);
    }
  }
};

export const getProfileAutoTags = (
  profile: TagProfile,
): readonly ("year" | "camera" | "location")[] => {
  const a = profile.autoTags;
  if (!Array.isArray(a)) return [];
  const allowed = new Set<"year" | "camera" | "location">([
    "year",
    "camera",
    "location",
  ]);
  return a.filter((x): x is "year" | "camera" | "location" => allowed.has(x));
};

const sidecarBasenamePath = (absMediaPath: string): string => {
  const dir = path.dirname(absMediaPath);
  const base = path.basename(absMediaPath, path.extname(absMediaPath));
  return path.join(dir, `${base}.xmp`);
};

const readApproved = async (p: string): Promise<readonly string[]> => {
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw) as ApprovedFile;

  if (!parsed || !Array.isArray(parsed.approved))
    throw new Error(`Invalid approved.json format at ${p}`);
  if (!parsed.approved.every((x) => typeof x === "string"))
    throw new Error(`Invalid approved.json: approved must be string[]`);
  return parsed.approved;
};

type ExifMini = Readonly<{
  DateTimeOriginal?: string;
  CreateDate?: string;
  Model?: string;
  GPSLatitude?: string;
  GPSLongitude?: string;
  Country?: string;
  State?: string;
  City?: string;
}>;

const deriveAutoTags = async (
  absPath: string,
  autoTags: readonly ("year" | "camera" | "location")[],
): Promise<readonly string[]> => {
  if (autoTags.length === 0) return [];

  const wantYear = autoTags.includes("year");
  const wantCamera = autoTags.includes("camera");
  const wantLocation = autoTags.includes("location");

  const args = [
    "-j",
    "-n",
    "-DateTimeOriginal",
    "-CreateDate",
    "-Model",
    "-GPSLatitude",
    "-GPSLongitude",
    "-Country",
    "-State",
    "-City",
    absPath,
  ];

  const r = await exec("exiftool", args);
  if (r.code !== 0) return [];

  const parsed = safeJson(r.stdout);
  const exif = pickFirstExif(parsed);

  const tags: string[] = [];

  if (wantYear) {
    const year = extractYear(exif.DateTimeOriginal ?? exif.CreateDate);
    if (typeof year === "string") tags.push(`Year|${year}`);
  }

  if (wantCamera) {
    if (typeof exif.Model === "string" && exif.Model.trim() !== "") {
      tags.push(`Camera|${exif.Model.trim()}`);
    }
  }

  if (wantLocation) {
    const loc = buildLocationTag(exif.Country, exif.State, exif.City);
    if (typeof loc === "string") tags.push(loc);
  }

  return tags;
};

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

const pickFirstExif = (v: unknown): ExifMini => {
  if (!Array.isArray(v) || v.length < 1) return {};
  const first = v[0];
  if (typeof first !== "object" || first === null) return {};
  return first as ExifMini;
};

const extractYear = (dt: string | undefined): string | undefined => {
  if (typeof dt !== "string") return undefined;
  const m = /^(\d{4})[:\-]/.exec(dt.trim());
  return m?.[1];
};

const buildLocationTag = (
  country: string | undefined,
  state: string | undefined,
  city: string | undefined,
): string | undefined => {
  const parts = [country, state, city]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x !== "");

  if (parts.length === 0) return undefined;
  return `Location|${parts.join("|")}`;
};
