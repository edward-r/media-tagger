import path from "node:path";
import { getConfig } from "./config.js";
import {
  ensureDir,
  fileExists,
  readJson,
  sha1,
  toPosixRel,
  writeJson,
} from "./fsUtils.js";
import { walkFiles, manifestPath } from "./manifest.js";
import { detectKind } from "./mediaDetect.js";
import { generateRepresentatives } from "./reps.js";
import { computeEmbeddings } from "./embed.js";
import { querySimilarMulti } from "./query.js";
import { generateReviewHtml } from "./review.js";
import { startReviewServer } from "./reviewServer.js";
import { applyTagsViaSidecars, getProfileAutoTags } from "./apply.js";
import { loadProgress } from "./progress.js";
import { Asset } from "./types.js";
import {
  getVectorStorePaths,
  loadVectorMeta,
  loadVectorIndex,
} from "./vectorStore.js";
import { listProfiles, loadProfile, renderTag } from "./profiles.js";
import { verify, formatVerify } from "./verify.js";
import { exec } from "./exec.js";

export const runCli = async (argv: readonly string[]): Promise<void> => {
  const cfg = getConfig();

  await ensureDir(cfg.dataDir);
  await ensureDir(cfg.repsDir);
  await ensureDir(cfg.reviewDir);
  await ensureDir(cfg.profilesDir);

  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "scan": {
      const assets = await scan(cfg.photoLibRoot, cfg.maxFiles);
      await writeJson(manifestPath(cfg.dataDir), assets);
      console.log(`Scanned assets: ${assets.length}`);
      console.log(`Library root: ${cfg.photoLibRoot}`);
      break;
    }

    case "reps": {
      const assets = await generateRepresentatives(cfg);
      const withReps = assets.filter(
        (a) => typeof a.repPath === "string",
      ).length;
      console.log(`Assets with reps: ${withReps}/${assets.length}`);
      break;
    }

    case "embed": {
      await computeEmbeddings(cfg);

      const store = getVectorStorePaths(cfg.dataDir);
      const meta = await loadVectorMeta(store);
      const idx = await loadVectorIndex(store);

      console.log(`Embeddings stored.`);
      console.log(`Meta: dim=${meta?.dim ?? 0}, count=${meta?.count ?? 0}`);
      console.log(`Index entries: ${Object.keys(idx.idToOffset).length}`);
      break;
    }

    case "query": {
      await cmdQuery(cfg, rest);
      break;
    }

    case "tag-this": {
      await cmdTagThis(cfg, rest);
      break;
    }

    case "review": {
      const outPath = await generateReviewHtml(cfg, {
        autoApplyAfterSave: false,
      });
      console.log(`Review HTML written: ${outPath}`);
      console.log(`Run: media-tagger review-serve --port 8787`);
      break;
    }

    case "review-serve": {
      const args = parseArgs(rest);
      const portStr = args["--port"] ?? "8787";
      const port = Number(portStr);
      if (!Number.isFinite(port) || port <= 0)
        throw new Error("--port must be a positive number");

      if (!(await fileExists(path.join(cfg.reviewDir, "review.html")))) {
        throw new Error(
          `review/review.html not found. Run: media-tagger review`,
        );
      }

      const approvedPath = path.join(cfg.reviewDir, "approved.json");
      const srv = await startReviewServer(cfg, port, { approvedPath });
      console.log(`Review server running: ${srv.url}`);
      console.log(`Saves approvals to: review/approved.json`);
      break;
    }

    case "apply": {
      const args = parseArgs(rest);

      const profileArg = args["--profile"];
      const labelArg = args["--label"];
      const approved =
        args["--approved"] ?? path.join(cfg.reviewDir, "approved.json");

      if (typeof profileArg === "string" && typeof labelArg === "string") {
        const profile = await loadProfile(cfg, profileArg.trim());
        const baseTag = renderTag(profile.tagTemplate, labelArg.trim());

        const auto = getProfileAutoTags(profile);
        await applyTagsViaSidecars(cfg, approved, baseTag, auto);

        console.log(`Applied tag "${baseTag}" using basename XMP sidecars.`);
        console.log(
          `Auto-tags: ${auto.length > 0 ? auto.join(", ") : "(none)"}`,
        );
        break;
      }

      const tag = (args["--tag"] ?? "Subjects|Example").trim();
      if (tag === "")
        throw new Error(`--tag must be non-empty (or use --profile + --label)`);

      const autoTagsRaw = (args["--autoTags"] ?? "").trim();
      const autoTags = parseAutoTags(autoTagsRaw);

      await applyTagsViaSidecars(cfg, approved, tag, autoTags);
      console.log(`Applied tag "${tag}" using basename XMP sidecars.`);
      console.log(
        `Auto-tags: ${autoTags.length > 0 ? autoTags.join(", ") : "(none)"}`,
      );
      break;
    }

    case "status": {
      const prog = await loadProgress(cfg);
      const assetsPath = manifestPath(cfg.dataDir);

      const assets = (await fileExists(assetsPath))
        ? await readJson<readonly Asset[]>(assetsPath)
        : [];

      const repsPresent = assets.filter(
        (a) => typeof a.repPath === "string",
      ).length;

      const store = getVectorStorePaths(cfg.dataDir);
      const meta = await loadVectorMeta(store);
      const idx = await loadVectorIndex(store);

      console.log(`Library root: ${cfg.photoLibRoot}`);
      console.log(`Assets: ${assets.length}`);
      console.log(`Reps present: ${repsPresent}`);
      console.log(`Reps done (progress): ${Object.keys(prog.repsDone).length}`);
      console.log(`Embeddings meta count: ${meta?.count ?? 0}`);
      console.log(
        `Embeddings indexed ids: ${Object.keys(idx.idToOffset).length}`,
      );
      console.log(
        `Embeddings done (progress): ${Object.keys(prog.embedsDone).length}`,
      );
      break;
    }

    case "verify": {
      const lines = await verify(cfg);
      console.log(formatVerify(lines));
      const ok = lines.every((l) => l.ok);
      if (!ok) process.exit(2);
      break;
    }

    default: {
      const profiles = await listProfiles(cfg);
      console.log(`media-tagger

Commands:
  scan
  reps
  embed
  query --anchors "a|b|c" [--profile subjects --label "Teddy"] [--k N] [--minScore 0.25] [--out file.json]
  tag-this --anchors "a|b|c" --profile subjects --label "Teddy" [--port 8787] [--open] [--apply] [--k N] [--minScore 0.25]
  review
  review-serve --port 8787
  apply --profile subjects --label "Teddy" [--approved review/approved.json]
  apply --tag "Subjects|Teddy" [--autoTags year,camera,location]
  status
  verify

Environment:
  PHOTO_LIB=/PATH/TO/LIBRARY
  MAX_FILES=500 (optional)

Profiles in ./profiles:
  ${profiles.length > 0 ? profiles.join(", ") : "(none yet)"}
`);
    }
  }
};

