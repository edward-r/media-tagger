# media-tagger: Project Guide

This guide explains the `media-tagger` project end-to-end.
It is written for a first-year developer with **zero ML background**.
It aims for a **middle school reading level**.

This document is based only on these “ground truth” files:
- `README.md`
- `docs/tooling.md`
- `package.json`
- `src/cli.ts`
- `src/embed.ts`
- `src/query.ts`
- `src/queryText.ts`
- `src/topK.ts`

If I say **Assumption**, it means the repo probably works that way,
but it is not proven by the files above.

---

## What this project does (in plain English)

`media-tagger` is a local-first pipeline for tagging photos and videos.

“Local-first” means:
- Your computer does the work.
- Your media stays on your disk.
- You do not need a cloud service.

From `README.md`, the pipeline does this:
1. Scan a folder of mixed photo/video formats.
2. Create representative JPGs (thumbnails / video frames).
3. Compute CLIP embeddings locally.
4. Find “all media like this” using multi-anchor similarity search.
   - Optional: run `query-text` with a CLIP text prompt as a broad prefilter.
5. Review matches in a lightweight browser UI.
6. Write tags back to disk via **XMP sidecar files**.

One sentence version:
- You show it a few examples (or a text prompt), and it finds similar media.

---

## Big picture: the pipeline (a simple story)

Imagine you have a giant box of photos and videos.
You want to label them.
But you do not want to click 10,000 times.

So you build a helper.
Your helper works in stages.
Each stage has a reason.

### Step 1: Scan (make a list)

What it does:
- Walks your media folder.
- Creates a saved list of items.

Why it exists:
- Later steps need a “source of truth” list.
- Scanning can be slow.
- Saving the list means you can rerun later steps.

Output (confirmed by code usage):
- `cfg.dataDir/assets.json`

### Step 2: Reps (make a “representative” image)

A “rep” is a JPG that represents an asset.

Why reps exist:
- Photos come in many sizes and formats.
- Videos are not images.
- The embedding model in this repo takes an image path.
  It is used like this:

```ts
// src/embed.ts
await extractor(imagePath, { pooling: "mean", normalize: true });
```

So we need an image path for every asset.
That is what reps give us.

**Assumption (based on `README.md` mentioning video frames):**
- Photos get resized to a rep JPG.
- Videos get one frame extracted as a rep JPG.

### Step 3: Embed (turn each rep into numbers)

This step creates an “embedding” for each rep.
An embedding is a special list of numbers.

Why embeddings exist:
- Comparing “meaning” directly from pixels is hard.
- Embeddings make comparison easy.
- Once you have embeddings, you can search quickly.

Output (confirmed by code usage):
- A vector store under `cfg.dataDir` (details in “Data and files”).

### Step 4: Query (find similar items)

You give the tool one or more anchor images.
Anchors are examples.

Then query does:
- Compute embeddings for the anchors.
- Compare each stored embedding against anchors.
- Keep the best matches.

Output (confirmed by code):
- `cfg.dataDir/last_query.json`
- `cfg.dataDir/<outFileName>`

### Step 5: Review (human check)

The repo says there is a review UI.
`package.json` includes:
- `npm run review`
- `npm run review:serve`

**Assumption (based on script names):**
- Review reads `last_query.json`.
- Review helps you accept/reject matches.

### Step 6: Apply tags (write XMP sidecars)

The repo writes tags to disk with XMP sidecar files.

Why sidecars exist:
- They keep your originals untouched.
- Many photo tools can read sidecars.

**Assumption (based on `README.md`):**
- Sidecars use a “basename convention” (same name, different extension).

---

## Key tools and libraries (and why they exist)

### Node.js + TypeScript

This is a Node.js project.
It is written in TypeScript.

What that means:
- You run commands with `npm run ...`.
- TypeScript adds types to JavaScript.
- Types are like labels.
  They help the code avoid mistakes.

### `@xenova/transformers`

From `docs/tooling.md`:
- `@xenova/transformers` runs Transformer models in JS.
- It can run in Node.js without Python.
- It can load models by name and cache them locally.

In this repo it is used like this:

```ts
// src/embed.ts and src/query.ts
await pipeline("feature-extraction", "Xenova/clip-vit-base-patch32");
```

What “feature-extraction” means (plain English):
- “Take this image and give me its embedding.”

### `ffmpeg` (system tool)

`README.md` requires:

```bash
brew install ffmpeg exiftool
```

`ffmpeg` is a command-line tool for video and image processing.

**Assumption (based on pipeline description):**
- It creates rep JPGs for videos (extracting a frame).
- It may also resize or convert images.

### `exiftool` (system tool)

`exiftool` is a metadata tool.
Metadata means “data about a file”.
Example metadata:
- date taken
- camera model
- tags

**Assumption (based on `README.md` + XMP mention):**
- It writes tags into XMP sidecar files.

---

## ML Concepts You Need (explained like you’re new)

ML can sound scary.
But this project uses only a few ideas.

### First: what is a “vector”?

A **vector** is just a list of numbers.

Example:
- `[0.2, -1.1, 3.4]` is a vector.

In this repo, vectors represent images.
So you will also hear:
- “vector”
- “embedding vector”
- “embedding”

They all mean roughly the same thing here.

#### Vector length (also called “dimension”)

A vector has a length.
Length means “how many numbers are in the list”.

Example:
- `[10, 20, 30]` has length 3.

In the code, this is called `dim`.
You can see it in `src/query.ts`:

```ts
// src/query.ts
await streamAllVectors(store, meta.dim, async (offset, vec) => {
  ...
});
```

And in `src/embed.ts`:

```ts
// src/embed.ts
const dim = existingMeta?.dim ?? vec.length;
```

Plain English:
- All embeddings must have the same length.
- Otherwise comparisons break.

#### Why numbers?

Computers are good at math.
They are not good at “feelings” like “this looks like a dog”.

So we turn images into numbers.
Then we do math on numbers.
That is the whole trick.

#### What do the numbers mean?

Each number does not have a simple human meaning.
It is not like:
- “slot 12 = how blue the sky is”

Instead:
- The model learns a hidden code.
- The code works well for comparing images.

Metaphor 1: **Fingerprint**
- A fingerprint is not a face.
- But it still helps you match people.
- An embedding is not an image.
- But it still helps you match images.

Metaphor 2: **Map coordinates**
- You can’t “see” a city just from coordinates.
- But you can tell what is close.
- Embeddings are like coordinates in a “meaning space”.

### Embeddings (the big idea)

An **embedding** is a vector made by a model.

In this repo:
- input = a rep JPG path
- output = a vector (list of numbers)

From `src/embed.ts`:

```ts
// src/embed.ts
const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
```

That `raw` result is then turned into a plain number list.

### CLIP (conceptual)

CLIP is a model that can create useful embeddings for images **and text prompts**.

In this repo:
- image reps are embedded during `embed`
- anchor images are embedded during `query` / `tag-this`
- text prompts are embedded during `query-text`

Important idea:
- The model was trained so that similar things end up near each other.
- “Near” is measured by a similarity score.

This repo uses the model:
- `Xenova/clip-vit-base-patch32`

### Pooling (especially `mean`)

Some models output more than one vector for an image.
They may output:
- one vector per “patch” (small square region)

Then you need **pooling**.
Pooling means: “turn many vectors into one vector”.

This repo uses `pooling: "mean"`.
Mean pooling means “average”.

Averaging idea:
- Add them up.
- Divide by the count.

Why that helps:
- You want exactly one embedding per image.
- One embedding is easy to store.
- One embedding is easy to compare.

### Normalization (what it changes)

Normalization makes vectors have a standard size.
This is also called “unit length”.

