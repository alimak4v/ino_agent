# ino-agent

ino-agent (Intelligent neural operator - agent) - локальное desktop-приложение для диалогов с AI, где разговоры живут не одной длинной лентой, а деревом. Можно вести несколько направлений мысли параллельно, создавать ветки от выбранного узла, возвращаться к развилкам и не терять контекст.

Приложение собрано на Tauri: интерфейс написан на React/Vite, локальная часть - на Rust. История, настройки и дерево сохраняются в SQLite на компьютере пользователя.

## Для чего это

Обычный чат быстро превращается в длинный туннель: один вопрос цепляется за следующий, альтернативные идеи теряются, а откат к старой мысли ломает контекст. ino-agent решает это через визуальное дерево:

- каждый корень - отдельная тема или проект;
- каждый узел - точка разговора;
- дочерние узлы - отдельные ветки рассуждения;
- писать можно в листовых узлах, а старые развилки остаются как стабильные точки навигации;
- AI может сам предложить или создать ветки, если запрос явно просит разложить тему на направления.

## Что умеет сейчас

- Создание нескольких деревьев и корневых тем.
- Создание, переименование и удаление веток.
- Визуальный canvas дерева.
- Чат по выбранной листовой ветке.
- Потоковая генерация ответа ассистента.
- Настройки модели, endpoint и API key внутри приложения.
- Drag-and-drop или выбор вложений для сообщения.
- Извлечение текста из PDF на стороне Tauri.
- Markdown, GFM, математические формулы через KaTeX.
- macOS tray/menu bar: показать приложение, создать новое дерево, выйти.
- `Cmd+N` для создания нового дерева.

## Стек

- Frontend: React 18, TypeScript, Vite, Tailwind CSS.
- Desktop shell: Tauri 2.
- Backend: Rust.
- Storage: SQLite через `rusqlite`.
- Graph UI: `@xyflow/react`.
- Markdown: `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`.
- PDF text extraction: `pdf-extract`.

## Быстрый запуск

Нужны Node.js 20+, Rust и Xcode Command Line Tools на macOS.

```bash
npm install
npm run tauri:dev
```

Для frontend-only проверки:

```bash
npm run dev
```

Часть действий доступна только в desktop-окне Tauri, потому что команды идут через `invoke`.

## Сборка

Обычная Tauri-сборка:

```bash
npm run tauri:build
```

macOS-сборка с `.app`, `.dmg` и checksum:

```bash
./build_macos.sh
```

Подробности лежат в `README_BUILD_MACOS.md`.

## Данные

Локальная база:

```text
~/Library/Application Support/ino-agent/ino-agent.sqlite3
```

В базе хранятся деревья, узлы, сообщения и настройки API. API key тоже сохраняется локально в SQLite settings table, поэтому базу нельзя публиковать или прикладывать к issue/релизам.

## Архитектура

- `src/App.tsx` - главный экран, загрузка дерева, выбор узлов, настройки, ресайз панелей и orchestration UI.
- `src/components/TreeCanvas.tsx` - визуальное дерево и действия над узлами.
- `src/components/ChatPanel.tsx` - чат, composer, вложения, PDF/text extraction flow.
- `src/components/MarkdownMessage.tsx` - отображение markdown/math.
- `src/lib/api.ts` - typed frontend wrapper над Tauri commands.
- `src/lib/theme.ts` - CSS-переменные темы.
- `src-tauri/src/lib.rs` - Tauri commands, генерация ответов, branching logic, события streaming.
- `src-tauri/src/api.rs` - запросы к OpenAI-compatible chat completions endpoint через `curl`, streaming parser и JSON parsing для branch planner.
- `src-tauri/src/store.rs` - SQLite schema, миграции, CRUD деревьев/узлов/сообщений, layout и настройки.
- `legacy/` - старый PySide6-код для справки.

## Как думать о разработке

Проект local-first: сначала пользовательские данные и стабильность локального состояния, потом внешние интеграции. Важные ограничения:

- не ломать существующую SQLite-схему без миграции;
- не коммитить локальные базы, `.env`, `.app`, `.dmg` и артефакты сборки;
- не считать web-preview полноценным режимом: реальные операции завязаны на Tauri;
- родительские ветки read-only, новые сообщения должны идти в leaf node;
- при изменениях UI проверять, что дерево, чат и composer не перекрывают друг друга на узких и широких окнах.

## Журнал изменений Codex

Этот раздел нужен буквально для будущего Codex: каждый раз, когда я меняю проект, я должен дописывать сюда короткую запись с датой, сутью изменения и файлами. Не надо превращать это в release notes; это рабочая память по репозиторию.

