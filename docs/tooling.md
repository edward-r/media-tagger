## xenova/transformers

xenova/transformers (published on npm as @xenova/transformers) is a JavaScript/TypeScript library that lets you run Hugging Face–style Transformer models directly in the browser or in Node.js, without Python.
What it’s for

Client-side / JS inference: do text, vision, and audio ML inference from JS (e.g., in a web app, Electron app, serverless function, Node backend).
Hugging Face–like “pipelines”: a high-level API similar to Python transformers pipelines (sentiment analysis, embeddings, question answering, summarization, translation, image classification, etc.).

Easy model loading: can load models by name (often from the Hugging Face Hub) and cache them locally.
How it works (high level)

It runs models using JS-friendly runtimes (commonly ONNX Runtime under the hood), enabling acceleration via WebAssembly and, in supported environments, WebGPU.

It aims to be “drop-in familiar” if you know Hugging Face Transformers, but it’s not a 1:1 replacement for the full Python ecosystem.
Typical use cases

### Privacy-first apps (process text/images locally in the browser)

Low-latency UI features (embeddings for semantic search, classification, highlighting, autocomplete).
No-backend prototypes (ML features without standing up a Python service).

Tiny example

```javascript
import { pipeline } from "@xenova/transformers";

const classifier = await pipeline("sentiment-analysis");
const out = await classifier("I love this library!");
console.log(out);
```

Important caveats

Not every Hugging Face model/config is supported; compatibility depends on conversion/runtime support.
Performance varies a lot by device and whether WebGPU is available; large models can still be heavy for browsers.