Metaphor 3: **Same-length arrows**
- Think of a vector as an arrow.
- Long arrow and short arrow can point the same way.
- Normalization makes them the same length.
- Now you compare direction, not size.

Why normalization matters here:
- It makes similarity scores more consistent.
- It makes dot product act like cosine similarity.

The repo normalizes in two places:
1. It asks the model for `normalize: true`.
2. It calls `normalize(...)` again in query.

That second normalization is a safety belt.
It protects you if:
- stored vectors were made differently
- an anchor vector is slightly off

### Similarity: dot product vs cosine (no heavy math)

Goal:
- Measure how similar two embeddings are.

#### Dot product (plain English)

Dot product does this:
- line up the two lists
- multiply matching slots
- add them up

Tiny example:
- `a = [1, 2]`
- `b = [3, 4]`
- dot(a, b) = `1*3 + 2*4` = `11`

This repo uses dot product:

```ts
// src/query.ts
const s = dot(a, v);
```

#### Cosine similarity (plain English)

Cosine similarity is about “angle” between arrows.
- same direction → high similarity
- different direction → low similarity

You don’t need the formula.
Just remember:
- If vectors are normalized, dot product becomes an “angle score”.

This is why normalization and dot product work well together.

### Thresholds: `k` and `minScore`

When you query, you must decide:
- how many results you want
- how strict to be

#### `k` = keep the top `k` matches

`k` is “how many results to keep”.
- If `k = 20`, you keep 20 best matches.
- If `k = 200`, you keep 200 best matches.

Bigger `k`:
- more results
- more time to review

Smaller `k`:
- fewer results
- faster review

In code, `k` is used to build the top-k helper (implemented in `src/topK.ts` and reused by both image-anchor queries and text-prompt queries):

```ts
// src/query.ts
const top = createTopK<TopItem>(k, (x) => x.score);
```

Also note:

```ts
// src/query.ts
const cap = Math.max(1, Math.floor(k));
```

Meaning:
- `k` is rounded down.
- `k` can’t go below 1.

#### `minScore` = ignore weak matches

`minScore` is a filter.
If score is below `minScore`, the item is skipped.

From `src/query.ts`:

```ts
// src/query.ts
if (best < minScore) return;
```

Higher `minScore`:
- stricter
- fewer false positives
- might miss real matches

Lower `minScore`:
- more forgiving
- more results
- more junk

### Multi-anchor search (best match among many examples)

Sometimes one example is not enough.
Example:
- You want “my black dog”.
- In some photos, it is in sunlight.
- In some photos, it is in shadow.

So you provide multiple anchors.

How multi-anchor works:
- Compare each candidate to every anchor.
- Keep the best score.

From `src/query.ts`:

```ts
let best = -1;
for (const a of anchorVecs) {
  const s = dot(a, v);
  if (s > best) best = s;
}
```

Metaphor 4: **Multiple magnets**
- Each anchor is a magnet.
- A candidate only needs to stick to one magnet.

---

### Pseudocode 1: embedding generation (what `embed` does)

```text
assets = read assets.json
reps = filter assets where repPath exists
store = get vector store paths
existingIndex = load id -> offset index
existingMeta = load meta (dim)
progress = load progress
extractor = pipeline(feature-extraction, CLIP model)

for each rep in reps:
  alreadyDone = progress says done OR index has id
  if alreadyDone:
    continue

  raw = extractor(rep.repPath, pooling=mean, normalize=true)
  vec = extractVector(raw)  // convert to number[]
  dim = existingMeta.dim if present else vec.length
  appendVector(store, rep.id, vec, dim)
  mark progress as done

save progress
```

### Pseudocode 2: multi-anchor similarity (what `query` does)

```text
anchors = [anchor1Path, anchor2Path, ...]
anchorVecs = []
for each anchorPath:
  raw = extractor(anchorPath, pooling=mean, normalize=true)
  vec = extract anchor vector
  anchorVecs.push(normalize(vec))

top = topK(k)

stream all stored vectors:
  v = normalize(vector)
  best = -infinity
  for each anchorVec in anchorVecs:
    score = dot(anchorVec, v)
    best = max(best, score)

  if best >= minScore:
    top.offer(best)

results = top.valuesSortedDesc()
```

### Pseudocode 3: top-k maintenance (what `createTopK` does)

```text
items = []  // we keep up to k items

offer(x):
  if items.size < k:
    add x
    if items.size == k:
      sort ascending by score
    return

  min = items[0]  // smallest score
  if x.score <= min.score:
    return  // not good enough

  remove min
  insert x into items so it stays sorted ascending
  trim to size k

valuesSortedDesc():
  return items sorted descending
```

---

## Data and files this tool creates

This section describes files we can confirm from code.
When we guess, it is labeled.

### `assets.json` (confirmed)

Both `src/embed.ts` and `src/query.ts` read:

```ts
path.join(cfg.dataDir, "assets.json")
```

`src/embed.ts` also proves that assets can have `repPath`:

```ts
const reps = assets.filter((a) => typeof a.repPath === "string");
```

So `assets.json` likely includes these fields:
- `id`
- `absPath`
- `relPath`
- `repPath` (optional)

We know these names because `src/query.ts` outputs them:

```ts
return { id, score: b.score, absPath: a.absPath, relPath: a.relPath };
```

### Vector store (confirmed concept, unknown exact filenames)

The code clearly shows a disk-backed vector store.

From `src/embed.ts`:
- `getVectorStorePaths(cfg.dataDir)`
- `loadVectorIndex(store)`
- `loadVectorMeta(store)`
- `appendVector(store, id, vec, dim)`

From `src/query.ts`:
- `loadVectorIndex(store)`
- `loadVectorMeta(store)`
- `streamAllVectors(store, meta.dim, callback)`

What a “vector store” means (plain English):
- A place on disk where we keep vectors.
- We also keep an index so we can link vectors back to assets.

**Assumption (based on names `index`, `meta`, `offset`):**
- There is a big file (or files) with raw vectors.
- There is a JSON index mapping `id -> offset`.
- “Offset” is like a page number into the vector file.
- There is meta info containing at least `dim`.

### Progress tracking (confirmed concept)

`src/embed.ts` uses a progress object:
- `loadProgress(cfg)`
- `markEmbedDone(prog, id)`
- `saveProgress(cfg, prog)`

It checks:

```ts
prog.embedsDone[r.id] === true
```

Plain English:
- The tool remembers which assets were embedded.
- So it can skip them later.

### Query outputs (confirmed)

Query always writes two JSON files:

```ts
await writeJson(path.join(cfg.dataDir, outFileName), rows);
await writeJson(path.join(cfg.dataDir, "last_query.json"), rows);
```

This is useful:
- `last_query.json` is always the latest query.
- `outFileName` is a named save.

---

## How the code works (file-by-file)

This is a deeper walk-through.
It focuses on:
- what each file does
- how data flows
- key functions and edge cases

### `README.md`

`README.md` is the project promise.
It tells you:
- what the pipeline does
- that it is local-first
- that tags are written via XMP sidecars

It also lists macOS requirements:

```bash
brew install ffmpeg exiftool
```

### `docs/tooling.md`

This explains `@xenova/transformers`.
Key points:
- It runs Transformer models in JS, not Python.
- It provides “pipelines” like Hugging Face.
- It can download models by name and cache them.

Important caveats (from the doc):
- Not every model is supported.
- Performance varies a lot by device.

Plain English:
- Your first run may download a model.
- Later runs should be faster.

### `package.json`

This file defines scripts you run.

Scripts (confirmed):
- `npm run scan`
- `npm run reps`
- `npm run embed`
- `npm run query`
- `npm run query-text`
- `npm run tag-this`
- `npm run review`
- `npm run review:serve`
- `npm run apply`
- `npm run status`
- `npm run verify`
- `npm test`

