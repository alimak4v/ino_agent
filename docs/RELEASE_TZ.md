# ТЗ до релиза ino-agent

Цель: локальный агент для студентов и разработчиков, который умеет создавать проекты с нуля, планировать работу, запускать команды, учить, искать по памяти/файлам и показывать понятные визуальные объяснения.

Статусы:

- `[сделано]` работает в MVP или уже есть.
- `[начали]` есть основа, нужно довести.
- `[не сделано]` нужно реализовать.

## 1. Базовая архитектура

- [x] `[сделано]` Маленький base prompt без засорения system prompt.
- [x] `[сделано]` Динамическая подгрузка контекста: память, knowledge, render contracts, tool traces.
- [x] `[сделано]` Отдельные модули:
  - `context_builder`
  - `retrieval_context`
  - `local_embedding`
- [ ] `[начали]` Разделение `store.rs`.
- [ ] `[не сделано]` Полное разделение на:
  - `storage/`
  - `retrieval/`
  - `indexing/`
  - `memory/`
  - `agent_loop/`
  - `project/`
- [ ] `[не сделано]` Формальный слой use cases/application services.

## 2. Агент

- [x] `[сделано]` Tool-assisted ответы.
- [x] `[сделано]` Tool trace в UI.
- [x] `[сделано]` Permission profiles:
  - Read
  - Memory
  - Cmd
  - Work
  - Auto
- [x] `[сделано]` UI-переключатель режимов агента.
- [x] `[сделано]` Verifier pass для tool-assisted ответов.
- [ ] `[начали]` Полный agent loop:
  - понять задачу;
  - составить план;
  - выполнить atomic task;
  - проверить результат;
  - обновить progress;
  - перейти дальше.
- [x] `[сделано]` Restartable loop после закрытия приложения через persisted runs/tasks.
- [x] `[сделано]` Внутренняя таблица прогресса.
- [ ] `[не сделано]` Режим "сделай проект полностью".
- [ ] `[не сделано]` Явное approval для опасных действий:
  - delete;
  - overwrite;
  - install;
  - network;
  - git push;
  - запуск неизвестного бинарника.

## 3. Создание проектов с нуля

- [x] `[сделано]` New Project wizard MVP.
- [x] `[сделано]` Выбор типа проекта:
  - Python CLI;
  - Python notebook/research;
  - C++/CMake;
  - Rust;
  - TypeScript/React;
  - Tauri app;
  - учебный конспект;
  - research workspace.
- [x] `[сделано]` Генерация структуры проекта.
- [x] `[сделано]` Автоматическое создание:
  - `README`;
  - `.gitignore`;
  - build scripts;
  - test folder;
  - starter code.
- [x] `[сделано]` Кнопки:
  - Create;
  - Build;
  - Run;
  - Test;
  - Open Folder;
  - Ask Agent.
- [ ] `[начали]` Агент должен читать проект и предлагать следующие задачи.
- [ ] `[не сделано]` Автоматический repair loop при ошибке сборки.

## 4. Команды и среда выполнения

- [x] `[сделано]` Агент может запускать ограниченные команды.
- [x] `[сделано]` Есть command trace.
- [x] `[сделано]` Permission profile для command runner.
- [x] `[сделано]` Terminal panel MVP.
- [x] `[сделано]` Лимиты:
  - timeout;
  - max output;
  - working directory scope;
  - запрещенные команды.
- [x] `[сделано]` UI approval dialog.
- [x] `[сделано]` История команд.
- [x] `[сделано]` Повтор команды.
- [x] `[сделано]` Автоматическая диагностика ошибок build/test/run MVP.

## 5. Память

- [x] `[сделано]` Общая память между чатами.
- [x] `[сделано]` Memory items:
  - title;
  - description;
  - target;
  - source type;
  - tags;
  - importance;
  - confidence;
  - stability.
