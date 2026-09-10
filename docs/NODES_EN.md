# IdeaForge Node Guide

English · [中文](NODES.md) · [Back to README](../README_EN.md)

IdeaForge currently provides 10 nodes in three groups: **Variable**, **AI Generation**, and **Data Selection**. This guide covers their purpose, ports, primary actions, and common connection patterns.

## Workbench and connections

A new workspace starts with a blank canvas. Add nodes from the library on the left, then connect their ports to form control or data flows.

![Workbench example](../imgs/img_01.png)

### Core rules

- **Control flow** determines execution order. Brief, Divergence, Idea Score, Content Extract, and Structured Plan have execution input and output ports.
- **Data flow** carries values such as `Text`, `TextStruct`, and `CardCollection`.
- Each input accepts one edge, except `Text[]` inputs, which accept multiple edges.
- A `TextStruct` input only accepts `TextStruct`; a `TextStruct` output can connect to `Text` or `Text[]` inputs.
- Workflows cannot contain cycles.
- Select a node in a control chain and use the toolbar run action to execute from that node downstream.

## Variable

### Card Variable

Card Variable is the workspace's idea-card pool. Divergence appends cards to it, and Idea Score writes scores back to those same cards.

- **Input:** None.
- **Output:** Card collection (`CardCollection`).
- **Primary actions:** Double-click to open the card pool; search, filter, vote, edit, delete, or inspect cards.
- **Connection constraint:** The pool inputs of Divergence and Idea Score must connect to a Card Variable.

![Card browser](../imgs/img_02.png)

After scoring, the Score Report tab compares cards across dimensions. Manual upvotes and downvotes take precedence over average scores in sorting and future-generation preferences.

![Card score report](../imgs/img_03.png)

## AI Generation

### Brief

Brief turns upstream text or a custom prompt into a game-system design brief. Use it to align goals and constraints before divergence or structured planning.

- **Input:** Optional control `exec`; optional text `source`.
- **Output:** Optional control `execOut`; Brief text `text`.
- **Primary actions:** Edit the prompt and fields such as title, background, target players, design goals, hard constraints, success metrics, and out-of-scope items.
- **Note:** Running requires a valid AI configuration. Without upstream text, generation relies only on the node prompt.

### Divergence

Divergence generates idea cards in batches from a requirement, upstream prompt, and selected ideation methods, then appends them to a Card Variable.

- **Input:** Optional control `exec`; card pool `pool`; optional text `prompt`.
- **Output:** Optional control `execOut`. Cards are written directly to the pool rather than emitted from a data output.
- **Primary actions:** Enter a requirement; infer methods with AI or select them manually; configure batch size, concurrency, and temperature.
- **Note:** `pool` must connect to a Card Variable. Later runs use existing votes and scores as preference signals.

### Idea Score

Idea Score first infers evaluation dimensions from context, then scores every idea in a card pool. Scores are written back to cards and used for ordering.

- **Input:** Optional control `exec`; card collection `cards`; optional text `context`.
- **Output:** Optional control `execOut`. Scores are written directly to the card pool.
- **Primary actions:** Infer dimensions, run batch scoring, and inspect the Score Report in the card pool.
- **Note:** `cards` must connect to a Card Variable. Running requires an AI configuration.

### Chat

Chat supports focused, multi-turn exploration around upstream text, card content, or reference material. Conversations are isolated from one another and persisted locally.

- **Input:** Text array `text`, accepting multiple incoming connections.
- **Output:** Structured text `context`, built from conversation turns marked for export.
- **Primary actions:** Create conversations, switch skills, edit the latest message, branch, and include or exclude turns from export.
- **Note:** Chat is outside control flow. Generating replies requires an AI configuration.

![Chat interface](../imgs/img_04.png)

### Content Extract

Content Extract uses AI to summarize long upstream text, making it useful for capturing key points inside a control chain.

- **Input:** Optional control `exec`; text `input`.
- **Output:** Optional control `execOut`.
- **Primary actions:** Run the node and inspect its summary and status.
- **Note:** The summary is stored in node configuration and has no connectable text output. When upstream text changes, the existing summary becomes stale.

### Structured Plan

Structured Plan turns a Brief, chat result, or other text into game-system modules. Each module contains structured content such as an overview, rules, formulas, and acceptance conditions.

- **Input:** Optional control `exec`; text `input`.
- **Output:** Optional control `execOut`; current module collection `modules` (`TextStruct`).
- **Primary actions:** Inspect and edit modules; compare current and candidate versions; save the current version; view the document and dependency graph.
- **Note:** Only explicit systems and systems required by the core loop become modules. Saving the current version updates the official output and marks downstream nodes stale; AI regeneration first creates a latest candidate.

![Structured plan interface](../imgs/img_05.png)

The dependency graph visualizes directional relationships between modules. Generate graphs separately for current and candidate versions, tune layout parameters, and inspect direct dependencies, indirect dependencies, and major paths. Editing a module marks the corresponding graph stale.

![Dependency graph](../imgs/img_06.png)

## Data Selection

### Card Content

Card Content selects one card from a Card Variable and formats it as plain text, commonly for connecting a single idea to Chat.

- **Input:** Card collection `cards`.
- **Output:** Text `content`.
- **Primary actions:** Select a card in the property panel; double-click the node to inspect card details.
- **Note:** This node does not participate in control flow.

### Text Select

Text Select chooses one item from a `TextStruct`, such as exported chat turns or Structured Plan modules, and converts it to plain text.

- **Input:** Structured text `input`.
- **Output:** Text `text`.
- **Primary actions:** Choose an item from the upstream list.
- **Note:** It only accepts a `TextStruct` source. If the upstream item is removed, the selected target is shown as invalid.

### Reference

Reference selects documents from the workspace reference library and provides their titles and bodies as cited text to Chat or other downstream nodes.

- **Input:** None.
- **Output:** Text array `text`.
- **Primary actions:** Add or import documents through the toolbar library, then select one or more references in the node.
- **Note:** Reference is outside control flow. Its `Text[]` output can be combined with other text sources connected to Chat.

![Reference library](../imgs/img_07.png)

## Typical workflows

### Idea card workflow

1. Add a Card Variable.
2. Connect the Divergence `pool` input to it, enter a requirement, and run the node.
3. Double-click the Card Variable to browse, filter, and vote on generated cards.
4. Connect Idea Score `cards` to the same Card Variable, infer dimensions, and run scoring.
5. Select one card through Card Content and connect its text to Chat for deeper exploration.

### Structured planning workflow

1. Select source material with Reference and connect it to Chat.
2. Discuss the design in Chat and mark useful turns for export.
3. Connect Chat `context` to Text Select and choose one item.
4. Connect the selected text to Brief or Structured Plan.
5. Review candidate modules, save an approved current version, and generate its dependency graph.