Each script calls `tsx src/cli.ts <command>`.

So there is a CLI router at `src/cli.ts`.
**Assumption:** it parses args and loads `AppConfig`.

Dependency summary:
- `@xenova/transformers` is the only runtime dependency.
- `tsx` runs TypeScript files directly.
- `typescript` compiles with `npm run build`.

### `src/embed.ts` (compute and store embeddings)

This file answers the question:
- “How do we build embeddings for our whole library?”

#### Key function: `computeEmbeddings(cfg)`

Signature:

```ts
export const computeEmbeddings = async (cfg: AppConfig): Promise<void> => {
```

Inputs:
- `cfg.dataDir` (where data files live)

Outputs:
- vectors appended into the vector store
- updated progress saved

##### Data flow step-by-step

1) Read assets:

```ts
const assets = await readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"));
```

2) Pick only assets with reps:

```ts
const reps = assets.filter((a) => typeof a.repPath === "string");
```

Plain English:
- If an asset does not have a rep JPG, it cannot be embedded.

3) Load vector store index and meta:

```ts
const existingIdx = await loadVectorIndex(store);
const existingMeta = await loadVectorMeta(store);
```

4) Load progress:

```ts
let prog = await loadProgress(cfg);
```

5) Create the extractor (model pipeline):

```ts
const extractor = (await pipeline(
  "feature-extraction",
  "Xenova/clip-vit-base-patch32",
)) as Extractor;
```

6) For each rep, skip if already embedded:

```ts
const already =
  prog.embedsDone[r.id] === true ||
  typeof existingIdx.idToOffset[r.id] === "number";
if (already) continue;
```

Why two checks?
- Progress file might say “done”.
- Index might already contain it.
- Either way, don’t redo work.

7) Embed one rep:

```ts
const vec = await embedOne(extractor, r.repPath);
```

8) Decide vector dimension:

```ts
const dim = existingMeta?.dim ?? vec.length;
```

Plain English:
- If the store already knows the dimension, use it.
- Otherwise, trust the vector you just got.

9) Append vector and mark progress:

```ts
await appendVector(store, r.id, vec, dim);
prog = markEmbedDone(prog, r.id);
```

10) Save progress at the end:

```ts
await saveProgress(cfg, prog);
```

#### Helper: `embedOne(extractor, imagePath)`

This function calls the model.

```ts
const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
return extractVector(raw);
```

Two important options:
- `pooling: "mean"` → average down to one vector
- `normalize: true` → return a normalized vector

#### Helper: `extractVector(raw)` (robust output parsing)

Real ML libraries can return different shapes.
This function tries a few patterns.

It checks:
1) Is `raw` an object with `data: Float32Array`?
2) Is `raw` an object with `data: number[]`?
3) Is `raw` itself a `number[]`?

Code excerpt:

```ts
if (data instanceof Float32Array) return Array.from(data);
if (Array.isArray(data) && data.every((n) => typeof n === "number"))
  return data as number[];

if (Array.isArray(raw) && raw.every((n) => typeof n === "number"))
  return raw as number[];
```

Why this matters:
- `Float32Array` is a typed array.
- It is common in ML outputs.
- The rest of the code wants a plain `number[]`.

Edge case:
- If the output is not recognized, it throws:

```ts
throw new Error(
  "Unexpected embedding output structure. Paste error + your @xenova/transformers version.",
);
```

That message is a clue.
It tells you what the maintainer needs to debug.

### `src/query.ts` (search for similar media)

This file answers the question:
- “Given anchor images, what stored items look most similar?”

#### Key function: `querySimilarMulti(...)`

Signature:

```ts
export const querySimilarMulti = async (
  cfg: AppConfig,
  anchorPaths: readonly string[],
  k: number,
  minScore: number,
  outFileName: string,
): Promise<readonly QueryRow[]> => {
```

Inputs:
- `cfg`: includes `dataDir`
- `anchorPaths`: one or more image paths
- `k`: keep this many results
- `minScore`: ignore anything below this
- `outFileName`: save results here

Outputs:
- returns `QueryRow[]`
- writes JSON files to `cfg.dataDir`

#### Edge case: no anchors

```ts
if (anchorPaths.length === 0) throw new Error("Provide at least one anchor.");
```

Plain English:
- You must show at least one example.

#### Load assets and build lookups

It reads `assets.json` and builds a map:

```ts
const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));
```

Why this exists:
- Similarity search produces IDs and scores.
- The UI (and you) want file paths.

#### Load vector store meta and index

Meta is required:

```ts
const meta = await loadVectorMeta(store);
if (!meta) throw new Error("Vector store meta not found. Run embed first.");
```

Then it loads the index and inverts it:

```ts
const idx = await loadVectorIndex(store);
const offsetToId = invertIndex(idx.idToOffset);
```

Why invert?
- Streaming gives `(offset, vec)`.
- You need `offset -> id`.

#### Embed and normalize anchors

It creates the same extractor pipeline:

```ts
await pipeline("feature-extraction", "Xenova/clip-vit-base-patch32");
```

Then it embeds all anchors in parallel:

```ts
const anchorVecs = await Promise.all(
  anchorPaths.map(async (p) => normalize(await embedAnchor(extractor, p))),
);
```

Important:
- Anchors are normalized with `normalize(...)`.
- Normalization makes scores comparable.

#### Stream all stored vectors and score them

This is the core loop.

```ts
await streamAllVectors(store, meta.dim, async (offset, vec) => {
  ...
});
```

Inside the callback:

1) Convert `vec` (likely a typed array) into a normal array.
2) Normalize it.

```ts
const v = normalize(Array.from(vec));
```

3) Score against each anchor.
Keep the best anchor score.

```ts
let best = -1;
for (const a of anchorVecs) {
  const s = dot(a, v);
  if (s > best) best = s;
}
```

4) Apply `minScore` filter.

```ts
if (best < minScore) return;
```

5) Offer the candidate into the top-k structure.

```ts
top.offer({ offset, score: best });
```

#### Build result rows and write output

After streaming, it maps offsets back to assets:

```ts
return { id, score: b.score, absPath: a.absPath, relPath: a.relPath };
```

Then it writes both output files:

```ts
await writeJson(path.join(cfg.dataDir, outFileName), rows);
await writeJson(path.join(cfg.dataDir, "last_query.json"), rows);
```

#### Helper: `embedAnchor(...)` (anchor output parsing)

This is similar to `extractVector`, but simpler.
It expects `raw` to be an object with `data`.

If it is not, it throws:
- `"Unexpected anchor embedding output."`
- `"Unexpected anchor embedding output structure."`

This is important for debugging.
If anchors fail, query cannot run.

#### Helper: `createTopK(k)` (how top-k works)

This file implements its own top-k tracker.

Main idea:
- Keep a small list of best items.
- Always remember the current worst (minimum) item.

Key details:
- When the list becomes full, it sorts ascending.
- The minimum score is always at index 0.

```ts
if (items.length === cap)
  items = items.slice().sort((a, b) => a.score - b.score);
```

Then when a new candidate arrives:
- If it is not better than the minimum, ignore it.

```ts
if (x.score <= min.score) return;
```

If it is better:
- Insert it in sorted order (ascending).
- Trim back down to `cap`.

This is not the only way to do top-k.
But it is readable.
And it works well for small `k`.

---

## Recipes (copy/paste workflows)

These recipes use scripts from `package.json`.
They should run from the repo root.

### First run

1) Install system tools (macOS):

```bash
brew install ffmpeg exiftool
```

2) Install Node deps:

```bash
npm install
```

3) Run the pipeline:

```bash
npm run scan
npm run reps
npm run embed
npm run query
npm run review
npm run apply
```

If something fails, run:

