# IdeaForge

English · [中文](README.md)

**IdeaForge** (Creative Planning Workbench) is a local-first browser workspace for AI-assisted game design. Its connectable workflow nodes turn natural-language requirements into idea cards, score reports, focused conversations, and structured game design documents.

![IdeaForge workbench](imgs/img_01.png)

## Try online

Demo: [https://idea-forge-psi.vercel.app/](https://idea-forge-psi.vercel.app/)

Configure your own API key under **AI Settings**. The key stays in your browser only.

## Highlights

- Combine AI generation, variable, and data-selection nodes on a free-form canvas.
- Generate idea cards in batches, then search, filter, vote, edit, and score them.
- Run persistent, isolated conversations around selected cards or reference material.
- Organize text into system modules, maintain current and candidate versions, and generate dependency graphs.
- Persist workspaces in the local browser and transfer them as JSON snapshots.

See the [Node Guide](docs/NODES_EN.md) for complete inputs, outputs, connection rules, and usage examples.

## Run locally

Node.js `^20.19.0`, `^22.13.0`, or `>=24.0.0` is required.

```bash
npm install
npm run dev
```

For a production build, run `npm run build` and serve the generated `dist/` directory with any static HTTP server.

Use a current Chrome or Edge browser. The workbench supports mobile, tablet, and desktop viewports at least 360px wide; mobile exposes the complete feature set through the top command menu and bottom navigation.

## Configure AI

Open **AI Settings** and provide an OpenAI-compatible Base URL, API key, and model. The Base URL should be the provider root, for example `https://api.deepseek.com/v1`; do not include `/chat/completions`. The provider must allow browser CORS requests.

The API key is stored in this browser's local IndexedDB. This is convenient for a local tool, but it is not suitable for shared or untrusted devices. Keys are never rendered into cards, exports, or error messages.

## Build your first workflow

A new workspace starts with a blank canvas. Add nodes from the library on the left, then connect compatible ports to form control and data flows.

A typical idea workflow is:

1. Add a **Card Variable** node as the card pool.
2. Add a **Divergence** node and connect its pool input to the Card Variable.
3. Enter a requirement, configure AI, and run Divergence to generate idea cards.
4. Add an **Idea Score** node and connect the same Card Variable; infer dimensions, then run scoring.
5. Use **Card Content** to select one card and connect it to **Chat** for a focused exploration.
6. Pass exported structured chat content through **Text Select** and into **Structured Plan** for further organization.

All workspace state, including layout, card selections, and chat sessions, is persisted in IndexedDB. Use the toolbar save action when you want an immediate persistence point.

## Node documentation

The current node library contains 10 nodes in three groups: Variable, AI Generation, and Data Selection.

- [English Node Guide](docs/NODES_EN.md)
- [中文节点指南](docs/NODES.md)

## Workspace import and export

The workspace rail can export the active workspace as a versioned JSON file. Importing that file always creates and opens an independent copy; it never overwrites an existing workspace.

The snapshot includes the canvas, runs, cards, and chat sessions, but excludes AI settings, service configuration, and API keys.

## Roadmap

- Move reference usage to RAG so nodes retrieve relevant passages by context instead of injecting whole documents.
- Add a market research node for collecting and organizing competitor and market insights.
- Improve interaction and feedback across existing nodes to make building and debugging workflows easier.
- Expand beyond game design with templates and workflows for more general creative and planning use cases.

## License

This project is licensed under the [MIT License](LICENSE).
