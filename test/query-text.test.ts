import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";

test("query-text requires --text", async () => {
  await assert.rejects(async () => {
    await runCli(["query-text"]);
  }, /query-text requires --text/);
});

test("query-text rejects invalid --k", async () => {
  await assert.rejects(async () => {
    await runCli(["query-text", "--text", "a photo of a dog", "--k", "nope"]);
  }, /--k must be a positive integer/);
});

test("query-text rejects invalid --minScore", async () => {
  await assert.rejects(async () => {
    await runCli([
      "query-text",
      "--text",
      "a photo of a dog",
      "--minScore",
      "nan",
    ]);
  }, /--minScore must be a number/);
});