```bash
npm run status
npm run verify
```

(What they check is not shown in the provided files.
So treat them as “diagnostic helpers”.)

### Re-running after adding new media

A common loop:

```bash
npm run scan
npm run reps
npm run embed
npm run query
```

Why this works:
- `src/embed.ts` skips items already embedded.
- That saves time.

### “Find more like this” with multiple anchors

Multi-anchor is useful when:
- the thing you want looks different in different photos

How to choose good anchors:
- Pick images that clearly show the thing.
- Pick anchors from different conditions (lighting, angle).
- Avoid anchors with lots of clutter.
- Avoid blurry anchors.

How to iterate:
- Start with 1 anchor and query.
- Add 1 more anchor and query again.
- Compare results in `last_query.json`.

Note:
- We do not see the CLI flags in provided files.
- But `src/query.ts` clearly supports multiple anchor paths.

### Tuning `k` and `minScore`

A simple strategy:

1) Start wide.
- Set `k` higher so you can explore.
- Set `minScore` lower so you don’t miss matches.

2) Tighten.
- Raise `minScore` when you see junk.
- Lower `minScore` when you miss real items.
- Lower `k` when you’re ready to apply tags.

A good mindset:
- `k` controls your review workload.
- `minScore` controls your “strictness”.

---

## Troubleshooting & FAQ

### “Vector store meta not found. Run embed first.”

This error is thrown by `src/query.ts`.
It means query can’t find embedding metadata.

Fix:
- Run `npm run embed` first.
- Make sure you are using the same `dataDir`.
  **Assumption:** `dataDir` comes from config.

### “Unexpected embedding output structure ...”

This error is thrown by `src/embed.ts`.
It means the model output shape wasn’t expected.

Fix:
- Confirm your `@xenova/transformers` version.
- Include the full error message.
- Confirm you are using the model in the code.

Why this happens:
- ML libraries can change return shapes between versions.

### “Unexpected anchor embedding output ...”

This error is thrown by `embedAnchor` in `src/query.ts`.
It means the anchor embedding output did not match the expected shape.

Fix:
- Same as above.
- It may also mean your anchor path is not a readable image.
  **Assumption:** invalid image paths can cause model failures.

### First run is slow

`docs/tooling.md` explains that models may be downloaded and cached.

What to expect:
- First run may download model files.
- Later runs should be faster.

### Query is slow on big libraries

`src/query.ts` streams all vectors.
That means query looks at every stored embedding.

Ways to reduce work:
- Raise `minScore` so more items are skipped.
- Lower `k` so the top-k tracker stays smaller.

**Assumption:** disk speed matters because vectors are read from disk.

### I updated reps but results didn’t change

`src/embed.ts` skips items it thinks are already embedded.
So it may keep old embeddings.

**Assumption:** there is a “rebuild” or “reset embeddings” workflow.
Check the CLI (`src/cli.ts`) to see how it supports re-embedding.

---

## Glossary

- **Anchor**: An example image you provide for search.
- **Asset**: A photo or video in your library.
- **CLIP**: A model that creates image embeddings.
- **Data directory (`dataDir`)**: Folder where JSON/vectors are stored.
- **Dimension (`dim`)**: Vector length (how many numbers).
- **Dot product**: A way to score similarity between two vectors.
- **Embedding**: A vector that represents meaning.
- **Feature extraction**: Using a model to produce an embedding.
- **Mean pooling**: Averaging many vectors into one.
- **Normalization**: Making vectors the same length.
- **Rep**: A representative JPG used for embedding.
- **Similarity search**: Finding items with similar embeddings.
- **Top-k**: Keeping the best `k` matches.
- **Vector**: A list of numbers.
- **Vector store**: On-disk storage for vectors + an index.
- **XMP sidecar**: A separate file storing tags/metadata.

---
# media-tagger — Project Guide (Local-First ML Tagging Pipeline)

This document is an end-to-end, beginner-friendly guide to the `media-tagger` repository: what it does, how the pipeline flows, what ML concepts it relies on, and how the CLI is wired together.

## Evidence Legend

Throughout this guide, statements are labeled as:

- **Confirmed** — directly supported by one of the provided context files (`README.md`, `package.json`, `docs/tooling.md`, `src/embed.ts`, `src/cli.ts`).
- **Inferred** — a reasonable conclusion from imports/call sites, console output, filenames, and common patterns; may differ in implementation details.
- **Unknown** — not determinable from the provided files.

---

## 1. Overview

### What it is

- **Confirmed**: `media-tagger` is a *local-first* pipeline that:
  1) scans a folder containing mixed photo/video formats,
  2) generates representative JPGs (thumbnails or extracted frames),
  3) computes CLIP embeddings locally,
  4) performs “find all media like this” similarity search using multi-anchor queries,
  5) provides a lightweight browser UI to review matches,
  6) writes tags back to disk via **XMP sidecar files** using a basename convention for DAM ingest.

Source: `README.md`.

### What it is not

- **Confirmed**: “No Apple Photos. No Adobe.” (`README.md`)
- **Inferred**: This is not a cloud service, not a hosted vector DB, and not a “train your own model” system. It’s a local pipeline for indexing + searching a personal media library.

### Design goals (why this exists)

- **Inferred**: Make “tagging lots of personal media” less manual by leveraging *visual similarity search*.
- **Inferred**: Keep data ownership local: models run locally, embeddings are stored locally, tags are written into sidecar files suitable for later ingestion.

---

## 2. Architecture & Data Flow

At a high level, `media-tagger` builds a searchable index over your media library, then uses one or more *anchor images* to find similar items.

### Pipeline stages

- **Confirmed** (from CLI commands in `src/cli.ts` and scripts in `package.json`):
  - `scan` — walk the library and build an asset manifest.
  - `reps` — generate representative JPGs for assets.
  - `embed` — compute CLIP embeddings for each representative JPG and append to a local vector store.
  - `query` — run similarity search given one or more anchor images.
  - `tag-this` — ergonomic “query + review server + (optional) apply” flow.
  - `review` — generate a static review HTML page.
  - `review-serve` — serve the review UI and save approvals.
  - `apply` — write tags via XMP sidecar files for approved items.
  - `status` — print progress and counts.
  - `verify` — validate repository state / artifacts (exact checks are in `src/verify.ts`, not provided).

### Data flow diagram

```text
+-------------------+           +-------------------+         +-------------------+
|  PHOTO_LIB folder  |           | reps/ (JPG reps)  |         | data/ (index/data) |
|  photos + videos   |           | thumbnails/frames |         | assets, vectors    |
+---------+---------+           +---------+---------+         +----------+----------+
          |                               |                              |
          | scan                          | reps                          | embed
          v                               v                              v
  data/assets.json  ---> add repPath ---> assets w/ repPath ---> vector store files
          |
          | query / tag-this (anchors)
          v
  data/candidates.json + data/last_query.json
          |
          | review / review-serve
          v
  review/review.html + review/approved.json
          |
          | apply
          v
  XMP sidecar files next to media (basename convention)
```

- **Confirmed**: `data/assets.json` exists and is used by `src/embed.ts` (`path.join(cfg.dataDir, "assets.json")`).
- **Confirmed**: review output includes `review.html` and approvals are saved to `review/approved.json` (`src/cli.ts`).
- **Confirmed**: `query` writes `data/${out}` and “also updated `data/last_query.json`” (`src/cli.ts`).
- **Inferred**: Representative JPGs are stored under `cfg.repsDir`, which is likely `reps/` based on `src/cli.ts` ensuring directories and logging.
- **Inferred**: The vector store lives under `cfg.dataDir` (likely `data/`) and consists of a metadata file + index file + vector storage file(s).

### “Multi-anchor” query concept