const cmdQuery = async (
  cfg: ReturnType<typeof getConfig>,
  rest: readonly string[],
): Promise<void> => {
  const args = parseArgs(rest);

  const anchorsRaw = args["--anchors"];
  const anchorRaw = args["--anchor"];
  const out = args["--out"] ?? "candidates.json";

  const profileArg = args["--profile"];
  const labelArg = args["--label"];

  const anchors = parseAnchors(anchorsRaw, anchorRaw);

  const profile =
    typeof profileArg === "string" && profileArg.trim() !== ""
      ? await loadProfile(cfg, profileArg.trim())
      : null;

  const kStr = args["--k"];
  const minScoreStr = args["--minScore"];

  const k = parseNumberOr(profile?.queryDefaults.k ?? 700, kStr);
  const minScore = parseNumberOr(
    profile?.queryDefaults.minScore ?? 0.0,
    minScoreStr,
  );

  if (anchors.length === 0) {
    const available = await listProfiles(cfg);
    throw new Error(`Usage:
  media-tagger query --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy"
OR
  media-tagger query --anchor "/path/a.jpg" --k 700 --minScore 0.25 --out "candidates.json"

Profiles available:
  ${available.join(", ") || "(none yet)"}
`);
  }

  if (profile && typeof labelArg === "string" && labelArg.trim() !== "") {
    const baseTag = renderTag(profile.tagTemplate, labelArg.trim());
    console.log(`Profile tag preview: ${baseTag}`);
    console.log(
      `Defaults: k=${profile.queryDefaults.k}, minScore=${profile.queryDefaults.minScore}`,
    );
  }

  const results = await querySimilarMulti(cfg, anchors, k, minScore, out);
  console.log(`Wrote data/${out} with ${results.length} rows.`);
  console.log(`Also updated data/last_query.json`);
};

