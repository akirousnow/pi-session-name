# Changelog

## [0.3.0] - 2026-11-18

### Changed

- Removed the medium-confidence title selector and all interactive title prompts.
- Titles are now refreshed only when Jev's rename probability reaches `autoThreshold`.
- Removed `askThreshold` and `maxPrompts`; lower-confidence decisions are ignored.
- `agent_settled` now only waits for start-time title work so it can finish before the process settles.

## [0.2.0] - 2026-11-18

### Changed

- Moved initial naming and high-confidence refreshes to `before_agent_start` so the title is visible while the agent is running.
- Deferred medium-confidence selectors to `agent_settled` so a running agent is never interrupted.
- Included the current user prompt in classifier and title context because `before_agent_start` can run before the prompt is persisted.
- Made start-time title work asynchronous and abortable; it no longer delays the agent's first token.

## [0.1.0] - 2026-11-18

### Added

- Initial release: Jev-triggered session title refresh, manual title protection, and `/session-name`.