- [x] `[сделано]` Автоматическое извлечение памяти.
- [x] `[сделано]` Dedup через ingest runs.
- [x] `[сделано]` Decision log: почему сохранено/пропущено.
- [x] `[сделано]` Debug graph памяти.
- [x] `[сделано]` Memory edit/delete/merge.
- [x] `[сделано]` Feedback по памяти MVP.
- [x] `[сделано]` Memory cleanup MVP:
  - stale memories;
  - duplicate clusters;
  - low-confidence review;
  - archive/delete suggestions.
- [x] `[сделано]` Export/import memory MVP.
- [ ] `[не сделано]` Backup/restore DB.
- [ ] `[не сделано]` Политика forgetting.
- [ ] `[не сделано]` Просмотр "что агент знает обо мне".
- [ ] `[не сделано]` Персональные правила без засорения system prompt.

## 6. Knowledge / RAG / Поиск

- [x] `[сделано]` Индексация локальных источников.
- [x] `[сделано]` Knowledge chunks.
- [x] `[сделано]` SQLite metadata.
- [x] `[сделано]` Локальный hashed embedding MVP.
- [x] `[сделано]` Hybrid-ish retrieval:
  - vector score;
  - keyword score;
  - feedback score;
  - recency.
- [x] `[сделано]` Lightweight rerank.
- [x] `[сделано]` Retrieval trace в ответах.
- [x] `[сделано]` Watched paths.
- [x] `[сделано]` Reindex controls.
- [ ] `[начали]` Image indexing по metadata/sidecar.
- [x] `[сделано]` Search page MVP:
  - query;
  - answer;
  - sources;
  - chunks;
  - open target;
  - page/offset;
  - related materials.
- [ ] `[не сделано]` OCR.
- [ ] `[не сделано]` PDF page-level extraction quality.
- [ ] `[не сделано]` DOCX/HTML/audio ingestion.
- [ ] `[не сделано]` Code-aware indexing:
  - symbols;
  - functions;
  - imports;
  - tests.
- [ ] `[не сделано]` Real vector DB / HNSW.
- [ ] `[не сделано]` Обучение retrieval weights по feedback/clicks.

## 7. Обучение

- [x] `[сделано]` Markdown/math rendering.
- [x] `[сделано]` Quiz block MVP.
- [x] `[сделано]` Render blocks:
  - matrix;
  - vector;
  - chart;
  - table;
  - proof;
  - source_list;
  - step_example.
- [x] `[сделано]` Mermaid/graphsteps.
- [ ] `[начали]` Красивое отображение примеров.
- [ ] `[не сделано]` Timeline render block.
- [ ] `[не сделано]` Coordinate/plot render block.
- [ ] `[не сделано]` Small simulation block.
- [ ] `[не сделано]` Учебный профиль студента:
  - уровень;
  - слабые темы;
  - повторение;
  - история ошибок.
- [ ] `[не сделано]` Spaced repetition.
- [ ] `[не сделано]` Генерация задач по уровню.
- [ ] `[не сделано]` Проверка решений студента.
- [ ] `[не сделано]` Карта курса/тем.
- [ ] `[не сделано]` Режим "подготовь к экзамену".

## 8. UI / UX

- [x] `[сделано]` Tree chat UI.
- [x] `[сделано]` Memory panel.
- [x] `[сделано]` Knowledge panel.
- [x] `[сделано]` Agent tool trace.
- [x] `[сделано]` Context/retrieval trace.
- [x] `[сделано]` Render smoke fixture.
- [ ] `[начали]` Debug views.
- [ ] `[не сделано]` Project dashboard.
- [ ] `[не сделано]` Search page.
- [ ] `[не сделано]` Task/progress page.
- [ ] `[не сделано]` Terminal panel.
- [x] `[сделано]` Onboarding MVP.
- [ ] `[не сделано]` Empty states.
- [ ] `[не сделано]` Settings для memory/RAG/tools.
- [ ] `[не сделано]` Command approvals UI.
- [ ] `[не сделано]` Release-ready navigation.

## 9. QA