### 2026-07-12

- Исправлен fallback для пошаговых Mermaid-визуализаций: JSON-массивы с `step`, `description` и `graph` теперь рендерятся через `GraphSteps` даже если модель ошибочно пометила блок как `json` или оставила fence без языка; prompt дополнительно запрещает использовать `json` fence для step-by-step визуализаций.
- Измененные файлы: `src/components/MarkdownMessage.tsx`, `src/components/MermaidGraph.tsx`, `src-tauri/src/store.rs`, `README.md`.

- Уточнено поведение ассистента для широких запросов: просьбы вроде “расширь каждую/все” теперь явно сохраняют полный scope вместо выбора одного примера, а принудительный `graphsteps` prompt включается только при явной просьбе о визуализации/пошаговой схеме.
- Измененные файлы: `src-tauri/src/store.rs`, `README.md`.

### 2026-07-06

- Добавлен MVP self-written connectors: модель может сгенерировать локальный connector-пакет с `manifest.json`, `README.md` и исходниками в app data `connectors/_generated`, Settings показывает pending/enabled коннекторы и разрешает включать/выключать их вручную. Добавлено точечное AI-редактирование сохраненных assistant-сообщений через `Revise`, чтобы менять код/текст в предыдущем ответе без переписывания всей ветки.
- Измененные файлы: `src-tauri/src/connectors.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/store.rs`, `src/lib/api.ts`, `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

- В оконном macOS-режиме native traffic light buttons заметнее опущены через `trafficLightPosition`, чтобы системные кнопки, `Focus`, заголовок и `Settings` сидели на одной визуальной высоте без CSS-смещения всей панели.
- Измененные файлы: `src-tauri/tauri.conf.json`, `README.md`.

- Исправлен неудачный grid-вариант верхней toolbar: controls снова живут в естественных left/right titlebar-зонах, заголовок центрируется отдельно, model badge больше не переносится в несколько строк, а технический `branch point` убран из subtitle.
- Измененные файлы: `src/App.tsx`, `README.md`.

- Обновлен app/Dock icon: вместо темной мутной версии добавлена светлая macOS-плитка с крупным tree/AI-знаком, пересобраны PNG sizes и `.icns`, а `scripts/make_icon.py` теперь генерирует новый вариант процедурно.
- Измененные файлы: `assets/app-icon.svg`, `assets/icon.png`, `assets/app.icns`, `src-tauri/icons/32x32.png`, `src-tauri/icons/128x128.png`, `src-tauri/icons/128x128@2x.png`, `src-tauri/icons/icon.png`, `src-tauri/icons/icon.icns`, `scripts/make_icon.py`, `README.md`.

- Убран дублирующий header внутри чат-панели: название выбранной ветки и дерево теперь показываются в верхней toolbar вместо статичного `ino-agent`, освобождая вертикальное место под сообщения.
- Измененные файлы: `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

### 2026-07-05

- Исправлены найденные ревью-проблемы без изменения пользовательских сценариев: stale `getMessages` больше не перезаписывает чат выбранной ветки, storage проверяет принадлежность node к tree, редактирование удаляет последующие сообщения через SQLite `rowid`, создание AI-веток стало транзакционным, Mermaid обновлен до безопасной версии и грузится lazy, `TreeCanvas`/`ChatPanel` вынесены в lazy chunks, а Tauri получил строгий CSP вместо `null`.
- Измененные файлы: `src/App.tsx`, `src/components/MermaidGraph.tsx`, `src-tauri/src/store.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `package.json`, `package-lock.json`, `README.md`.

- Верхняя toolbar стала учитывать fullscreen: когда macOS traffic light buttons скрыты, блок `Focus` + модель уезжает к левому краю; вертикальное смещение кнопок смягчено, чтобы они не выглядели приклеенными к верхней границе.
- Измененный файл: `src/App.tsx`.

- Добавлено редактирование пользовательских сообщений в текущем leaf: user bubble получает кнопку `Edit`, текст возвращается в composer, сохранение перезаписывает сообщение, удаляет последующие сообщения в этой же node и заново запускает генерацию ответа.
- Измененные файлы: `src-tauri/src/store.rs`, `src-tauri/src/lib.rs`, `src/lib/api.ts`, `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

