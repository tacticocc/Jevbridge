<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]



<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/gamesonrblx/Jevbridge">
    <img src="brand/icon.png" alt="Jevbridge logo" width="180" height="180">
  </a>

  <h3 align="center">Jevbridge</h3>

  <p align="center">
    ACP and MCP adapter that bridges TypeSafe Jev with any LLM.
    <br />
    Computer use and typed decisions alongside Codex, Claude, Grok, and OpenCode.
    <br />
    <br />
    <a href="https://github.com/gamesonrblx/Jevbridge"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/gamesonrblx/Jevbridge">View Demo</a>
    &middot;
    <a href="https://github.com/gamesonrblx/Jevbridge/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    &middot;
    <a href="https://github.com/gamesonrblx/Jevbridge/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#core-capabilities">Core Capabilities</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#mcp-server">MCP Server</a></li>
    <li><a href="#acp-adapter">ACP Adapter</a></li>
    <li><a href="#computer-use">Computer Use</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

<div align="center">
  <a href="https://github.com/gamesonrblx/Jevbridge">
    <img src="brand/icon.png" alt="Jevbridge" width="220" height="220">
  </a>
</div>

[TypeSafe Jev](https://typesafe.ai) is a System One model: unstructured state in, typed probabilistic decisions out. It does not generate text. That makes it a poor chatbot and an excellent function call for routing, gating, scoring, and computer-use action selection.

Jevbridge is the adapter that sits **alongside** the LLM you already run.

- **Native Jev** when `TYPESAFE_API_KEY` is set.
- **Any LLM as System One** when it is not — Codex, Claude, Grok, OpenCode, or a generic OpenAI-compatible endpoint.
- **ACP over stdio** so Zed, JetBrains, and other Agent Client Protocol hosts can treat Jev as the decision sidecar for a generating model.
- **Confidence gates** so a peaked distribution executes, a middling one confirms, and a destructive click does not go unsupervised.

The LLM writes the plan and the explanation. Jevbridge returns `noul`, `choice`, and `score` answers that software can branch on.

Intended home: [`tacticocc/Jevbridge`](https://github.com/tacticocc). This public repository is published from the connected GitHub account until it can be transferred into that organization.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Core Capabilities

- Evaluate one `state` against mixed Choice, Score, and Noul questions.
- Swap backends (`jev` | `llm` | `heuristic` | `auto`) without changing question shapes.
- Confidence-gate tool calls and computer-use clicks (`execute`, `confirm`, `escalate`, `abort`).
- Speak MCP (`jev_decide`, `jev_gate`, `jev_computer_use`) and ACP over stdio.
- Ship recipes for support routing, destructive command gates, context keep/drop, and GUI next-action.
- Run offline with the heuristic backend in tests and CI.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With

* [![TypeScript][TypeScript]][TypeScript-url]
* [![Node.js][Node.js]][Node.js-url]
* [![TypeSafe][TypeSafe]][TypeSafe-url]
* [![ACP][ACP]][ACP-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- GETTING STARTED -->
## Getting Started

Jevbridge is a zero-dependency Node 22 library plus MCP and ACP stdio binaries. You do not need a TypeSafe key to try it: the heuristic backend and any OpenAI-compatible LLM both speak the same protocol.

### Prerequisites

* Node.js 22 or newer
* Git
* Optional: a [TypeSafe API key](https://console.typesafe.ai/settings/keys)
* Optional: an LLM key (`XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENCODE_API_KEY`)

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/gamesonrblx/Jevbridge.git
   cd Jevbridge
   ```
2. Install (no runtime npm dependencies)
   ```sh
   npm install
   ```
3. Export keys you actually have. Native Jev is preferred; otherwise Jevbridge wraps your LLM.
   ```sh
   export TYPESAFE_API_KEY=ts_...
   export JEVBRIDGE_LLM=xai
   export XAI_API_KEY=xai-...
   ```
4. Run a recipe without any network
   ```sh
   node --experimental-strip-types src/cli.ts eval support-route
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- USAGE EXAMPLES -->
## Usage

### Library

```ts
import { evaluate, gate, noul, choice, score } from "./src/index.ts";

const result = await evaluate({
  state: "I was charged twice for order A-104. Refund the duplicate today.",
  questions: {
    refund: noul("Does this request a refund?"),
    team: choice("Which team should handle this?", {
      billing: "Payments, invoices, refunds.",
      technical: "Bugs, outages, integrations.",
      other: "None of the above.",
    }),
    urgency: score("How urgent is this?", [
      "Can wait a week",
      "Handle today",
      "Blocking now",
    ]),
  },
  backend: "auto",
  jev: process.env.TYPESAFE_API_KEY
    ? { apiKey: process.env.TYPESAFE_API_KEY }
    : undefined,
});

const decision = gate(result.answers, { choiceId: "team" });
if (decision.action === "execute") {
  // branch on result.answers.team.choice
}
```

### CLI

```sh
node --experimental-strip-types src/cli.ts recipes
node --experimental-strip-types src/cli.ts eval computer-use
node --experimental-strip-types src/cli.ts mcp
node --experimental-strip-types src/cli.ts acp
```

Or use the wrapper:

```sh
node bin/jevbridge.mjs eval destructive-gate
```

### Environment

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Native Jev (`POST https://api.typesafe.ai/v1/systemone`) |
| `JEVBRIDGE_LLM` | `xai` \| `openai` \| `anthropic` \| `opencode` \| `codex` \| `generic` |
| `JEVBRIDGE_LLM_MODEL` | Override model id |
| `JEVBRIDGE_BASE_URL` | Override OpenAI-compatible base URL |
| `XAI_API_KEY` | Grok |
| `OPENAI_API_KEY` | OpenAI / Codex |
| `ANTHROPIC_API_KEY` | Claude |
| `OPENCODE_API_KEY` | OpenCode |

`backend: "auto"` uses Jev when a TypeSafe key is present, otherwise the LLM adapter, otherwise heuristic.

With no API key, `auto` falls back to the local keyword scorer. The payload reports `"backend": "heuristic"`. That scorer includes question text in its evidence, so asking "would this spend money, delete data, or submit a form?" about `"hello world"` can still score high from word overlap. Treat heuristic numbers as a smoke test, not a safety signal.

_For more examples, see `src/recipes.ts` and `skills/jevbridge/SKILL.md`._

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## MCP Server

Jevbridge speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio (newline-delimited JSON-RPC 2.0). Point Claude Desktop, Cursor, Codex, OpenCode, or any MCP host at `jevbridge mcp`. The generating model keeps writing; Jevbridge is the typed decision tool.

| Tool | What it does |
| --- | --- |
| `jev_decide` | Fan out `noul` / `choice` / `score` on one state. Returns answers + gate. |
| `jev_gate` | Confidence-gate already computed answers (`execute` / `confirm` / `escalate` / `abort`). |
| `jev_computer_use` | Next GUI action from a closed set: click, type, scroll, wait, screenshot, done, abort. |
| `jev_recipe` | Run a built-in recipe (`support-route`, `computer-use`, `destructive-gate`, `compaction`). |

Also exposes `jevbridge://recipe/{id}` resources and two prompts.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jevbridge": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/Jevbridge/src/cli.ts",
        "mcp"
      ],
      "env": {
        "TYPESAFE_API_KEY": "ts_..."
      }
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.jevbridge]
command = "node"
args = ["--experimental-strip-types", "/absolute/path/to/Jevbridge/src/cli.ts", "mcp"]
```

OpenCode (`opencode.json`) and Cursor (`.cursor/mcp.json`) live in `examples/`. Drop-in copies:

* `examples/claude-desktop.json`
* `examples/cursor.mcp.json`
* `examples/codex.config.toml`
* `examples/opencode.json`

Example tool call:

```json
{
  "name": "jev_decide",
  "arguments": {
    "state": "I was charged twice for order A-104. Refund the duplicate today.",
    "questions": {
      "refund": { "type": "noul", "instructions": "Does this request a refund?" },
      "team": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {
          "billing": "Payments, invoices, refunds.",
          "technical": "Bugs, outages, integrations.",
          "other": "None of the above."
        }
      }
    }
  }
}
```

Call `jev_gate` before a destructive tool. Call `jev_computer_use` instead of asking the LLM which CSS selector to click.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## ACP Adapter

Jevbridge implements the [Agent Client Protocol](https://agentclientprotocol.com) over stdio with LSP-style `Content-Length` framing.

Add to Zed `settings.json`:

```json
{
  "agent_servers": {
    "Jevbridge": {
      "type": "custom",
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/Jevbridge/src/cli.ts",
        "acp"
      ],
      "env": {
        "TYPESAFE_API_KEY": "ts_...",
        "JEVBRIDGE_LLM": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

On `session/prompt` the adapter:

1. Classifies the turn (question, code edit, computer use, terminal).
2. Calls Jev or the LLM System One adapter.
3. Confidence-gates the result.
4. Streams `session/update` tool calls and a short agent message.

Codex, Claude Code, Grok Build, and OpenCode keep generating. Jevbridge decides.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## Computer Use

Computer-use loops waste frontier tokens on “what should I click.” Jevbridge scores a GUI observation against a **closed** action set:

`click` · `type` · `scroll` · `wait` · `screenshot` · `done` · `abort`

plus target, safety, destructiveness, and goal progress. A refund button that spends money comes back `confirm`, not `execute` — destructiveness is an independent gate, so a peaked action distribution does not skip it.

```ts
import { computerUseQuestions, observationState, readAction } from "./src/index.ts";

const state = observationState({
  goal: "Refund the duplicate charge on order A-104",
  app: "Billing Console",
  visible: ["Refund duplicate", "Email customer", "Close ticket"],
});

const result = await evaluate({
  state,
  questions: computerUseQuestions(["Refund duplicate", "Email customer", "Close ticket"]),
  backend: "auto",
});

const action = readAction(result.answers);
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ROADMAP -->
## Roadmap

- [x] System One client (Jev, LLM adapter, heuristic)
- [x] Confidence gate
- [x] Computer-use recipes
- [x] ACP stdio adapter (`initialize`, `session/new`, `session/prompt`)
- [x] MCP stdio server (`jev_decide`, `jev_gate`, `jev_computer_use`, `jev_recipe`)
- [ ] Proxy an upstream ACP agent (Claude Code, Codex) and intercept tool calls
- [ ] Session load / resume
- [ ] Published npm package `@tacticocc/jevbridge`
- [ ] Transfer this repository into the `tacticocc` organization

See the [open issues](https://github.com/gamesonrblx/Jevbridge/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please add or update tests under `src/*.test.ts` for behavioral changes.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Top contributors:

<a href="https://github.com/gamesonrblx/Jevbridge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=gamesonrblx/Jevbridge" alt="contrib.rocks image" />
</a>



<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTACT -->
## Contact

Tactico — [github.com/tacticocc](https://github.com/tacticocc)

Project Link: [https://github.com/gamesonrblx/Jevbridge](https://github.com/gamesonrblx/Jevbridge)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [TypeSafe Jev](https://typesafe.ai) and the [System One adapter](https://github.com/typesafe-ai/system-one-adapter-python)
* [Agent Client Protocol](https://agentclientprotocol.com)
* [Choose an Open Source License](https://choosealicense.com/)
* [Img Shields](https://shields.io)
* [GitHub Pages](https://pages.github.com)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/gamesonrblx/Jevbridge.svg?style=for-the-badge
[contributors-url]: https://github.com/gamesonrblx/Jevbridge/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/gamesonrblx/Jevbridge.svg?style=for-the-badge
[forks-url]: https://github.com/gamesonrblx/Jevbridge/network/members
[stars-shield]: https://img.shields.io/github/stars/gamesonrblx/Jevbridge.svg?style=for-the-badge
[stars-url]: https://github.com/gamesonrblx/Jevbridge/stargazers
[issues-shield]: https://img.shields.io/github/issues/gamesonrblx/Jevbridge.svg?style=for-the-badge
[issues-url]: https://github.com/gamesonrblx/Jevbridge/issues
[license-shield]: https://img.shields.io/github/license/gamesonrblx/Jevbridge.svg?style=for-the-badge
[license-url]: https://github.com/gamesonrblx/Jevbridge/blob/main/LICENSE
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node.js]: https://img.shields.io/badge/Node.js_22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node.js-url]: https://nodejs.org/
[TypeSafe]: https://img.shields.io/badge/TypeSafe_Jev-111111?style=for-the-badge
[TypeSafe-url]: https://docs.typesafe.ai/
[ACP]: https://img.shields.io/badge/ACP-stdio-555555?style=for-the-badge
[ACP-url]: https://agentclientprotocol.com
