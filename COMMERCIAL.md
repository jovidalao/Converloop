# Commercial Licensing & Open-Core Boundary

This document explains (1) how Converloop is licensed, and (2) what is intentionally
**not** in this public repository. It is the reference for the project's open-core
business model.

## 1. Dual licensing

Converloop's public source is licensed under the **GNU AGPL-3.0-or-later** (see
[LICENSE](LICENSE)). The AGPL is a strong copyleft license. In particular, its
"network use" clause means that **if you run a modified version of Converloop as a
service that users interact with over a network, you must make your modified source
available to those users under the AGPL.**

That is fine for personal use, self-hosting, and other open-source projects. It is
usually **not** acceptable for companies that want to:

- ship a **closed-source** product built on Converloop,
- offer a **hosted/SaaS** service based on it without releasing their changes, or
- bundle it into proprietary software.

For those cases, the Maintainer (Wei Wang) offers a separate **commercial license**
that removes the AGPL's copyleft obligations. The Maintainer can offer this because of
the [Contributor License Agreement](CLA.md): all contributions grant the right to
relicense, so the Maintainer holds the rights needed to license the whole work
commercially.

**To inquire about a commercial license:** jovidalao@gmail.com

> This file is informational and is not itself a license or an offer. Commercial terms
> are set out in a separate signed agreement.

## 2. Open-core boundary — what lives where

The strategy is **open engine, proprietary service & content**. The code in this
repository is the "engine." The revenue-generating pieces are kept in separate,
private repositories and are never committed here.

### In this public repository (AGPL)

- The desktop app shell (Tauri + React/TypeScript).
- The agent engine: conversation, tutor, profile maintainer, summarize.
- The drill/training system and capability registry.
- Mastery tracking, spaced repetition, and local learning stats.
- **Bring-Your-Own-Key (BYOK)** providers: users supply their own OpenAI-compatible /
  Gemini / Claude / Codex credentials.
- Local-first storage and the open file/data formats.

### NOT in this repository (proprietary)

These are the things customers actually pay for. Keep them out of every public commit.

| Asset | Why it's private |
| --- | --- |
| **Managed-inference backend** | The hosted proxy that holds *our* API keys and does auth, metering, rate-limiting, and billing. This is the core of the turnkey paid product (and the future mobile backend). |
| **Accounts & billing** | User accounts, subscription/entitlement checks, payment integration (Paddle/LemonSqueezy). |
| **Premium content packs** | Curated curricula and scenario drills sold as paid content. |
| **Code-signing & notarization certs** | Apple Developer / Windows signing material; the signed auto-updating build pipeline. |
| **Brand assets** | The "Converloop" name, logo, and marketing site. The OSS engine ships under a neutral identity; the brand is licensed only to official builds. |

### Rules to keep the boundary clean

1. **Never ship a real API key in the client.** Build-time `VITE_*` variables are baked
   into the binary and are extractable — the turnkey build must reach the LLM only
   through the managed-inference backend, never with an embedded key.
2. The open engine talks to paid services through **stable, documented seams**
   (e.g. a provider plugin point), so the proprietary backend plugs in without forking
   the engine.
3. A self-hoster cloning this repo gets a fully working **BYOK** app — just not the
   hosted convenience, premium content, signed builds, or brand.

## 3. Why AGPL (not MIT/BSL)

- **vs. MIT/Apache:** permissive licenses would let a competitor build a closed hosted
  clone of Converloop with no obligation to contribute back. AGPL's network clause
  closes that hole.
- **vs. BSL / source-available:** those are not OSI-approved "open source," which costs
  goodwill and visibility in open-source communities — the opposite of our
  open-for-distribution goal. AGPL + CLA already protects the business while staying
  genuinely open source.