Instead of searching using a single example image, you can pass multiple anchor images:

- **Confirmed**: CLI accepts `--anchors "a|b|c"` (pipe-delimited) or `--anchor "a"` (`src/cli.ts`).
- **Inferred**: `querySimilarMulti` likely computes an embedding per anchor and aggregates them (e.g., mean pooling of anchor vectors or “max similarity across anchors”), then retrieves the nearest items from the embedding index.
- **Unknown**: The exact aggregation strategy (mean-of-vectors vs. max-of-scores vs. weighted) lives in `src/query.ts` (not provided).

---

## 3. Concepts Primer (ML Learners)

This section explains the ML ideas in terms of what this project actually does.

### 3.1 Embeddings

An **embedding** is a list of numbers (a vector) that represents an item (here: an image) in a way that similar items have vectors that are close together.

- **Confirmed**: `src/embed.ts` ultimately produces `readonly number[]` vectors via `extractVector(...)`.
- **Inferred**: Each representative JPG is converted into an embedding; the project then compares embeddings to find similar media.

Why embeddings are useful:

- They turn “visual similarity” into “vector distance,” which is fast to search.
- You can query with one (or multiple) example images.

### 3.2 CLIP (what it is doing here)

**CLIP** (“Contrastive Language–Image Pretraining”) is a model trained so that:

- images and text live in a shared embedding space,
- and semantically related items are near each other.

In this project:

- **Confirmed**: The embedding model loaded is `Xenova/clip-vit-base-patch32` through `@xenova/transformers` pipeline `"feature-extraction"` (`src/embed.ts`).
- **Confirmed**: Embeddings are generated locally (Node.js inference).

Even if you never use text queries, CLIP image embeddings tend to cluster visually and semantically similar items.

### 3.3 Pooling and normalization

Many neural models output a sequence of vectors (one per patch/token). To turn that into a single vector per image, you typically apply **pooling**.

- **Confirmed**: This project calls the extractor with `{ pooling: "mean", normalize: true }` (`src/embed.ts`).

What that means:

- **Mean pooling**: average across the token/patch dimension to get one vector.
- **Normalization**: scale the vector to have length 1 (unit norm).

Normalization matters because it makes **cosine similarity** and **dot product** behave consistently.

### 3.4 Similarity search (cosine, normalization)

To “find similar images,” you compare a query embedding to many stored embeddings.

Common similarity measures:

- **Cosine similarity**: `cos(a, b) = (a · b) / (||a|| * ||b||)`
- If vectors are normalized (`||a|| = ||b|| = 1`), then:
  - cosine similarity becomes just a dot product `a · b`.

- **Confirmed**: Embeddings are normalized at creation time (`normalize: true` in `src/embed.ts`).
- **Inferred**: Because of normalization, `querySimilarMulti` can likely compute similarity using a dot product efficiently.
- **Unknown**: Whether the project uses cosine, dot product, or Euclidean distance internally.

### 3.5 Multi-anchor queries

A multi-anchor query is like saying:

> “Show me media that looks like *these examples* (collectively).”

There are multiple ways to combine anchors:

- **Mean-of-vectors**: embed each anchor → average vectors → search once.
- **Max-of-scores**: search each anchor → take the max similarity per candidate.
- **Intersection-like**: require candidates to be similar to all anchors.

- **Confirmed**: The CLI supports multiple anchors via `--anchors "a|b|c"` (`src/cli.ts`).
- **Unknown**: The exact aggregation strategy is inside `querySimilarMulti` (`src/query.ts`).

### 3.6 Thresholds: `k` and `minScore`

When searching, you typically control:

- `k`: how many neighbors to return (top-k)
- `minScore`: a similarity cutoff below which results are discarded

- **Confirmed**: `query` and `tag-this` accept `--k` and `--minScore` (`src/cli.ts`).
- **Confirmed**: `query` uses defaults:
  - `k = profile.queryDefaults.k` if profile provided, else `700`.
  - `minScore = profile.queryDefaults.minScore` if profile provided, else `0.0`.
- **Confirmed**: The CLI help text shows example values like `--minScore 0.25` (usage string in `src/cli.ts`), but the true fallback without a profile is `0.0`.

Practical intuition:

- Higher `k` increases recall (you see more candidates), but increases review workload.
- Higher `minScore` increases precision (fewer “obviously wrong” matches), but may miss edge cases.

---

## 4. Tooling & Dependencies

### 4.1 Node.js + TypeScript (ESM)

- **Confirmed**: `package.json` has `"type": "module"`, meaning Node runs the project as ES modules (ESM).
- **Confirmed**: The code imports `./config.js`, `./embed.js`, etc., which is a common TypeScript-to-ESM build pattern where TS compiles to `.js` files.
- **Confirmed**: Build is `tsc -p tsconfig.json` and dev/CLI scripts use `tsx` (`package.json`).

Why this choice (practical benefits):

- **Inferred**: TypeScript provides safer refactors and clearer data types for a pipeline with many artifacts.
- **Inferred**: ESM aligns with modern Node and with many ML/transformer libraries.

### 4.2 `@xenova/transformers`

- **Confirmed**: The only runtime dependency is `@xenova/transformers` (`package.json`).
- **Confirmed**: `docs/tooling.md` describes it as a JS/TS library for running Hugging Face–style transformer models in Node or the browser.
- **Confirmed**: This repo uses `pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")` (`src/embed.ts`).

What it provides here:

- A high-level “pipeline” API similar to Python Transformers.
- Model downloading + local caching (commonly from Hugging Face model repos).
- Local inference without standing up Python.

Caching implications:

- **Confirmed (general)**: `docs/tooling.md` says models can be cached locally.
- **Inferred**: The first embedding run may download model files; subsequent runs reuse cached weights.
- **Unknown**: The exact cache path/config in this project (typically controlled by the library/environment).

### 4.3 `ffmpeg` and `exiftool`

- **Confirmed**: macOS requirements include `brew install ffmpeg exiftool` (`README.md`).

Likely responsibilities:

- **Inferred**: `ffmpeg` is used by `src/reps.ts` to extract a representative frame from videos and/or generate thumbnails.
- **Inferred**: `exiftool` is used by `src/apply.ts` to write XMP sidecar metadata/tags.
- **Unknown**: The exact command lines are in `src/reps.ts` and `src/apply.ts`.

---

## 5. Repository Walkthrough (File-by-file)

This walkthrough is split into:

- deep, line-by-line conceptual explanations for the provided files (`src/cli.ts`, `src/embed.ts`)
- responsibility summaries for imported modules whose source wasn’t provided

### 5.1 `README.md`

- **Confirmed**: Establishes project scope: local-first scan → reps → embed → multi-anchor query → review UI → XMP sidecars.
- **Confirmed**: Notes the macOS dependencies (`ffmpeg`, `exiftool`).

### 5.2 `package.json`

Key points:

- **Confirmed**: The published binary name is `media-tagger` pointing to `./dist/bin.js` (after build).
- **Confirmed**: Useful scripts wrap the CLI using `tsx` (runs TypeScript directly):
  - `npm run scan`, `npm run reps`, `npm run embed`, `npm run query`, `npm run tag-this`, `npm run review`, `npm run review:serve`, `npm run apply`, `npm run status`, `npm run verify`.

### 5.3 `docs/tooling.md`

- **Confirmed**: Explains what `@xenova/transformers` is and how pipelines work.

### 5.4 `src/cli.ts` (deep detail)

This is the command dispatcher and orchestration layer.

#### CLI entry and directory setup

- **Confirmed**: `runCli(argv)` calls `getConfig()` and ensures these directories exist:
  - `cfg.dataDir`
  - `cfg.repsDir`
  - `cfg.reviewDir`
  - `cfg.profilesDir`

