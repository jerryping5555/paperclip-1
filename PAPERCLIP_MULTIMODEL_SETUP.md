# PAPERCLIP_MULTIMODEL_SETUP.md

How to run Paperclip with models other than Claude/OpenAI — GLM (Z.ai), Qwen,
Gemini, Grok, Kimi, NVIDIA NIM, anything on OpenRouter — both through
onboarding and afterwards.

## The mental model

Paperclip's onboarding tiles are **harnesses** (CLI agents), not models:

| Tile | Harness | Provider |
| --- | --- | --- |
| Claude | Claude Code CLI | Anthropic |
| OpenAI | Codex CLI | OpenAI |
| Gemini | Gemini CLI | Google |
| Grok | Grok Build CLI | xAI |
| Kimi | Kimi Code CLI | Moonshot |
| **OpenCode** | OpenCode CLI | **multi-provider** (z.ai, Google, OpenRouter, …) |
| **Pi** | Pi CLI | **multi-provider** (OpenRouter, …) |
| Cursor | Cursor CLI | Cursor |

There is no "GLM tile" because there is no GLM harness adapter. GLM, Qwen,
NVIDIA NIM etc. are *providers* reached through the multi-provider harnesses
(OpenCode, Pi) using **each provider's own key** — exactly like the OpenCode
CLI itself works. Paperclip does not invent an "OpenCode key"; it never existed.

The tile row is driven by the `recommended: true` flag in
`ui/src/adapters/adapter-display-registry.ts` — every harness the onboarding
connect step can drive is flagged there. Adding a tile = flipping that flag.

## Onboarding with GLM (or Qwen, etc.) — the default path

This is the "I already use the OpenCode CLI with my GLM key" path. **No key is
asked for.**

1. On the machine running the Paperclip server, sign the OpenCode CLI in once
   per provider you want:

   ```sh
   opencode auth login   # pick z.ai, paste your GLM key; repeat per provider
   ```

2. In onboarding, pick the **OpenCode** tile. The step opens in host-sign-in
   mode and explains this; it does not demand a key.

3. Pick your model from the **Model** dropdown — grouped by provider (`zai/`,
   `google/`, …). The list is what the server's own `opencode models` reports,
   catalog-refreshed on load (see troubleshooting below).

4. **Connect**. The wizard probes the environment with your host sign-in and
   hires the agent. Done.

Pi works the same way. Gemini/Kimi/Cursor tiles also default to host sign-in;
their API-key fields are opt-in via the "use an API key" link.

## Opt-in: API key mode (OpenRouter)

If you want one key that fronts many providers, click the credential-mode link
under the tiles and paste an **OpenRouter** key (that is what the field stores
for OpenCode/Pi — `OPENROUTER_API_KEY`). In that mode the model picker lists
OpenRouter's public catalog (`openrouter/z-ai/glm-*`, `openrouter/qwen/*`, …).
This mode is deliberately **not** the default; host sign-in is.

Per-source key env vars (API mode): `ANTHROPIC_API_KEY` (Claude),
`OPENAI_API_KEY` (OpenAI), `GEMINI_API_KEY` (Gemini), `XAI_API_KEY` (Grok),
`KIMI_MODEL_API_KEY` (Kimi), `CURSOR_API_KEY` (Cursor),
`OPENROUTER_API_KEY` (OpenCode/Pi).

## Other GLM paths

- **Claude tile + GLM Coding Plan** — Z.ai's plan is Anthropic-compatible. Set
  `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and
  `ANTHROPIC_AUTH_TOKEN=<key>` in the agent's env config. The Claude Code
  adapter honors both.
- **Hermes agent (first-class zai)** — Hermes has a built-in `zai` provider
  (`ZAI_API_KEY`, auto-detects `glm-*` models). Not an onboarding tile (the
  wizard has no wiring for it); add it via **Agents → New agent → Hermes**.

## Troubleshooting

**A model I see in my terminal is missing from the wizard's list.**
The wizard refreshes the harness's model catalog on load; if a model is still
missing it is probably defined in a *project-level* opencode config
(`opencode.json` in a project dir). Model discovery deliberately ignores
project configs (the wizard cannot know which project you mean, and it keeps
opencode from writing config into the server's own repo). Move those model
definitions into your **global** config — `~/.config/opencode/opencode.json` —
and they appear everywhere, terminal included.

**The wizard still asks for an OpenRouter key I never wanted.**
Only an *explicit* credential-mode click is remembered across reloads. If you
ever clicked "use an API key", click the subscription/host-sign-in link once,
or clear the `paperclip-onboarding-state` key in localStorage.

**Where the code lives**

- Tile set: `ui/src/adapters/adapter-display-registry.ts` (`recommended` flag)
- Connect step (modes, picker, host-sign-in default):
  `ui/src/components/OnboardingWizard.tsx`
- Tile labels / host-sign-in instructions:
  `ui/src/components/AdapterLoginChrome.tsx`
- Managed AI connections (OpenRouter et al.): `packages/shared/src/ai-connections.ts`
- OpenCode model discovery (catalog refresh): `packages/adapters/opencode-local/src/server/models.ts`