- Исправлен confirm flow для AI-ветвления: утвердительные ответы теперь распознаются по смыслу (`Да, давай!`, `го`, `раздели на ветки` и т.п.), нераспознанный ответ больше не стирает ожидающий branch plan, а под предложением ассистента появляется кнопка с галочкой `Поделить на ветки`, которая напрямую запускает создание веток. Для вложенных файлов добавлен deterministic fallback: разделы ищутся прямо в извлеченном `text` payload, поэтому PDF/программа экзамена снова сначала спрашивает разрешение на разбиение.
- Измененные файлы: `src-tauri/src/lib.rs`, `src/lib/api.ts`, `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

- Уточнено ветвление программ/файлов: planner теперь должен предлагать крупные top-level блоки, а не первые мелкие темы подряд. Fallback больше не заменяет модельный план более длинным списком и умеет укрупнять алгоритмические темы в блоки вроде динамики, графов, потоков, деревьев и математики.
- Измененные файлы: `src-tauri/src/lib.rs`, `README.md`.

- Расширен общий branch opportunity detector: теперь не только PDF, а любой достаточно содержательный запрос, список, план, проект, исследование или многоаспектная тема сначала проходит через classifier, который решает, выгоднее ли предложить отдельные ветки. Короткие одиночные вопросы остаются обычным чатом.
- Измененные файлы: `src-tauri/src/lib.rs`, `README.md`.

- Исправлена короткая явная команда ветвления: фразы вроде `раздели на темы` больше не отсекаются проверкой длины и после успешного branch plan создают ветки сразу, вместо обычного текстового списка в чат.
- Измененные файлы: `src-tauri/src/lib.rs`, `README.md`.

- Добавлена принудительная кнопка split внизу composer справа от `+`: она вызывает отдельную backend-команду `force_branch_split`, строит крупные ветки по текущему контексту или по введенному/прикрепленному материалу и сразу создает child branches.
- Измененные файлы: `src-tauri/src/lib.rs`, `src/lib/api.ts`, `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

- Кнопка split в composer переведена в toggle-режим: нажатие больше не отправляет промпт сразу, а помечает следующий обычный send как “после отправки поделить на ветки”.
- Измененные файлы: `src/components/ChatPanel.tsx`, `README.md`.

- Зафиксированы размеры graphsteps-плеера: карточка, header, описание и область Mermaid-графа больше не схлопываются по размеру текущего шага, поэтому при переключении `Назад/Вперед` поле не прыгает.
- Измененные файлы: `src/components/MermaidGraph.tsx`, `README.md`.

- Добавлена нормализация Mermaid-синтаксиса перед рендером graphsteps: частая ошибка модели `A --|10/10|> B` автоматически приводится к валидному `A -->|10/10| B`, а prompt дополнительно запрещает неверную форму стрелки.
- Измененные файлы: `src/components/MermaidGraph.tsx`, `src-tauri/src/store.rs`, `README.md`.

- Mermaid-нормализация расширена на обратные flowchart-рёбра: простые строки `A <-- B` разворачиваются в валидное `B --> A`, а prompt теперь просит модель писать обратные рёбра именно так.
- Измененные файлы: `src/components/MermaidGraph.tsx`, `src-tauri/src/store.rs`, `README.md`.

- Расширена Mermaid-стратегия ассистента: system prompt теперь просит выбирать тип диаграммы по смыслу (`flowchart`, `sequenceDiagram`, `stateDiagram`, `classDiagram`, `erDiagram`, `gitGraph`, `pie`, `xychart`, `timeline`, `gantt`, `mindmap`, `journey`, `quadrantChart`, `sankey`), а `graphsteps` допускает разные Mermaid-типы для пошаговых объяснений, не только flowchart.
- Измененные файлы: `src-tauri/src/store.rs`, `README.md`.

- Исправлена topic contamination в `graphsteps`: из prompt удалены частные примеры алгоритмов и hardcoded guards. Теперь step-visualization prompt получает текущий leaf, полный breadcrumb и latest user request, требует самостоятельно вывести точную тему из контекста и запрещает рисовать соседний/примерный алгоритм; если деталей не хватает, должен задать уточнение.
- Измененные файлы: `src-tauri/src/store.rs`, `README.md`.

- Усилен graphsteps-сценарий: для Диница/max-flow/потоков/пошаговых графов перед последним запросом теперь добавляется отдельный system prompt, который запрещает одиночный стартовый граф и требует минимум 5 шагов с Mermaid-стрелками, flow/capacity labels и подсветкой изменений. Кнопки плеера переименованы в `← Назад` и `Вперед →`.
- Измененные файлы: `src-tauri/src/store.rs`, `src/components/MermaidGraph.tsx`, `README.md`.