This matches the repository’s core artifacts: data, representatives, review UI state, and user profiles.

#### Command: `scan`

- **Confirmed**: `scan` calls `scan(cfg.photoLibRoot, cfg.maxFiles)` and writes JSON to `manifestPath(cfg.dataDir)`.
- **Confirmed**: `scan(...)` walks all files, filters by media kind, and produces an `Asset` array with:
  - `id`: `sha1(relPath)`
  - `absPath`: absolute path
  - `relPath`: root-relative path with POSIX separators
  - `ext`: file extension
  - `kind`: from `detectKind(absPath)`

- **Inferred**: `detectKind` likely recognizes common image/video extensions and returns e.g. `"photo" | "video"`.

#### Command: `reps`

- **Confirmed**: `reps` calls `generateRepresentatives(cfg)` and logs how many assets have `repPath`.
- **Inferred**: `generateRepresentatives` likely reads `data/assets.json`, creates representative JPGs in `reps/`, then writes updated assets (with `repPath`) back to `data/assets.json`.

#### Command: `embed`

- **Confirmed**: `embed` calls `computeEmbeddings(cfg)`.
- **Confirmed**: After embedding, it loads vector store metadata and index:
  - `getVectorStorePaths(cfg.dataDir)`
  - `loadVectorMeta(store)`
  - `loadVectorIndex(store)`
  and prints `dim` and `count`.

This implies embeddings are stored in a local append-only store with a meta file and an index that maps IDs to offsets.

#### Command: `query`

- **Confirmed**: `query` delegates to `cmdQuery(cfg, rest)`.

Inside `cmdQuery`:

- **Confirmed**: Anchors are parsed from either:
  - `--anchors "a|b|c"` or
  - `--anchor "/path/to/a.jpg"`
- **Confirmed**: Output filename flag: `--out` defaulting to `candidates.json`.
- **Confirmed**: Optional profile tagging context:
  - `--profile <name>`
  - `--label <label>`
- **Confirmed**: Defaults depend on profile:
  - `k = profile.queryDefaults.k` or fallback `700`
  - `minScore = profile.queryDefaults.minScore` or fallback `0.0`
- **Confirmed**: Calls `querySimilarMulti(cfg, anchors, k, minScore, out)`.
- **Confirmed**: Logs:
  - `Wrote data/${out}` and
  - `Also updated data/last_query.json`

#### Command: `tag-this`

This is an “interactive tagging” command that combines query + review server.

- **Confirmed**: Requires:
  - `--anchors` or `--anchor`
  - `--profile`
  - `--label`
- **Confirmed**: Optional flags:
  - `--port` (default `8787`)
  - `--open` (boolean, pass `--open` to auto-open in browser)
  - `--apply` (boolean, changes review behavior to auto-apply after Save)
  - `--k`, `--minScore` (override profile defaults)
  - `--out` (default `candidates.json`; supported by code even though not shown in the help text)

Flow:

1) Load profile → build `baseTag` via `renderTag(profile.tagTemplate, label)`.
2) Determine `autoTags` via `getProfileAutoTags(profile)`.
3) Run `querySimilarMulti(...)` producing `data/candidates.json` and `data/last_query.json`.
4) Generate review HTML: `generateReviewHtml(cfg, { autoApplyAfterSave })`.
5) Start server: `startReviewServer(cfg, port, { approvedPath, apply: { baseTag, autoTags } })`.
6) Optionally open browser via `exec("open", [srv.url])`.

This command is the fastest path from “example images” to “approved tags written” (especially with `--apply`).

#### Commands: `review` and `review-serve`

- **Confirmed**: `review` writes HTML via `generateReviewHtml(cfg, { autoApplyAfterSave: false })` and suggests running `media-tagger review-serve --port 8787`.

- **Confirmed**: `review-serve`:
  - accepts `--port` (default `8787`)
  - requires `review/review.html` to exist
  - saves approvals to `review/approved.json`

- **Inferred**: The review UI likely renders candidates from `data/last_query.json` (or `data/candidates.json`) and lets you mark items approved/rejected.

#### Command: `apply`

- **Confirmed**: Supports two modes:

1) Profile-based tagging (recommended workflow):

`media-tagger apply --profile subjects --label "Teddy" [--approved review/approved.json]`

2) Direct tag string:

`media-tagger apply --tag "Subjects|Teddy" [--autoTags year,camera,location]`

Other details:

- **Confirmed**: `--approved` defaults to `review/approved.json`.
- **Confirmed**: In direct mode, default `--tag` is `Subjects|Example`.
- **Confirmed**: `--autoTags` supports only `year`, `camera`, `location` (unknown strings are filtered out).
- **Confirmed**: Implementation writes “basename XMP sidecars” (logged in `src/cli.ts`).

#### Command: `status`

- **Confirmed**: Prints counts for:
  - total assets (from `data/assets.json` if present)
  - reps present (assets with `repPath`)
  - reps done / embeds done (from progress tracking)
  - embedding meta count and index ids count

#### Command: `verify`

- **Confirmed**: Runs `verify(cfg)`, prints formatted lines, and exits with code `2` if not all checks are ok.
- **Unknown**: Exact validation items (in `src/verify.ts`).

#### CLI parsing behavior

- **Confirmed**: `parseArgs` is a simple `--flag value` parser:
  - if a flag is present and the next token is not another flag, it’s treated as the value
  - otherwise, it’s treated as boolean-like and set to string `"true"`

Practical implication:

- To enable booleans, you pass `--open` or `--apply` (no explicit value required).
- If you do pass a value, it must not start with `--`.

### 5.5 `src/embed.ts` (deep detail)

This module performs batch embedding of representative JPGs and appends embeddings to the vector store.

#### Key function: `computeEmbeddings(cfg)`

- **Confirmed**: Reads assets from `data/assets.json`:
  - `readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"))`

- **Confirmed**: Filters to only assets that have a representative path:

  - `assets.filter((a) => typeof a.repPath === "string")`

- **Confirmed**: Loads existing vector store metadata and index:
  - `getVectorStorePaths(cfg.dataDir)`
  - `loadVectorIndex(store)`
  - `loadVectorMeta(store)`

- **Confirmed**: Loads progress and skips work already done:
  - `prog.embedsDone[r.id] === true` OR
  - `existingIdx.idToOffset[r.id]` exists

This makes the embedding run resumable.

#### Model loading: `pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")`

- **Confirmed**: Uses `@xenova/transformers` pipeline for feature extraction.
- **Inferred**: On first run, the model may download and cache locally.

#### Embedding one image: `embedOne(extractor, imagePath)`

- **Confirmed**: Calls the extractor with:

`extractor(imagePath, { pooling: "mean", normalize: true })`

and then converts output to `number[]` via `extractVector`.

#### Output shape handling: `extractVector(raw)`

`extractVector` is defensive about library output changes:

- **Confirmed**: Accepts these output formats:
  - `{ data: Float32Array }`
  - `{ data: number[] }`
  - `number[]` directly

If none match, it throws an error instructing you to paste the error and library version.

#### Appending vectors and dimension handling

- **Confirmed**: For each new embedding, it sets:

`dim = existingMeta?.dim ?? vec.length`

and then calls:

`appendVector(store, r.id, vec, dim)`

- **Inferred**: `appendVector` likely stores a fixed-width float array; `dim` is used to validate or pad/truncate.
- **Unknown**: Whether vectors are rejected if `vec.length !== dim`.

---

### 5.6 Imported modules (responsibilities summary)

The following modules are imported by `src/cli.ts` but not provided. The responsibilities below are based on naming + usage.

#### `src/config.ts` (`getConfig`)

