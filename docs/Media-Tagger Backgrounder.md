# Media-Tagger Backgrounder

Absolutely — this is a *great* request, and you’re right to want a dedicated backgrounder. What you’ve built touches several domains that normally live in **different professional worlds** (photography, DAMs, ML, systems engineering), so it’s completely reasonable that it feels unfamiliar.

Below is an **in-depth but plain-English backgrounder**, written as a standalone conceptual document. You could drop this straight into your repo as something like:

```
docs/backgrounder.md
```

---

# media-tagger — Concepts & Techniques Backgrounder

This document explains **what’s going on under the hood** of `media-tagger`, why each step exists, and how the pieces fit together. No prior photography or ML experience is assumed.

---

## 1. The Core Problem We’re Solving

You have a large pile of media files:

- photos
- videos
- many formats
- inconsistent naming
- no reliable organization

You want to answer questions like:

> “Show me *all* photos of Teddy.”

But:
- filenames don’t help
- folders don’t help
- EXIF metadata usually doesn’t contain “who/what is in the image”
- manually tagging tens of thousands of files is not realistic

So we need a way to:

1. **Understand image content**
2. **Group similar images**
3. **Let a human confirm correctness**
4. **Persist that knowledge in a durable, tool-agnostic way**

That’s exactly what `media-tagger` does.

---

## 2. Mental Model: The Entire Pipeline (High Level)

Think of the pipeline as **five stages**:

```
FILES
  ↓
SCAN → REPS → EMBEDDINGS → SEARCH → REVIEW → TAGS
```

Each stage solves one specific problem.

---

## 3. Scanning: Building a Canonical Inventory

### What scanning does

The `scan` step:

- walks your library folder recursively
- identifies files that *look like* images or videos (by extension)
- assigns each file a **stable ID**
- records:
  - absolute path
  - relative path
  - file type (image/video)
  - extension

This produces:

```
data/assets.json
```

### Why this matters

- Filesystems are messy
- Paths can change
- You want a **single source of truth** for “what exists”

The asset ID (SHA-1 of the relative path) lets the rest of the system refer to files *without constantly re-walking the filesystem*.

This is very similar to:
- a database primary key
- a Git object hash
- a content index in a DAM

---

## 4. Representatives (“Reps”): Making Everything Look the Same

### The problem

Your library contains:

- giant RAW images
- HEIC photos
- PSDs
- videos (MOV, MP4, etc.)

Machine-learning models **cannot** directly consume all of these formats.

### The solution

For every asset, we generate a **representative JPEG**:

- Images → scaled-down JPG
- Videos → one extracted frame

These live in:

```
derivatives/reps/<id>.jpg
```

### Why reps are critical

Reps give us:

- one consistent format
- predictable size
- fast processing
- reproducible inputs

This is a *standard* technique in professional media systems.  
You’ll see it in DAMs, video platforms, and ML pipelines.

> Think of reps as “thumbnails for machines”.

---

## 5. Embeddings: Turning Images Into Numbers

### The core idea

Modern AI models can turn images into **vectors** (arrays of numbers) such that:

- similar images → similar vectors
- dissimilar images → distant vectors

This is called an **embedding**.

### What model we use

We use **CLIP** (Contrastive Language–Image Pretraining), via:

```
@xenova/transformers
```

CLIP was trained to understand *visual concepts*, not just pixels.

That means it can capture things like:
- shapes
- textures
- objects
- scenes
- animals
- people

### What an embedding is (intuitively)

Instead of this:

```
IMG_1234.JPG
```

The model produces something like:

```
[0.012, -0.884, 0.442, ..., 0.091]
```

Typically:
- 512 or 768 numbers
- floating point values
- normalized (length ≈ 1)

You **never read these directly**. They exist only to be compared.

---

## 6. Vector Storage: Why We Don’t Use JSON

### Naïve approach (what many tutorials do)

```json
[
  { "id": "...", "vector": [0.1, 0.2, ...] },
  ...
]
```

This works for:
- demos
- hundreds of items

It breaks down for:
- tens of thousands of items
- memory usage
- performance

### What media-tagger does instead

We store embeddings as:

- `embeddings.f32` → raw Float32 binary data
- `embeddings.index.json` → ID → offset mapping
- `embeddings.meta.json` → dimension + count

This is essentially a **very simple vector database**.

### Why this is good

- Fast to read
- Compact on disk
- Streamable (no giant memory spike)
- Easy to port later to:
  - SQLite
  - pgvector
  - Milvus
  - FAISS

---

## 7. Similarity Search: “Find Images Like This One”

### Anchor images

You give the system a few **anchor images**:

> “These are Teddy.”

Important:
- multiple anchors are better than one
- different angles / lighting / ages help a lot

### Similarity metric

We compute **cosine similarity** between vectors.