- Добавлена управляемая поддержка графов в ответах ассистента без HTML-вставок: fenced `mermaid` блоки рендерятся как SVG, а fenced `graphsteps` блок с JSON-массивом шагов получает встроенный Prev/Next-плеер для алгоритмов вроде Диница/max-flow. Системный промпт теперь просит использовать именно эти форматы для графов и пошаговых алгоритмов.
- Измененные файлы: `package.json`, `package-lock.json`, `src/components/MarkdownMessage.tsx`, `src/components/MermaidGraph.tsx`, `src/types/mermaid.d.ts`, `src-tauri/src/store.rs`, `README.md`.

- Убрана белая внешняя подложка у app icon ассетов без удаления белых деталей внутри логотипа: PNG очищаются flood-fill'ом только от краев, затем Tauri generator пересобирает PNG sizes и `.icns`. После очистки знак центрируется в canvas с размером 860/1024, чтобы Dock-иконка не выглядела крупнее соседних приложений. Скрипт `scripts/make_icon.py` теперь повторяет этот безопасный сценарий и чистит лишние platform icons после генерации.
- Измененные файлы: `assets/icon.png`, `assets/app.icns`, `src-tauri/icons/32x32.png`, `src-tauri/icons/128x128.png`, `src-tauri/icons/128x128@2x.png`, `src-tauri/icons/icon.png`, `src-tauri/icons/icon.icns`, `scripts/make_icon.py`, `README.md`.

- Сдвинут левый блок toolbar ближе к macOS traffic light buttons: отступ Focus-кнопки уменьшен, чтобы верх снова выглядел собранно.
- Полностью отключена концепция HTML-вставок: удалены frontend listeners/iframe-renderer, backend spawn для inline visualization, HTML generator/sanitizer в API-модуле и подсказка в системном промпте про отдельный interactive render. Поле `visualization_html` оставлено только как совместимость со старой SQLite-схемой.
- Измененные файлы: `src/App.tsx`, `src/components/ChatPanel.tsx`, `src/lib/api.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/api.rs`, `src-tauri/src/store.rs`, `README.md`.

- Усилен leaf-context для коротких запросов: перед последним пользовательским сообщением теперь вставляется immediate system context, а запросы вроде "Опиши эту тему" переписываются с явным `Current selected leaf/topic` и `Full selected path`, чтобы модель не возвращалась к корневому файлу.
- Измененный файл: `src-tauri/src/store.rs`.

- В AI-контекст добавлен явный breadcrumb текущего листа: модель теперь получает путь вроде `алгосы -> Потоки -> Алгоритм Диница` и должна понимать фразы "эта тема", "опиши тему", "здесь" как ссылку на выбранный leaf.
- Измененный файл: `src-tauri/src/store.rs`.

- Исправлен streaming UX: Tauri event listeners теперь корректно снимаются в React StrictMode, чтобы deltas не дублировались; незавершенный streaming-текст отображается plain text без markdown/math-парсинга до окончания ответа.
- Измененные файлы: `src/App.tsx`, `src/components/ChatPanel.tsx`, `src-tauri/src/lib.rs`, `src-tauri/src/store.rs`.

- Подправлена верхняя toolbar-панель под macOS overlay titlebar: контент поднят и левый блок получил отступ под traffic light buttons.
- Улучшен branch planner: лимит поднят до 8 веток, вопрос стал короче и ближе к confirm-first формату из темного референса, а для явно структурированных файлов добавлен fallback по заголовкам/разделам, чтобы не схлопывать четкие темы в 3 ветки.
- Измененные файлы: `src/App.tsx`, `src-tauri/src/lib.rs`.

- Восстановлен confirm-first сценарий AI-ветвления: branchable запрос теперь сначала сохраняет план и спрашивает, создавать ли ветки; фактическое создание происходит после утвердительного ответа пользователя.
- Измененный файл: `src-tauri/src/lib.rs`.

- Исправлен UX-регресс ветвления после минималистичного layout: если backend создал ветки, frontend теперь принудительно раскрывает дерево, выбирает первую новую ветку и перезагружает чат для нее.
- Измененный файл: `src/App.tsx`.

- Убрана постоянная левая панель workspace/sidebar: навигация больше не занимает отдельную колонку, основа интерфейса теперь только дерево + чат.
- Перестроен layout под минималистичный ChatGPT-like интерфейс: на desktop дерево и чат делят экран, на узких окнах дерево становится верхней областью, чат занимает всю ширину ниже.
- Исправлена ширина панели настроек на узких окнах и добавлен `aria-label` для icon-only кнопки настроек.
- Измененные файлы: `src/App.tsx`, `src/components/ChatPanel.tsx`, `README.md`.

- Добавлен корневой `README.md` с описанием проекта для людей, запуском, сборкой, архитектурой, хранением данных и правилами разработки.
- Зафиксировано правило вести этот журнал дальше при следующих изменениях.
- Измененный файл: `README.md`.
