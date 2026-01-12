import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { applyTagsViaSidecars } from "./apply.js";
import { fileExists } from "./fsUtils.js";

export type ReviewServer = Readonly<{
  close: () => Promise<void>;
  url: string;
}>;

export type ReviewServerOptions = Readonly<{
  approvedPath: string;
  // If provided, /api/apply becomes active
  apply?: Readonly<{
    baseTag: string;
    autoTags: readonly ("year" | "camera" | "location")[];
  }>;
}>;

export const startReviewServer = async (
  cfg: AppConfig,
  port: number,
  opts: ReviewServerOptions,
): Promise<ReviewServer> => {
  const reviewHtmlPath = path.join(cfg.reviewDir, "review.html");
  const approvedPath = opts.approvedPath;

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && (url === "/" || url.startsWith("/review.html"))) {
      const html = await fs.readFile(reviewHtmlPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (method === "POST" && url === "/api/approved") {
      const body = await readBody(req);
      const parsed = safeJson(body);
      const approved = validateApproved(parsed);

      await fs.writeFile(
        approvedPath,
        JSON.stringify({ approved }, null, 2),
        "utf8",
      );

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, count: approved.length }));
      return;
    }

    if (method === "GET" && url === "/api/approved") {
      try {
        const raw = await fs.readFile(approvedPath, "utf8");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(raw);
      } catch {
        res.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({ ok: false, error: "approved.json not found" }),
        );
      }
      return;
    }

    if (method === "POST" && url === "/api/apply") {
      if (!opts.apply) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Apply is not enabled for this server session.");
        return;
      }

      if (!(await fileExists(approvedPath))) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("approved.json not found. Click 'Save approvals' first.");
        return;
      }

      const before = await readApprovedCount(approvedPath);

      await applyTagsViaSidecars(
        cfg,
        approvedPath,
        opts.apply.baseTag,
        opts.apply.autoTags,
      );

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, applied: before }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const url = `http://localhost:${port}/review.html`;

  return {
    url,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

const readBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

const validateApproved = (v: unknown): readonly string[] => {
  if (typeof v !== "object" || v === null)
    throw new Error("Invalid JSON payload.");
  const rec = v as Record<string, unknown>;
  const approved = rec["approved"];
  if (!Array.isArray(approved))
    throw new Error("Payload must be { approved: string[] }.");
  if (!approved.every((x) => typeof x === "string"))
    throw new Error("approved must be string[].");
  return approved;
};

const readApprovedCount = async (approvedPath: string): Promise<number> => {
  const raw = await fs.readFile(approvedPath, "utf8");
  const parsed = safeJson(raw);
  if (typeof parsed !== "object" || parsed === null) return 0;
  const rec = parsed as Record<string, unknown>;
  const a = rec["approved"];
  if (!Array.isArray(a)) return 0;
  return a.length;
};
