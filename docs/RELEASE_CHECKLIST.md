# Release checklist

Рабочий чеклист первого публичного релиза ino-agent. Источник scope: [RELEASE_TZ.md](./RELEASE_TZ.md).

## Правила прохождения

- Не переносить задачу в Done без проверки в приложении или тестом.
- Для каждого P0 фиксировать ссылку на PR/commit или короткую заметку в "Артефакты".
- Перед RC пройти три dogfood-сценария на чистой локальной базе.
- Любое изменение SQLite-схемы сопровождается миграцией и проверкой старой базы.
- Команды с риском удаления, перезаписи, установки зависимостей, сети, `git push` или запуском неизвестного бинарника должны идти через явное approval.

## P0 progress

| Статус | P0 | Done criteria | Артефакты |
| --- | --- | --- | --- |
| [x] | Project wizard MVP | Пользователь создает новый проект, выбирает стек, получает файлы, открывает папку, запускает build/test из UI. | `src-tauri/src/project.rs`, `src/components/ProjectWizardPanel.tsx` |
| [x] | Agent loop MVP с tasks/progress | Агент создает PRD/specs/tasks, выполняет atomic task, пишет progress и продолжает после перезапуска. | `agent_runs`, `agent_tasks`, `src/components/AgentTasksPanel.tsx` |
| [x] | Safe command runner UI MVP | Есть terminal/command panel, лимиты, история, retry, output, диагностика ошибок и approvals для опасных действий. | `src-tauri/src/terminal.rs`, `terminal_command_history`, `src/components/TerminalPanel.tsx` |
| [x] | Search page с источниками MVP | Есть query, answer, chunks, scores, target, open source, related memory. | `search_page`, `src/components/SearchPanel.tsx` |
| [x] | Memory cleanup/review MVP | Есть review queue, merge duplicates, stale cleanup, export/import и объяснение "why remembered". | `memory_review_queue`, `src/components/MemoryPanel.tsx` |
| [x] | Render screenshot QA MVP | Автотесты делают desktop/mobile screenshots для matrix/vector/chart/Mermaid/graphsteps. | `playwright.config.ts`, `tests/render-screenshot.spec.ts` |
| [x] | Stable macOS build for internal RC | Собран проверенный `.app`/`.dmg`, есть checksum, smoke-test на чистой машине или чистом профиле. | `dist/ino-agent.app`, `dist/ino-agent-mac.dmg`, clean-profile smoke with temp HOME |
| [x] | Onboarding MVP | Первый запуск объясняет базовый flow без засорения основного UI. | `src/App.tsx` |
| [x] | Release docs | README, quickstart, install docs, privacy note и release checklist актуальны. | `README.md`, `docs/QUICKSTART.md`, `docs/INSTALL.md`, `docs/PRIVACY.md` |
| [ ] | Dogfood на 3 сценариях | Пройдены сценарии: создать проект, разобрать лекцию, найти в памяти/файлах и запустить код. | |

## Project wizard

- [x] Добавить точку входа в навигации или стартовом экране.
- [x] Реализовать выбор типа проекта:
  - [x] Python CLI.
  - [x] Python notebook/research.
  - [x] C++/CMake.
  - [x] Rust.
  - [x] TypeScript/React.
  - [x] Tauri app.
  - [x] Учебный конспект.
  - [x] Research workspace.
- [x] Генерировать структуру проекта.
- [x] Создавать `README`.
- [x] Создавать `.gitignore`.
- [x] Создавать build scripts.
- [x] Создавать test folder.
- [x] Создавать starter code.
- [x] Добавить действия Create, Build, Run, Test, Open Folder, Ask Agent.
- [ ] После создания проекта предлагать следующие задачи.
- [ ] При ошибке build/test запускать repair loop.
- [ ] Проверить генерацию каждого типа проекта.

## Agent loop

- [x] Спроектировать storage для tasks/progress.
- [x] Добавить `progress.md` или внутреннюю таблицу прогресса.
- [x] Сохранять PRD/specs/atomic tasks.
- [x] Выполнять только одну atomic task за шаг.
- [x] Записывать результат выполнения.
- [x] Запускать verifier pass после tool-assisted действий.
- [x] Продолжать loop после перезапуска приложения.
- [ ] Добавить режим "сделай проект полностью".
- [x] Показывать task/progress page в UI.
- [ ] Покрыть agent loop тестами.

## Safe commands

