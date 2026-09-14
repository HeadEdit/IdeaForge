# Vane-derived search implementation

Upstream: https://github.com/ItzCrazyKns/Vane
Pinned revision: 348feca3e378fb4157b217724ed508dc707f853f

`vane-core.mjs` and the research loop in `pipeline.mjs` derive from:

- src/lib/agents/search/researcher/index.ts
- src/lib/agents/search/researcher/actions/search/baseSearch.ts
- src/lib/agents/search/researcher/actions/search/webSearch.ts
- src/lib/prompts/search/researcher.ts

Adaptations: OpenAI-compatible model adapter, batched embeddings, operation-only
progress events, bounded requests, URL normalization, validated tool arguments,
planner fallback, cancellation, and sources-only output. Widget, upload, database,
private reasoning preamble, and Quality scraping paths are omitted. These are
adapted modules, not a verbatim or automatically synchronized Vane distribution.

MIT License

Copyright (c) 2026 ItzCrazyKns

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