const cmdTagThis = async (
  cfg: ReturnType<typeof getConfig>,
  rest: readonly string[],
): Promise<void> => {
  const args = parseArgs(rest);

  const anchorsRaw = args["--anchors"];
  const anchorRaw = args["--anchor"];
  const anchors = parseAnchors(anchorsRaw, anchorRaw);

  const profileArg = args["--profile"];
  const labelArg = args["--label"];
  const portStr = args["--port"] ?? "8787";
  const shouldOpen = args["--open"] === "true";
  const autoApplyAfterSave = args["--apply"] === "true";

  if (anchors.length === 0)
    throw new Error(`tag-this requires --anchors or --anchor`);
  if (typeof profileArg !== "string" || profileArg.trim() === "")
    throw new Error(`tag-this requires --profile`);
  if (typeof labelArg !== "string" || labelArg.trim() === "")
    throw new Error(`tag-this requires --label`);

  const profile = await loadProfile(cfg, profileArg.trim());

  const k = parseNumberOr(profile.queryDefaults.k, args["--k"]);
  const minScore = parseNumberOr(
    profile.queryDefaults.minScore,
    args["--minScore"],
  );

  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0)
    throw new Error(`--port must be a positive number`);

  const out = args["--out"] ?? "candidates.json";
  const baseTag = renderTag(profile.tagTemplate, labelArg.trim());
  const autoTags = getProfileAutoTags(profile);

  console.log(`Tag: ${baseTag}`);
  console.log(
    `Auto-tags: ${autoTags.length > 0 ? autoTags.join(", ") : "(none)"}`,
  );
  console.log(`Query: k=${k}, minScore=${minScore}`);
  console.log(`Writing: data/${out} + data/last_query.json`);

  await querySimilarMulti(cfg, anchors, k, minScore, out);

  const reviewPath = await generateReviewHtml(cfg, { autoApplyAfterSave });
  console.log(`Review HTML written: ${reviewPath}`);

  const approvedPath = path.join(cfg.reviewDir, "approved.json");

  const srv = await startReviewServer(cfg, port, {
    approvedPath,
    apply: { baseTag, autoTags },
  });

  console.log(`Review server running: ${srv.url}`);
  console.log(`Save approvals to: review/approved.json`);
  console.log(
    `Apply mode: ${autoApplyAfterSave ? "AUTO after Save" : "manual (click Apply tags)"}`,
  );

  if (shouldOpen) {
    const r = await exec("open", [srv.url]);
    if (r.code !== 0)
      console.log(`Could not auto-open browser. Open manually: ${srv.url}`);
  }
};

const scan = async (
  root: string,
  maxFiles?: number,
): Promise<readonly Asset[]> => {
  const allFiles = await walkFiles(root);
  const assets: Asset[] = [];

  for (const absPath of allFiles) {
    const kind = detectKind(absPath);
    if (!kind) continue;

    const relPath = toPosixRel(root, absPath);
    const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
    const id = sha1(relPath);

    assets.push({ id, absPath, relPath, ext, kind });

    if (typeof maxFiles === "number" && assets.length >= maxFiles) break;
  }

  return assets;
};

const parseArgs = (
  argv: readonly string[],
): Readonly<Record<string, string | undefined>> => {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k || !k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (typeof v === "string" && !v.startsWith("--")) out[k] = v;
    else out[k] = "true";
  }
  return out;
};

const parseAnchors = (
  anchorsRaw: string | undefined,
  anchorRaw: string | undefined,
): readonly string[] => {
  if (typeof anchorsRaw === "string" && anchorsRaw.trim() !== "") {
    return anchorsRaw
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  if (typeof anchorRaw === "string" && anchorRaw.trim() !== "")
    return [anchorRaw.trim()];
  return [];
};

const parseNumberOr = (fallback: number, v: string | undefined): number => {
  if (typeof v !== "string" || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const parseAutoTags = (
  csv: string,
): readonly ("year" | "camera" | "location")[] => {
  if (csv.trim() === "") return [];
  const parts = csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const allowed = new Set<"year" | "camera" | "location">([
    "year",
    "camera",
    "location",
  ]);
  return parts.filter((p): p is "year" | "camera" | "location" =>
    allowed.has(p as "year" | "camera" | "location"),
  );
};

// Allow running via `tsx src/cli.ts <cmd>` directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exit(1);
  });
}