- **Confirmed**: Returns values used by the CLI: `photoLibRoot`, `maxFiles`, `dataDir`, `repsDir`, `reviewDir`, `profilesDir`.
- **Confirmed**: CLI help mentions environment variables:
  - `PHOTO_LIB=/PATH/TO/LIBRARY`
  - `MAX_FILES=500 (optional)`
- **Inferred**: `getConfig` reads env vars and sets defaults like `dataDir="data"`, `repsDir="reps"`, `reviewDir="review"`, `profilesDir="profiles"`.

#### `src/fsUtils.ts`

- **Confirmed**: Provides `ensureDir`, `fileExists`, `readJson`, `writeJson`, `sha1`, `toPosixRel`.
- **Inferred**: Uses `fs/promises` and stable JSON formatting.

#### `src/manifest.ts` (`walkFiles`, `manifestPath`)

- **Confirmed**: `walkFiles(root)` returns file paths for scanning.
- **Confirmed**: `manifestPath(cfg.dataDir)` is where scan results are written.
- **Inferred**: `manifestPath(dataDir)` likely returns `path.join(dataDir, "assets.json")`.

#### `src/mediaDetect.ts` (`detectKind`)

- **Confirmed**: Returns a falsy value for non-media.
- **Inferred**: Maps file extensions to kinds (image/video).

#### `src/reps.ts` (`generateRepresentatives`)

- **Confirmed**: Returns an array of assets; after running, some have `repPath`.
- **Inferred**: For images, might generate a resized JPG thumbnail.
- **Inferred**: For videos, might run `ffmpeg` to extract a frame.

#### `src/vectorStore.ts`

- **Confirmed**: Exposes:
  - `getVectorStorePaths(dataDir)`
  - `loadVectorMeta(paths)`
  - `loadVectorIndex(paths)`
  - `appendVector(paths, id, vec, dim)`
- **Inferred**: Stores vectors on disk and an `id → offset` mapping for quick lookup.
- **Unknown**: File formats (JSON? binary?), metric used, and search strategy.

#### `src/progress.ts`

- **Confirmed**: `loadProgress(cfg)`, `saveProgress(cfg, prog)`, `markEmbedDone(prog, id)`.
- **Confirmed**: CLI prints `Object.keys(prog.repsDone).length` and `Object.keys(prog.embedsDone).length`.
- **Inferred**: Progress is a JSON file under `data/` tracking completed steps.

#### `src/query.ts` (`querySimilarMulti`)

- **Confirmed**: Signature usage: `querySimilarMulti(cfg, anchors, k, minScore, out)`.
- **Confirmed**: `query` prints it wrote `data/${out}` and updated `data/last_query.json`.
- **Inferred**: Performs:
  - embed anchors
  - compare to stored vectors
  - emit ranked candidates
- **Unknown**: Whether it uses an exact linear scan or an approximate index.

#### `src/review.ts` (`generateReviewHtml`)

- **Confirmed**: Writes an HTML file (logged as `Review HTML written: ${outPath}`).
- **Confirmed**: Supports option `{ autoApplyAfterSave: boolean }`.
- **Inferred**: Loads `data/last_query.json` and produces `review/review.html` showing thumbnails and checkboxes.

#### `src/reviewServer.ts` (`startReviewServer`)

- **Confirmed**: Returns `{ url: string }` (used by logs and browser open).
- **Confirmed**: Accepts `approvedPath` and optionally `apply: { baseTag, autoTags }`.
- **Inferred**: Serves `review/review.html` and an API endpoint to save approvals to JSON.
- **Inferred**: In apply mode, might call `applyTagsViaSidecars` when the user clicks “Apply tags” or on save.

#### `src/apply.ts` (`applyTagsViaSidecars`, `getProfileAutoTags`)

- **Confirmed**: Applies tags via basename XMP sidecars.
- **Confirmed**: Profile-based auto-tags exist.
- **Inferred**: Uses `exiftool` to write XMP metadata and/or sidecar files.
- **Unknown**: Exact tag schema (Lightroom hierarchical subject tags vs. custom XMP fields).

#### `src/profiles.ts` (`listProfiles`, `loadProfile`, `renderTag`)

- **Confirmed**: Profiles are listed from `./profiles` in default help output.
- **Confirmed**: A profile has:
  - `tagTemplate`
  - `queryDefaults.k`
  - `queryDefaults.minScore`
- **Inferred**: Profiles are JSON or YAML files stored in `profiles/`.
- **Inferred**: `renderTag(template, label)` likely produces hierarchical tags like `Subjects|Teddy`.

#### `src/verify.ts` (`verify`, `formatVerify`)

- **Confirmed**: Produces a list of lines with `.ok` boolean.
- **Unknown**: What exactly it validates.

#### `src/exec.ts` (`exec`)

- **Confirmed**: Used for `open <url>` on macOS.
- **Inferred**: A small wrapper around `child_process.spawn` returning `{ code, stdout, stderr }`.

---

## 6. CLI Reference & Recipes

### 6.1 First-time setup

#### Install system dependencies (macOS)

- **Confirmed** (`README.md`):

```bash
brew install ffmpeg exiftool
```

#### Install Node dependencies

- **Confirmed**: this is a Node project (`package.json`).

```bash
npm install
```

#### Run the CLI

You can run commands in two typical ways:

- **Confirmed**: via scripts (TypeScript executed with `tsx`):

```bash
npm run scan
npm run reps
npm run embed
```

- **Inferred**: via the installed bin name (`media-tagger`) after `npm run build` (because `package.json` defines `bin: { "media-tagger": "./dist/bin.js" }`).

### 6.2 Configure the library path

- **Confirmed**: CLI help advertises:
  - `PHOTO_LIB=/PATH/TO/LIBRARY`
  - `MAX_FILES=500 (optional)`

Example:

```bash
export PHOTO_LIB="/Volumes/Media/Photos"
export MAX_FILES=500
```

- **Inferred**: `PHOTO_LIB` becomes `cfg.photoLibRoot`.

### 6.3 Typical end-to-end workflow (scan → reps → embed)

1) Scan the library:

```bash
npm run scan
```

2) Generate representative JPGs:

```bash
npm run reps
```

3) Compute embeddings:

```bash
npm run embed
```

Sanity check status:

```bash
npm run status
```

### 6.4 Query workflow (produce candidates)

The `query` command writes candidate results into `data/`.

#### Single-anchor example

```bash
npm run query -- --anchor "/path/to/example.jpg" --k 700 --minScore 0.25 --out "candidates.json"
```

Notes:

- **Confirmed**: `--anchor` is supported.
- **Confirmed**: output defaults to `candidates.json`.
- **Confirmed**: without a profile, true defaults are `k=700`, `minScore=0.0`.

#### Multi-anchor example

```bash
npm run query -- --anchors "/path/a.jpg|/path/b.jpg|/path/c.jpg" --k 700 --minScore 0.25
```

- **Confirmed**: `--anchors` is pipe-delimited.

#### Profile-aware query (tag preview + defaults)

```bash
npm run query -- --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy"
```

- **Confirmed**: If both `--profile` and `--label` are present, CLI prints a tag preview and profile defaults.

### 6.5 Fast path: `tag-this` (query + review server)

`tag-this` is the recommended “I have examples; help me tag similar items” workflow.

```bash
npm run tag-this -- --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy" --open
```

Common variants:

- Override thresholds:

```bash
npm run tag-this -- --anchor "/path/a.jpg" --profile subjects --label "Teddy" --k 900 --minScore 0.3 --open
```

- Auto-apply tags after saving approvals:

```bash
npm run tag-this -- --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy" --apply --open
```

- Change port:

```bash
npm run tag-this -- --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy" --port 8790 --open
```

### 6.6 Review workflow (generate static HTML, then serve)

If you ran `query` already (or want manual steps):

