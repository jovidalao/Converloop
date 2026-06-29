# Converloop

English | [Simplified Chinese](README.zh-CN.md)

> **Converse. Correct. Remember. Repeat.** A local-first AI language tutor for macOS and Windows: it talks with you, corrects the sentence you just wrote, and remembers every gap so the next practice already knows where to go.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-2337ff.svg)](LICENSE)
[![Platform: macOS | Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-555.svg)](#quick-start)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24c8db.svg)](https://tauri.app)

**[Website](https://jovidalao.com/converloop)** · **[Source code](https://github.com/jovidalao/Converloop)** · **[Report an issue](https://github.com/jovidalao/Converloop/issues)** · **[License](LICENSE)**

Converloop is a local-first AI language-learning desktop app for learners who want practice to compound. It combines real conversation, instant correction, long-term learning memory, voice practice, and focused training in one Tauri app, using your own model API keys by default.

When you write or speak in the target language, Converloop streams a natural reply first and produces structured feedback in parallel. It records errors, correct usage, expression gaps, and review evidence locally, then brings that learning state back into later conversations, focused lessons, listening practice, and drills.

## Screenshots

Place real product screenshots in `docs/screenshots/` when they are ready. The README already has slots for the main story:

<!--
<p align="center">
  <img alt="Converloop conversation with inline correction" src="docs/screenshots/conversation.png" width="880">
</p>

<p align="center">
  <img alt="Converloop Coach Panel and learning memory" src="docs/screenshots/coach-panel.png" width="880">
</p>

<p align="center">
  <img alt="Converloop Practice Center" src="docs/screenshots/practice-center.png" width="880">
</p>
-->

## Why Converloop

- **Conversation first.** The app answers what you meant before it teaches, so practice still feels like talking.
- **Corrections stay attached to your sentence.** You see the wrong span, the corrected sentence, a more natural rewrite, and grammar notes where they matter.
- **Memory is evidence-based.** Errors, wins, and expression gaps become local records with traceable evidence, not vague "AI memory."
- **Review returns in context.** Weak points come back through conversation, lessons, dictation, and drills instead of living only in a flashcard queue.
- **Local data stays yours.** Conversations, profile notes, learning data, settings, and backups are stored on your device; secrets are excluded from backups.

## The Learning Loop

Converloop closes the loop most tools leave open — every turn feeds a learning state that shapes the next one:

1. **Converse** — speak or type in your target language and a natural reply streams back. A real conversation, not a quiz.
2. **Correct** — the fix lands on the sentence you wrote: the wrong span, the correction, a more natural rewrite, and grammar notes on tap.
3. **Remember** — every slip, win, and expression gap becomes a signal in your local learning memory.
4. **Review** — due items quietly return, woven into your next conversation and the training drills.

## Current Status

The v1 learning loop is complete and usable for daily practice. The current product focuses on desktop, local data, BYOK model access, and customizable language-learning workflows.

## Implemented Features

### Conversation And Correction

- Streaming target-language conversation replies, with the tutor agent running in parallel so correction does not block the first token.
- Coach Panel for turn feedback, learning signals remembered by the system, due review items, and custom observer notes.
- Structured correction: full corrected sentence, more natural alternative, error span, native-language explanation, severity, and traceable mastery key.
- Expression gaps: native-language or mixed-language input opens a "how to say this" teaching panel instead of a normal red/green diff.
- Multi-conversation sidebar with pinning, date grouping, and automatic conversation titles.
- Rolling summaries for long conversations, context-usage hints, and `/btw` off-record side questions.
- Conversation actions: branch from here, restart, make harder/easier, swap roles, continue tomorrow, and change scene.

### Learning Memory And Review

- Local SQLite mastery records with evidence timelines; error, correct, introduced, and gap events are all traceable.
- Markdown learner profile for personal facts, interests, long-term preferences, active learning focus, known items, and user-written notes.
- AI preferences can affect conversation, correction, lessons, and reading help separately.
- Code selects due review items from weakness and retention signals, then weaves them into conversation and training.
- Known items are reused as scaffolds for explanation and transfer, so the system does not only focus on mistakes.
- Learning data view supports evidence inspection, manual edits, natural-language edit previews, and confirmed writeback.
- Lesson review and drill writeback preview evidence before the learner confirms it into long-term memory.

### Training Center And Focused Lessons

- Built-in training modes: scenario practice, dictation, and weak-item quick drills.
- Dictation stores misheard words in a separate listening dimension and can adapt future sentences to revisit them.
- Weak-item quick drills turn due review items into short tasks that require active recall.
- Custom training modes use `converloop/drill@1` Markdown documents: frontmatter defines mechanics, body sections define prompts.
- Drills can include topic recommendations, drill observers, session reports, import, and export.
- Focused lessons open teacher-style sessions around grammar, expression gaps, daily review, or a learner-defined goal.
- Task Agent can turn broad goals such as interview prep, business email, or a recurring expression need into a learning project and up to three lesson drafts.
- Practice stats card shows overview, trends, knowledge points, and recurring weak spots.

### Capability Library And Custom Agents

- Capability Library displays built-in capabilities by entry point: conversation, correction, lessons, drill observers, reply explanation, bilingual view, selection analysis, conversation actions, and more.
- Built-in capabilities can be enabled, disabled, hidden, or extended with extra instructions; runs are logged as agent jobs.
- Users can create custom observers, actions, and reply transformers.
- Observers can add Coach notes after each turn; memory writes must go through pending proposals.
- Actions can derive new conversations from the current one or turn a conversation into a focused lesson.
- Reply transformers can attach to AI replies or learner messages and output to a panel, replace text, Coach, or memory proposal.
- `converloop.package` import/export supports sharing lessons and skills, with compatibility for older package formats.

### Voice, Reading, And Models

- LLM providers: OpenAI-compatible endpoints, Anthropic, Gemini, plus Claude / ChatGPT subscription OAuth login paths.
- STT: Soniox real-time streaming, OpenAI-compatible batch transcription, local Parakeet, and local Qwen3-ASR.
- TTS: free Edge Read Aloud and MiMo TTS, with auto-speak, manual speak, rate/pitch/voice settings, and audio caching.
- Bilingual reading, on-demand explanation, and selection translation/analysis are all registered as auditable capabilities.
- Listening page can turn past conversation lines into playable listening material.

### Local Data And Desktop Experience

- First-run onboarding for UI language, native language, target language, level, and model provider.
- API keys, OAuth tokens, STT keys, and TTS keys are stored locally through encrypted secret storage and are excluded from backups.
- One-click readable JSON backup and restore for conversations, learning data, profile, and non-secret settings.
- Settings mirror restores key provider, voice, theme, and shortcut settings if WebView data is cleared.
- English and Chinese UI, command palette, editable shortcuts, themes, and accent settings.
- macOS and Windows builds are validated in CI.

## Tech Stack

- Tauri v2, Rust, React 19, TypeScript, Vite
- SQLite with `tauri-plugin-sql` and Drizzle sqlite-proxy
- Zod plus `zod-to-json-schema` for structured model output schemas
- Device-bound encrypted secret storage in `src-tauri/src/secrets.rs`
- pnpm, Biome, Vitest, GitHub Actions

## Quick Start

Prerequisites:

- Node.js 22
- pnpm 11 via Corepack
- Rust stable
- Tauri v2 system dependencies for your OS

Install dependencies and run the desktop app:

```bash
corepack enable
pnpm install
pnpm tauri dev
```

After the app opens, configure a provider and API key in Settings. Secrets are stored locally through encrypted storage and are not included in backups.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm tauri dev` | Start the Tauri desktop app with Vite HMR |
| `pnpm build` | Type-check and build the frontend |
| `pnpm test` | Run Vitest |
| `pnpm check` | Run Biome and TypeScript checks |
| `pnpm format` | Apply Biome formatting fixes |
| `pnpm tauri build` | Build desktop packages |

Do not casually run `cargo update`: `Cargo.lock` intentionally pins `bitflags` to `2.9.1` because newer versions currently trigger a `dispatch2` macro-recursion build failure in this stack.

## Architecture

The core rule is: conversation agent reads Markdown, tutor agent reads SQLite; code writes SQLite, profile maintainer writes Markdown. LLMs only observe and propose discrete signals; code owns counting, state transitions, persistence, and write safety.

See [docs/design.md](docs/design.md) for the current product shape, core design principles, and future development guidance. Implementation details live in code, types, and tests.

## Documentation

| Document | Contents |
|---|---|
| [docs/design.md](docs/design.md) | Current product shape, core design principles, and development guidance |
| [AGENTS.md](AGENTS.md) | Working rules for AI coding agents in this repository |

## Privacy And Security

- Learning data, settings mirrors, and profile documents are stored locally.
- API keys and OAuth tokens are excluded from backups and encrypted with a device-bound key.
- The current secret store has no master password, so its security ceiling is accidental-disclosure protection rather than full disk-attacker protection.
- Backups export app data and non-secret settings as readable JSON.

## Development And Contributing

Keep changes small and tied to the learning loop. Prompt, schema, migration, and provider details are governed by code and tests; update [docs/design.md](docs/design.md) only when a design principle or product boundary changes. Before opening a PR, run:

```bash
pnpm check
pnpm test
```

## License

Converloop is **dual-licensed**:

- **Open source — [GNU AGPL-3.0-or-later](LICENSE).** You may use, modify, and self-host it freely. Note the AGPL's network clause: if you run a modified version as a service over a network, you must offer your modified source under the AGPL.
- **Commercial license.** A separate proprietary license is available for anyone who cannot or does not want to comply with the AGPL (e.g. shipping closed-source builds, or running a hosted service without releasing changes). See [COMMERCIAL.md](COMMERCIAL.md).

External contributions are accepted under the [Contributor License Agreement](CLA.md), which is what keeps the dual-licensing model possible.