- [x] Завершить permission profile для command runner.
- [x] Добавить terminal panel.
- [x] Ограничить timeout.
- [x] Ограничить max output.
- [x] Ограничить working directory scope.
- [x] Добавить denylist опасных команд.
- [x] Разрешить read/build/test/run без лишнего approval в допустимом scope.
- [x] Требовать approval для delete.
- [x] Требовать approval для overwrite.
- [x] Требовать approval для install.
- [x] Требовать approval для network.
- [x] Требовать approval для `git push`.
- [x] Требовать approval для запуска неизвестного бинарника.
- [x] Показывать command output в UI.
- [x] Сохранять историю команд.
- [x] Добавить repeat command.
- [x] Добавить диагностику ошибок build/test/run.
- [ ] Покрыть command runner safety тестами.

## Search

- [x] Добавить search page в навигацию.
- [x] Реализовать строку поиска.
- [x] Показывать synthesized answer.
- [x] Показывать sources.
- [x] Показывать chunks.
- [x] Показывать score breakdown.
- [x] Показывать target.
- [x] Поддержать open source.
- [x] Показывать page/offset.
- [x] Показывать related materials.
- [x] Показывать related memory.
- [ ] Улучшить PDF page-level extraction quality.
- [ ] Добавить OCR.
- [ ] Добавить DOCX/HTML/audio ingestion.
- [ ] Добавить code-aware indexing для symbols/functions/imports/tests.
- [ ] Оценить real vector DB / HNSW.
- [ ] Начать обучение retrieval weights по feedback/clicks.

## Memory

- [x] Довести feedback по памяти MVP.
- [x] Добавить review queue.
- [x] Находить stale memories.
- [x] Находить duplicate clusters.
- [x] Выносить low-confidence memories на review.
- [x] Предлагать archive/delete.
- [x] Реализовать merge duplicates.
- [x] Реализовать export memory.
- [x] Реализовать import memory.
- [ ] Реализовать backup/restore DB.
- [ ] Описать и внедрить forgetting policy.
- [ ] Добавить экран "что агент знает обо мне".
- [ ] Добавить персональные правила без засорения system prompt.

## Render screenshot QA

- [x] Выбрать Playwright или аналог.
- [x] Добавить desktop screenshot test.
- [x] Добавить mobile screenshot test.
- [x] Проверять `matrix`.
- [x] Проверять `vector`.
- [x] Проверять `chart`.
- [x] Проверять `Mermaid`.
- [x] Проверять `graphsteps`.
- [ ] Проверять отсутствие overlap на мобильной ширине.
- [ ] Зафиксировать baseline fixtures.
- [x] Подключить к release checklist.

## macOS release

- [x] Выполнить `npm run build`.
- [x] Выполнить `cargo check`.
- [x] Выполнить `npm run tauri:build` или `./build_macos.sh`.
- [x] Проверить `.app`.
- [x] Проверить `.dmg`.
- [x] Проверить checksum.
- [x] Проверить запуск на чистом профиле.
- [x] Проверить отсутствие локальной базы/API key в артефактах.
- [x] Добавить ad-hoc signing для internal RC.
- [ ] Решить Developer ID signing/notarization для публичного распространения.
- [ ] Записать точные команды сборки в release notes.

## Onboarding and docs

- [x] Добавить onboarding первого запуска.
- [ ] Добавить empty states.
- [x] Обновить README под текущий продукт.
- [x] Добавить quickstart.
- [x] Добавить install docs.
- [x] Добавить privacy note.
- [x] Добавить demo datasets.
- [x] Добавить demo scenario: создать проект.
- [x] Добавить demo scenario: разобрать лекцию.
- [x] Добавить demo scenario: найти в памяти.
- [x] Добавить demo scenario: запустить код.
- [x] Добавить demo scenario: подготовиться к экзамену.

## Финальная проверка RC

- [ ] Чистая установка.
- [ ] Первый запуск и onboarding.
- [ ] Создание проекта через wizard.
- [ ] Build/test/run проекта из UI.
- [ ] Ошибка build/test диагностируется и repair loop предлагает исправление.
- [ ] Agent loop продолжает progress после перезапуска.
- [ ] Search находит локальный источник и показывает chunks/scores.
- [ ] Memory review показывает причины сохранения.
- [ ] Render blocks проходят screenshot QA.
- [ ] macOS artifact открывается и проходит smoke-test.
- [ ] README/quickstart/privacy актуальны.