1) Generate the review page:

```bash
npm run review
```

2) Serve it:

```bash
npm run review:serve -- --port 8787
```

- **Confirmed**: `review-serve` requires `review/review.html` to exist.
- **Confirmed**: approvals are saved to `review/approved.json`.

### 6.7 Apply tags workflow

#### Profile-based apply (recommended)

```bash
npm run apply -- --profile subjects --label "Teddy"
```

- **Confirmed**: reads approvals from `review/approved.json` by default.

Use a custom approvals file:

```bash
npm run apply -- --profile subjects --label "Teddy" --approved "review/approved.json"
```

#### Direct tag apply

```bash
npm run apply -- --tag "Subjects|Teddy" --autoTags year,camera,location
```

- **Confirmed**: Only `year`, `camera`, `location` are accepted auto-tags.

### 6.8 Verify

```bash
npm run verify
```

- **Confirmed**: exits non-zero (code `2`) if checks fail.

---

## 7. Data & File Conventions

This section describes on-disk artifacts the pipeline produces.

### 7.1 Directories

- **Confirmed**: The CLI ensures these directories exist at startup:
  - `cfg.dataDir`
  - `cfg.repsDir`
  - `cfg.reviewDir`
  - `cfg.profilesDir`

- **Inferred**: Based on logs like “Profiles in ./profiles” and “Saves approvals to: review/approved.json”, defaults are likely:
  - `data/`
  - `reps/`
  - `review/`
  - `profiles/`

### 7.2 `data/assets.json`

- **Confirmed**: Written by `scan` (via `manifestPath(cfg.dataDir)`), and read by `computeEmbeddings` (`src/embed.ts`).
- **Confirmed**: Asset records contain at least:
  - `id`, `absPath`, `relPath`, `ext`, `kind`
- **Inferred**: After running `reps`, assets are enriched with `repPath`.

### 7.3 Representative images (`repPath`, likely under `reps/`)

- **Confirmed**: `src/embed.ts` only embeds assets that have a `repPath` string.
- **Inferred**: `repPath` points at a JPG file that is safe to pass to the embedding model.

### 7.4 Vector store files (under `data/`)

- **Confirmed**: There is a vector store with:
  - meta (`loadVectorMeta` returns at least `{ dim, count }`)
  - index (`loadVectorIndex` returns an object with `idToOffset`)
- **Unknown**: Filenames and formats.

### 7.5 Query outputs

- **Confirmed**: `query` writes:
  - `data/${out}` (default `data/candidates.json`)
  - `data/last_query.json`

- **Inferred**: `data/candidates.json` likely contains an array of candidate assets with scores and paths used by the review UI.

### 7.6 Review artifacts

- **Confirmed**: `review/review.html` is generated by `review` and required by `review-serve`.
- **Confirmed**: `review/approved.json` is where approvals are saved.

### 7.7 XMP sidecars (basename convention)

- **Confirmed**: Applying tags writes “basename XMP sidecars” (`src/cli.ts` log line).

- **Inferred**: For a media file like:

`/Photos/Trip/IMG_0001.JPG`

The sidecar might be:

`/Photos/Trip/IMG_0001.xmp`

- **Unknown**: Exact naming for files with compound extensions and exact XMP fields used.

---

## 8. Troubleshooting & FAQ

### “`ffmpeg` not found” / “`exiftool` not found”

- Install the dependencies:

```bash
brew install ffmpeg exiftool
```

- **Confirmed**: These are required on macOS (`README.md`).

### First embedding run is slow

- **Inferred**: The first call to `pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")` may download model files and cache them.
- Retry `npm run embed` after it completes once.

### I ran `embed` but got “Unexpected embedding output structure”

- **Confirmed**: `src/embed.ts` throws an error that explicitly asks for the error + your `@xenova/transformers` version.

What to do:

- Ensure you’re using the repo’s dependency version (`@xenova/transformers` in `package.json`).
- Re-run with a clean `node_modules` if needed:

```bash
rm -rf node_modules package-lock.json
npm install
```

### `review-serve` says `review/review.html not found`

- **Confirmed**: You must run `media-tagger review` first.

```bash
npm run review
npm run review:serve
```

### “My query returns too many junk matches”

Tighten thresholds:

- increase `--minScore` (e.g., `0.25` → `0.35`)
- reduce `--k` (e.g., `700` → `300`)
- use more anchors (`--anchors "a|b|c"`)

- **Confirmed**: CLI supports these parameters.

### “Nothing shows up” / empty candidates

- Ensure you ran stages in order:
  - `scan` → `reps` → `embed`
- Run `npm run status` and confirm:
  - assets count > 0
  - reps present > 0
  - embeddings meta count > 0

- **Confirmed**: `status` prints these counts.

---

## 9. Customization & Extension Points

This project is intentionally modular: you can swap models, change embedding handling, and alter how search and tagging work.

### 9.1 Swap the embedding model

- **Confirmed**: The model is currently hardcoded in `src/embed.ts`:
  - `pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")`

To change:

- Replace the model ID with another compatible vision embedding model.
- Keep an eye on embedding dimensionality (see next section).

Risk:

- **Inferred**: A different model may output a different embedding dimension; existing vector store data may become incompatible.

### 9.2 Embedding dimension and compatibility

- **Confirmed**: `appendVector` is called with a `dim` chosen as `existingMeta?.dim ?? vec.length`.

Possible strategies if you change models:

- wipe and rebuild the vector store (simple)
- version the store by model name (safer for multi-model experiments)
- implement explicit checks for mismatched dimensions

- **Unknown**: Whether `appendVector` currently pads/truncates or throws.

### 9.3 Change the similarity metric / aggregation

- **Inferred**: `src/query.ts` likely computes similarity between anchor embedding(s) and stored embeddings.

Modification ideas:

- switch between dot-product and cosine (if embeddings are normalized, they’re equivalent)
- add “max-of-anchors” aggregation (useful if anchors represent different sub-modes)
- add “AND-like” aggregation (require similarity to multiple anchors)

### 9.4 Change representative generation strategy

- **Inferred**: `src/reps.ts` likely controls:
  - image resize dimensions
  - which video frame is extracted
  - caching behavior (skip if rep exists)

Potential improvements:

- sample multiple frames for videos and pick the “sharpest”
- use face detection to choose frames (still local)
- preserve aspect ratio and correct orientation

### 9.5 Expand auto-tags

- **Confirmed**: CLI currently allows `--autoTags year,camera,location` in direct apply mode.

To extend:

- update the allowed set in `src/cli.ts` (`parseAutoTags`)
- implement extraction in `src/apply.ts` (e.g., read EXIF year/camera/location)

### 9.6 Add new commands

- **Confirmed**: The CLI is a `switch (cmd)` in `src/cli.ts`.

If you add new pipeline stages:

- add a new `case "..."` in `runCli`
- add a corresponding `npm run ...` script in `package.json` (optional)
- update `verify` checks to include new artifacts (if relevant)

---

## Appendix: Command quick reference

From `src/cli.ts` help output (abridged):

- `media-tagger scan`
- `media-tagger reps`
- `media-tagger embed`
- `media-tagger query --anchors "a|b|c" [--profile subjects --label "Teddy"] [--k N] [--minScore 0.25] [--out file.json]`
- `media-tagger tag-this --anchors "a|b|c" --profile subjects --label "Teddy" [--port 8787] [--open] [--apply] [--k N] [--minScore 0.25]`
- `media-tagger review`
- `media-tagger review-serve --port 8787`
- `media-tagger apply --profile subjects --label "Teddy" [--approved review/approved.json]`
- `media-tagger apply --tag "Subjects|Teddy" [--autoTags year,camera,location]`
- `media-tagger status`
- `media-tagger verify`

 