Conceptually:
- vectors pointing in the same direction → similar
- vectors pointing differently → dissimilar

Because vectors are normalized, cosine similarity becomes a dot product.

### Multi-anchor merge

For each library image:

```
score = max(
  sim(anchor₁, image),
  sim(anchor₂, image),
  ...
)
```

This answers:
> “Is this image similar to *any* example of Teddy?”

### Why max, not average?

- Average penalizes diversity
- Max preserves recall

This is a deliberate bias toward **“show me more, I’ll prune”**, which is exactly what you want in a human-in-the-loop system.

### Text prompt queries (optional prefilter)

In addition to anchor images, `media-tagger` can also run **zero-shot retrieval** with a CLIP text prompt via `query-text`.

Conceptually:
- embed your text prompt (example: `"a photo of a dog"`) into the same CLIP space
- compute cosine similarity to every stored image embedding
- keep the top `k` above `minScore`

Example (dog prefilter):

```bash
media-tagger query-text --text "a photo of a dog" --k 2000 --minScore 0.22 --out dog_candidates.json
```

This writes:
- `data/dog_candidates.json`
- `data/last_query.json`

So the review/apply workflow stays the same: `review` reads `data/last_query.json`.

---

## 8. Review UI: Human-in-the-Loop is Non-Negotiable

### Why automation alone isn’t enough

No image model is perfect:
- lookalike dogs
- toys
- partial views
- blurry frames

Fully automatic tagging will:
- make mistakes
- silently propagate them
- poison your metadata

### The review step fixes this

You get:
- a grid of candidate images
- checkboxes
- visual confirmation
- full control

This is **exactly how professional labeling pipelines work**.

---

## 9. Sidecars & XMP: How Tags Are Persisted Safely

### What is a sidecar?

A **sidecar file** is a metadata file that lives next to media:

```
IMG_1234.JPG
IMG_1234.xmp
```

The `.xmp` file contains structured metadata:
- keywords
- subjects
- hierarchical tags
- EXIF overrides

### Why sidecars are ideal

- Non-destructive
- File-format agnostic
- Widely supported
- Human-readable (XML)
- Survive copies, backups, moves

This is the gold standard for professional DAM workflows.

### Basename convention (important)

We use:

```
file.ext → file.xmp
```

Not:

```
file.ext.xmp
```

Because:
- better compatibility
- more widely recognized
- cleaner

---

## 10. Tag Hierarchies: Why `Dogs|Teddy` Matters

Tags are hierarchical:

```
Dogs
└── Teddy
```

This enables:
- broad searches (“Dogs”)
- narrow searches (“Dogs|Teddy”)
- reuse across tools

Most DAMs (including Photo Supreme) understand this syntax.

---

## 11. Profiles: Making the System General-Purpose

A **profile** is just a preset:

```json
{
  "tagTemplate": "Subjects|{label}",
  "queryDefaults": { "k": 700, "minScore": 0.25 },
  "autoTags": ["year", "camera"]
}
```

This lets you reuse the same pipeline for:
- pets
- people
- places
- events
- artwork references
- anything visual

Profiles are what make this a **platform**, not a one-off script.

---

## 12. Why This Architecture Scales (Conceptually)

What you’ve built mirrors real systems:

| Component | Analog |
|---------|-------|
| assets.json | catalog index |
| reps | thumbnails |
| embeddings | feature store |
| vector store | ANN index (simplified) |
| review UI | labeling interface |
| sidecars | metadata persistence |

This is *not* a toy architecture.

The only difference between this and a SaaS is:
- where data lives
- whether GPUs are remote
- whether vectors are indexed more aggressively

---

## 13. What You Did *Not* Need to Learn (Good News)

You did **not** need:
- photography theory
- EXIF internals
- ML math
- neural network training
- GPU programming

You used **pretrained models**, **well-known standards**, and **human judgment** — exactly the right tradeoffs.

---

## 14. Key Takeaway

You are not “doing something weird”.

You are:

> Building a local, privacy-preserving, human-verified media understanding pipeline using the same primitives professionals use — just without the SaaS wrapper.

That’s a *very* solid place to be.

---

If you want, next time we can:
- turn this into a **shorter “explainer” for GitHub**
- add diagrams
- or map each concept to a comparable industry tool (Lightroom, Google Photos, etc.)

- - -

What you’re feeling is not “ML confusion”, it’s **missing operational scaffolding**. You have the *engine*, but not yet the *operator’s manual*.

Below is a **much more detailed, step-by-step, operational backgrounder** that answers questions like:

- *What do I do first?*
- *What do I have to create by hand vs what is automatic?*
- *What does a “profile” really mean in practice?*
- *What decisions do I need to make, and when?*
- *What mental model should I use when something goes wrong?*

You can think of this as **“How a normal, non-ML person actually uses `media-tagger`”**.

---


  