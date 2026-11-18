# @akirousnow/pi-session-name

A small [pi](https://github.com/earendil-works/pi) extension that uses TypeSafe **Jev** as a classifier to decide when an existing session title is stale.

Instead of renaming every N turns, it checks at the start of a user turn:

> Has the session's main topic changed enough that the current title is now materially misleading or incomplete?

- **High probability** → generate a new title and apply it immediately, while the agent is still running.
- **Medium probability** → generate a candidate at the start, then show a selector with the current title, suggested title, and edit option once the agent settles.
- **Low probability** → do nothing.
- **Manual names always win.** Titles set with `/session-name`, Pi's builtin `/name`, `--name`, or another extension are never auto-refreshed.

It also gives an untitled session its first title from the first user prompt, before the agent starts working. That initial title does not need Jev.

The start-time title work is fire-and-forget and never delays the agent's first token. Selectors are deferred to `agent_settled` so a running agent is never interrupted by a modal dialog.

## Requirements

- pi **1.4 or newer** (classifier models, `ctx.modelRegistry.classify()`, and `agent_settled`).
- A TypeSafe API key for `typesafe/jev-latest`, or another configured classifier model.
- A title-generation model; by default the current session model.

## Install

From GitHub:

```sh
pi install git:github.com/akirousnow/pi-session-name
```

Pin the current release:

```sh
pi install git:github.com/akirousnow/pi-session-name@v0.2.0
```

From a local checkout:

```sh
pi install /path/to/pi-session-name
```

Or load it for one run:

```sh
pi -e /path/to/pi-session-name
```

## Authentication

The extension never stores an API key itself. Pi resolves classifier authentication through its normal credential store.

For TypeSafe, either export the key:

```sh
export TYPESAFE_API_KEY=...
pi
```

or store it in pi's private `auth.json`:

```json
{
  "typesafe": {
    "type": "api_key",
    "key": "your-typesafe-key"
  }
}
```

`~/.pi/agent/auth.json` should be mode `0600` and must not be committed.

Check it with:

```sh
pi auth check --provider typesafe --json
```

## Configuration

Settings live under `sessionName` in pi's global or project `settings.json`:

```json
{
  "sessionName": {
    "enabled": true,
    "classifier": "typesafe/jev-latest",
    "titleModel": "auto",
    "askThreshold": 0.65,
    "autoThreshold": 0.9,
    "minTurnsBetweenChecks": 2,
    "minTurnsBetweenRenames": 4,
    "maxPrompts": 3,
    "maxRenames": 8,
    "classifierMessages": 6,
    "titleMessages": 20,
    "maxStateChars": 6000,
    "maxTitleContextChars": 12000,
    "maxTitleLength": 52,
    "scopeMaxLength": 12,
    "useTags": true,
    "extraTags": [],
    "titleIncludeTools": false,
    "classifierTimeoutMs": 20000,
    "debug": false
  }
}
```

### Options

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables initial naming and Jev-triggered refreshes. |
| `classifier` | `typesafe/jev-latest` | `provider/modelId`, or `auto` to pick the first available Jev/classifier. |
| `titleModel` | `auto` | `auto` uses the current session model; otherwise `provider/modelId`. |
| `askThreshold` | `0.65` | Minimum rename probability before doing anything. |
| `autoThreshold` | `0.9` | At or above this probability, apply the generated title without asking. Clamped to at least `askThreshold`. |
| `minTurnsBetweenChecks` | `2` | User turns between classifier checks. |
| `minTurnsBetweenRenames` | `4` | User turns between title changes. |
| `maxPrompts` | `3` | Maximum medium-confidence selectors per session. Set `0` to disable prompts. |
| `maxRenames` | `8` | Maximum automatic/manual-approved title changes per session. |
| `classifierMessages` | `6` | Recent user/assistant messages sent to Jev. Tool results are never sent to the classifier. |
| `titleMessages` | `20` | Recent messages sent to the title model. |
| `maxStateChars` | `6000` | Hard cap for the Jev state. |
| `maxTitleContextChars` | `12000` | Hard cap for the title-generation context. |
| `maxTitleLength` | `52` | Maximum description length (tags/scopes excluded). |
| `scopeMaxLength` | `12` | Maximum scope length; scopes are one lowercase alphanumeric word. |
| `useTags` | `true` | Use Conventional Commit-style tags such as `fix(auth): ...`. |
| `extraTags` | `[]` | Extra allowed tags, in addition to the built-in list. Invalid tags are ignored. |
| `titleIncludeTools` | `false` | Include tool results in title-generation context. |
| `classifierTimeoutMs` | `20000` | Timeout for the Jev call. |
| `debug` | `false` | Log classifier probabilities and decisions to stderr. `PI_DEBUG_SESSION_NAME=1` also enables logs. |

Project settings override global settings for the keys above.

## Commands

```text
/session-name              Show the current session name
/session-name <title>      Set a manual title
/session-name auto         Regenerate the title immediately, bypassing Jev
```

`/session-name auto` is explicit: it replaces a manually set title and marks the result as an automatically managed title. A normal manual title is not auto-refreshed later.

## Behavior details

- Initial naming and high-confidence refreshes run at `before_agent_start`, from the latest user prompt plus recent context.
- Medium-confidence candidates are generated at the start but the selector is shown at `agent_settled`, when the agent is idle.
- Start-time work is asynchronous and does not block the agent's first token.
- `agent_settled` is used instead of `agent_end` for the selector because `agent_end` can still be followed by retries, compaction, or queued continuations.
- Aborted runs are ignored and clear any queued suggestion.
- A title changed manually while title generation is in flight always wins.
- If the title model returns an invalid title or the datetime fallback, the old title is kept. The extension never downgrades a good title to a temporary date title.
- A generated title that is identical to the current title is a no-op.
- Background refreshes do not write visible "Session renamed" messages into the transcript.
- Jev receives only the current title, the latest user message, a few recent user/assistant messages, the turn count, and the first user message. It does not receive tool output.
- The title model receives compact session context, not the entire branch by default.

## Development

```sh
npm install
npm test
npm pack --dry-run
```

The package exposes `extensions/session-name/index.ts` through the `pi` manifest.

## Notes

- Classifier model IDs differ by provider. Examples: `typesafe/jev-latest`, `openrouter/typesafe/jev-1.14`, `cloudflare-workers-ai/typesafe/jev`, `vercel-ai-gateway/typesafe-ai/jev`, `opencode/jev-1.13`.
- If the configured classifier is unavailable, refreshes are skipped; initial naming still works with the title model.
- The title generator currently uses pi's provider-neutral `ctx.modelRegistry.complete()` and the current model by default.
