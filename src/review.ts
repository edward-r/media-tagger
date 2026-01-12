import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { Asset, QueryRow } from "./types.js";
import { ensureDir, readJson } from "./fsUtils.js";

export type ReviewOptions = Readonly<{
  autoApplyAfterSave: boolean;
}>;

export const generateReviewHtml = async (
  cfg: AppConfig,
  opts: ReviewOptions,
): Promise<string> => {
  const rows = await readJson<readonly QueryRow[]>(
    path.join(cfg.dataDir, "last_query.json"),
  );
  const assets = await readJson<readonly Asset[]>(
    path.join(cfg.dataDir, "assets.json"),
  );

  const idToRep = new Map<string, string>(
    assets
      .filter((a) => typeof a.repPath === "string")
      .map((a) => [a.id, a.repPath as string]),
  );

  await ensureDir(cfg.reviewDir);

  const html = buildHtml(rows, idToRep, opts);
  const outPath = path.join(cfg.reviewDir, "review.html");
  await fs.writeFile(outPath, html, "utf8");
  return outPath;
};

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const buildHtml = (
  rows: readonly QueryRow[],
  idToRep: ReadonlyMap<string, string>,
  opts: ReviewOptions,
): string => {
  const cards = rows
    .map((r, i) => {
      const rep = idToRep.get(r.id);
      const repSrc = rep ? `file://${rep}` : "";
      const checked = i < 120 ? "checked" : "";
      return `
      <div class="card">
        <label class="row">
          <input type="checkbox" data-id="${escapeHtml(r.id)}" ${checked} />
          <span class="score">score: ${r.score.toFixed(4)}</span>
        </label>
        <div class="path">${escapeHtml(r.relPath)}</div>
        ${rep ? `<img src="${repSrc}" />` : `<div class="missing">No representative image</div>`}
      </div>`;
    })
    .join("\n");

  const autoApply = opts.autoApplyAfterSave ? "true" : "false";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>media-tagger review</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 10px; }
    img { width: 100%; height: auto; border-radius: 8px; margin-top: 8px; }
    .path { font-size: 12px; color: #444; margin-top: 6px; word-break: break-all; }
    .score { margin-left: 8px; font-size: 12px; color: #111; }
    .topbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; position: sticky; top: 0; background: white; padding: 10px 0; z-index: 10; flex-wrap: wrap; }
    button { padding: 8px 12px; border-radius: 10px; border: 1px solid #ccc; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .status { font-size: 12px; color: #333; }
    .pill { font-size: 12px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="topbar">
    <button id="save">Save approvals</button>
    <button id="apply" disabled>Apply tags</button>
    <button id="selectAll">Select all</button>
    <button id="selectNone">Select none</button>
    <span class="pill" id="mode"></span>
    <span id="status" class="status"></span>
  </div>

  <div class="grid">${cards}</div>

  <script type="module">
    const AUTO_APPLY_AFTER_SAVE = ${autoApply};

    const qs = (sel) => document.querySelector(sel);

    const setStatus = (msg) => {
      const el = qs("#status");
      if (el) el.textContent = msg;
    };

    const setMode = () => {
      const el = qs("#mode");
      if (!el) return;
      el.textContent = AUTO_APPLY_AFTER_SAVE ? "Mode: Save → Auto-Apply" : "Mode: Save → Apply manually";
    };

    const getApproved = () => {
      const checks = Array.from(document.querySelectorAll("input[type=checkbox]"));
      return checks
        .filter((c) => c.checked)
        .map((c) => c.getAttribute("data-id"))
        .filter((x) => typeof x === "string");
    };

    const saveApprovals = async () => {
      const approved = getApproved();
      setStatus(\`Saving \${approved.length} approvals…\`);

      const res = await fetch("/api/approved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved })
      });

      if (!res.ok) {
        const txt = await res.text();
        setStatus("Save failed: " + txt);
        return { ok: false, count: 0 };
      }

      const json = await res.json();
      setStatus(\`Saved: \${json.count} approvals\`);
      qs("#apply")?.removeAttribute("disabled");
      return { ok: true, count: json.count ?? 0 };
    };

    const applyTags = async () => {
      setStatus("Applying tags via server… (this can take a while)");
      qs("#apply")?.setAttribute("disabled", "true");

      const res = await fetch("/api/apply", { method: "POST" });

      if (!res.ok) {
        const txt = await res.text();
        setStatus("Apply failed: " + txt);
        qs("#apply")?.removeAttribute("disabled");
        return;
      }

      const json = await res.json();
      setStatus(\`Applied: \${json.applied ?? 0} files (see sidecar .xmp files)\`);
    };

    qs("#selectAll")?.addEventListener("click", () => {
      document.querySelectorAll("input[type=checkbox]").forEach((c) => c.checked = true);
      setStatus("Selected all");
    });

    qs("#selectNone")?.addEventListener("click", () => {
      document.querySelectorAll("input[type=checkbox]").forEach((c) => c.checked = false);
      setStatus("Selected none");
    });

    qs("#save")?.addEventListener("click", async () => {
      const s = await saveApprovals();
      if (s.ok && AUTO_APPLY_AFTER_SAVE) await applyTags();
    });

    qs("#apply")?.addEventListener("click", async () => {
      await applyTags();
    });

    // boot
    setMode();

    fetch("/api/approved").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.approved)) {
        setStatus(\`Existing approvals: \${j.approved.length}\`);
        qs("#apply")?.removeAttribute("disabled");
      }
    }).catch(() => {});
  </script>
</body>
</html>`;
};