- [x] `[сделано]` `cargo check`.
- [x] `[сделано]` `npx tsc --noEmit`.
- [x] `[сделано]` `npm run build`.
- [x] `[сделано]` `npm run dev:render-smoke`.
- [ ] `[начали]` Manual render QA doc.
- [ ] `[не сделано]` Screenshot tests:
  - desktop;
  - mobile;
  - render blocks;
  - Mermaid;
  - graphsteps.
- [ ] `[не сделано]` DB migration tests.
- [ ] `[не сделано]` Agent loop tests.
- [ ] `[не сделано]` Command runner safety tests.
- [ ] `[не сделано]` Indexing benchmark:
  - 100 files;
  - 1k files;
  - 10k files.
- [ ] `[не сделано]` Memory quality tests.
- [ ] `[не сделано]` Crash recovery tests.

## 10. Release

- [x] `[начали]` Tauri app exists.
- [x] `[сделано]` Release checklist.
- [ ] `[не сделано]` Signed macOS build.
- [ ] `[не сделано]` Windows build.
- [ ] `[не сделано]` Linux build.
- [ ] `[не сделано]` Auto-update.
- [x] `[сделано]` Install docs.
- [x] `[сделано]` Privacy docs.
- [ ] `[не сделано]` Demo datasets.
- [x] `[сделано]` Demo сценарии documented:
  - создать проект;
  - разобрать лекцию;
  - найти в памяти;
  - запустить код;
  - подготовиться к экзамену.

## Release MVP Scope

До первого публичного релиза нужно закрыть:

- [x] `[P0]` Project wizard MVP.
- [x] `[P0]` Agent loop MVP с tasks/progress.
- [x] `[P0]` Safe command runner UI MVP.
- [x] `[P0]` Search page с источниками MVP.
- [x] `[P0]` Memory cleanup/review MVP.
- [x] `[P0]` Render screenshot QA MVP.
- [x] `[P0]` Stable macOS build for internal RC.
- [x] `[P0]` Onboarding MVP.
- [x] `[P0]` Release docs.
- [ ] `[P0]` Dogfood на 3 сценариях.

## P0 детально

### 1. Project wizard

- [x] Создать проект.
- [x] Выбрать стек.
- [x] Сгенерировать файлы.
- [x] Открыть проект.
- [x] Запустить build/test.

### 2. Agent loop

- [x] Создать PRD.
- [x] Разбить на specs.
- [x] Разбить на atomic tasks.
- [x] Выполнять по одной.
- [x] Писать progress.
- [x] Продолжать после перезапуска.

### 3. Safe commands

- [x] Команды read/build/test/run без лишнего approval.
- [x] Опасные команды только через approval.
- [x] Вывод команды в UI.
- [x] Диагностика ошибок.

### 4. Search

- [x] Строка поиска.
- [x] Answer.
- [x] Найденные chunks.
- [x] Score.
- [x] Target.
- [x] Open source.
- [x] Related memory.

### 5. Memory

- [x] Review queue.
- [x] Merge duplicates.
- [x] Delete stale.
- [x] Export/import.
- [x] "Why remembered".

### 6. Render QA

- [x] Playwright или аналог.
- [x] Desktop screenshot.
- [x] Mobile screenshot.
- [x] Matrix/vector/chart/Mermaid/graphsteps.

### 7. Release

- [x] `RELEASE_CHECKLIST.md`.
- [x] macOS artifact for internal RC.
- [x] Clean `README`.
- [x] Privacy note.
- [x] Quickstart.

## Следующий практический порядок

- [x] Создать `docs/RELEASE_TZ.md` с этим ТЗ.
- [x] Создать `docs/RELEASE_CHECKLIST.md`.
- [x] Реализовать Project wizard MVP.
- [x] Реализовать Agent Loop MVP.
- [x] Реализовать progress/tasks storage.
- [x] Довести command runner UI MVP.
- [x] Сделать Search page MVP.
- [x] Сделать memory review/cleanup MVP.
- [x] Добавить screenshot QA MVP.
- [ ] Собрать первый release candidate.
