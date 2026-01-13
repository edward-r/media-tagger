# media-tagger: Project Guide

This guide explains the `media-tagger` project end-to-end.
It is written for a first-year developer with **zero ML background**.
It aims for a **middle school reading level**.

This document is based only on these “ground truth” files:
- `README.md`
- `docs/tooling.md`
- `package.json`
- `src/embed.ts`
- `src/query.ts`

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
5. Review matches in a lightweight browser UI.
6. Write tags back to disk via **XMP sidecar files**.

One sentence version:
- You show it a few examples, and it finds similar media.

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

CLIP is a model that can create useful embeddings for images.

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

In code, `k` is used to build the top-k helper:

```ts
// src/query.ts
const top = createTopK(k);
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
- `npm run tag-this`
- `npm run review`
- `npm run review:serve`
- `npm run apply`
- `npm run status`
- `npm run verify`

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
