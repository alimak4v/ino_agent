# Privacy

ino-agent is local-first. Chat trees, messages, settings, memory, knowledge metadata, watched paths,
agent task progress, command history, and feedback are stored on the user's machine in SQLite.

## Local Data

Default macOS database path:

```text
~/Library/Application Support/ino-agent/ino-agent.sqlite3
```

The database can include:

- chat content and generated assistant messages;
- model endpoint, model name, and API key from Settings;
- memory items, memory decisions, feedback, and search/index metadata;
- local file paths and watched paths;
- terminal command history and command output;
- project wizard paths and generated project metadata through chat/task traces.

Do not attach this database to public issues, demo packages, or release artifacts.

## Network Use

The app only needs network access when a feature calls a configured model endpoint or when the user
explicitly runs a command that accesses the network. Safe command UI requires approval for network-like
commands such as `curl`, `wget`, package installs, and similar operations.

## Memory and Knowledge

Memory review can show why a memory was saved, suggest cleanup, merge duplicates, delete stale entries,
and export/import memory JSON. Exported memory JSON should be treated as private user data.

## Release Rule

Before packaging, verify that release artifacts do not include:

- SQLite databases;
- `.env` files;
- API keys;
- local command logs;
- generated `test-results` or Playwright reports.
