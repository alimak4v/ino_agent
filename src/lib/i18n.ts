export type InterfaceLanguage = "English" | "Russian" | "Spanish" | "Belarusian";

export const INTERFACE_LANGUAGES: InterfaceLanguage[] = [
  "English",
  "Russian",
  "Spanish",
  "Belarusian",
];

export const LANGUAGE_LABELS: Record<InterfaceLanguage, string> = {
  English: "English",
  Russian: "Русский",
  Spanish: "Español",
  Belarusian: "Беларуская",
};

type TranslationKey =
  | "agentSettings"
  | "appearanceModelApi"
  | "apiConnected"
  | "noApiKey"
  | "theme"
  | "language"
  | "model"
  | "apiKey"
  | "endpoint"
  | "tools"
  | "toolsDescription"
  | "projects"
  | "tasks"
  | "terminal"
  | "memory"
  | "knowledge"
  | "connectors"
  | "connectorsDescription"
  | "loading"
  | "noConnectorDrafts"
  | "enable"
  | "disable"
  | "pending"
  | "files"
  | "cancel"
  | "save"
  | "saving"
  | "chats"
  | "search"
  | "settings"
  | "tree"
  | "focus"
  | "homeFor"
  | "askAnything"
  | "editYourPrompt"
  | "parentBranchesReadonly"
  | "selectLeafBranch"
  | "editingYourMessage"
  | "loadingFiles"
  | "attachFiles"
  | "send"
  | "removeFile"
  | "agentMode"
  | "modeAuto"
  | "modeRead"
  | "modeMemory"
  | "modeCommand"
  | "modeWorkspace"
  | "modeAutoTitle"
  | "modeReadTitle"
  | "modeMemoryTitle"
  | "modeCommandTitle"
  | "modeWorkspaceTitle"
  | "branchSplit"
  | "cancelBranchSplit"
  | "connectorDraft"
  | "cancelConnectorDraft"
  | "onboardingDescription"
  | "onboardingSetAccessTitle"
  | "onboardingSetAccessText"
  | "onboardingWorkTitle"
  | "onboardingWorkText"
  | "onboardingPrivacyTitle"
  | "onboardingPrivacyText"
  | "newChat"
  | "latestFirst"
  | "noChats"
  | "messages";

const STRINGS: Record<InterfaceLanguage, Record<TranslationKey, string>> = {
  English: {
    agentSettings: "Agent settings",
    appearanceModelApi: "Appearance, language, model and API access",
    apiConnected: "API connected",
    noApiKey: "No API key",
    theme: "Theme",
    language: "Language",
    model: "Model",
    apiKey: "API key",
    endpoint: "Endpoint",
    tools: "Tools",
    toolsDescription: "Open secondary windows from here",
    projects: "Projects",
    tasks: "Tasks",
    terminal: "Terminal",
    memory: "Memory",
    knowledge: "Knowledge",
    connectors: "Connectors",
    connectorsDescription: "Generated skills stay disabled until enabled",
    loading: "Loading",
    noConnectorDrafts: "No connector drafts yet.",
    enable: "Enable",
    disable: "Disable",
    pending: "pending",
    files: "Files",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving",
    chats: "Chats",
    search: "Search",
    settings: "Settings",
    tree: "Tree",
    focus: "Focus",
    homeFor: "for",
    askAnything: "Ask anything",
    editYourPrompt: "Edit your prompt",
    parentBranchesReadonly: "Parent branches are read-only",
    selectLeafBranch: "Select or create a leaf branch to write.",
    editingYourMessage: "Editing your message",
    loadingFiles: "Loading files",
    attachFiles: "Attach files",
    send: "Send",
    removeFile: "Remove",
    agentMode: "Agent mode",
    modeAuto: "Auto",
    modeRead: "Read",
    modeMemory: "Memory",
    modeCommand: "Cmd",
    modeWorkspace: "Work",
    modeAutoTitle: "Infer tool permissions from the request",
    modeReadTitle: "Search memory and inspect files only",
    modeMemoryTitle: "Allow memory and knowledge indexing",
    modeCommandTitle: "Allow safe local commands",
    modeWorkspaceTitle: "Allow memory/indexing and safe commands",
    branchSplit: "Split into branches after sending",
    cancelBranchSplit: "Cancel branch split after sending",
    connectorDraft: "Create connector draft",
    cancelConnectorDraft: "Cancel connector draft",
    onboardingDescription: "Local workspace for projects, agent tasks, memory, search, and visual explanations.",
    onboardingSetAccessTitle: "Set model access",
    onboardingSetAccessText: "Save endpoint, model, API key, language, and theme in Settings.",
    onboardingWorkTitle: "Create or inspect work",
    onboardingWorkText: "Use secondary windows from Settings, and keep only Chats/Search in the top bar.",
    onboardingPrivacyTitle: "Keep local data private",
    onboardingPrivacyText: "Chats, memory, command history, paths, and API keys stay in the local SQLite database.",
    newChat: "New chat",
    latestFirst: "Latest first",
    noChats: "No chats",
    messages: "messages",
  },
  Russian: {
    agentSettings: "Настройки агента",
    appearanceModelApi: "Оформление, язык, модель и доступ к API",
    apiConnected: "API подключен",
    noApiKey: "Нет API-ключа",
    theme: "Тема",
    language: "Язык",
    model: "Модель",
    apiKey: "API-ключ",
    endpoint: "Endpoint",
    tools: "Инструменты",
    toolsDescription: "Вторичные окна открываются отсюда",
    projects: "Проекты",
    tasks: "Задачи",
    terminal: "Терминал",
    memory: "Память",
    knowledge: "Знания",
    connectors: "Коннекторы",
    connectorsDescription: "Сгенерированные навыки выключены, пока вы их не включите",
    loading: "Загрузка",
    noConnectorDrafts: "Черновиков коннекторов пока нет.",
    enable: "Включить",
    disable: "Выключить",
    pending: "черновик",
    files: "Файлы",
    cancel: "Отмена",
    save: "Сохранить",
    saving: "Сохранение",
    chats: "Чаты",
    search: "Поиск",
    settings: "Настройки",
    tree: "Дерево",
    focus: "Фокус",
    homeFor: "для",
    askAnything: "Спросите что-нибудь",
    editYourPrompt: "Измените запрос",
    parentBranchesReadonly: "Родительские ветки доступны только для чтения",
    selectLeafBranch: "Выберите или создайте конечную ветку, чтобы писать.",
    editingYourMessage: "Редактирование вашего сообщения",
    loadingFiles: "Загрузка файлов",
    attachFiles: "Прикрепить файлы",
    send: "Отправить",
    removeFile: "Удалить",
    agentMode: "Режим агента",
    modeAuto: "Авто",
    modeRead: "Чтение",
    modeMemory: "Память",
    modeCommand: "Cmd",
    modeWorkspace: "Работа",
    modeAutoTitle: "Автоматически выбрать права инструментов по запросу",
    modeReadTitle: "Искать в памяти и просматривать файлы",
    modeMemoryTitle: "Разрешить память и индексацию знаний",
    modeCommandTitle: "Разрешить безопасные локальные команды",
    modeWorkspaceTitle: "Разрешить память, индексацию и безопасные команды",
    branchSplit: "Разделить на ветки после отправки",
    cancelBranchSplit: "Отменить разделение на ветки после отправки",
    connectorDraft: "Создать черновик коннектора",
    cancelConnectorDraft: "Отменить черновик коннектора",
    onboardingDescription: "Локальное рабочее пространство для проектов, задач агента, памяти, поиска и визуальных объяснений.",
    onboardingSetAccessTitle: "Настройте доступ к модели",
    onboardingSetAccessText: "Сохраните endpoint, модель, API-ключ, язык и тему в настройках.",
    onboardingWorkTitle: "Создавайте и проверяйте работу",
    onboardingWorkText: "Вторичные окна открываются из настроек, а в верхней панели остаются только чаты и поиск.",
    onboardingPrivacyTitle: "Храните данные локально",
    onboardingPrivacyText: "Чаты, память, история команд, пути и API-ключи остаются в локальной SQLite-базе.",
    newChat: "Новый чат",
    latestFirst: "Сначала новые",
    noChats: "Чатов нет",
    messages: "сообщений",
  },
  Spanish: {
    agentSettings: "Ajustes del agente",
    appearanceModelApi: "Apariencia, idioma, modelo y acceso API",
    apiConnected: "API conectada",
    noApiKey: "Sin clave API",
    theme: "Tema",
    language: "Idioma",
    model: "Modelo",
    apiKey: "Clave API",
    endpoint: "Endpoint",
    tools: "Herramientas",
    toolsDescription: "Abre ventanas secundarias desde aquí",
    projects: "Proyectos",
    tasks: "Tareas",
    terminal: "Terminal",
    memory: "Memoria",
    knowledge: "Conocimiento",
    connectors: "Conectores",
    connectorsDescription: "Las habilidades generadas quedan desactivadas hasta que las actives",
    loading: "Cargando",
    noConnectorDrafts: "Aún no hay borradores de conectores.",
    enable: "Activar",
    disable: "Desactivar",
    pending: "pendiente",
    files: "Archivos",
    cancel: "Cancelar",
    save: "Guardar",
    saving: "Guardando",
    chats: "Chats",
    search: "Buscar",
    settings: "Ajustes",
    tree: "Árbol",
    focus: "Foco",
    homeFor: "para",
    askAnything: "Pregunta lo que quieras",
    editYourPrompt: "Edita tu prompt",
    parentBranchesReadonly: "Las ramas padre son de solo lectura",
    selectLeafBranch: "Selecciona o crea una rama final para escribir.",
    editingYourMessage: "Editando tu mensaje",
    loadingFiles: "Cargando archivos",
    attachFiles: "Adjuntar archivos",
    send: "Enviar",
    removeFile: "Quitar",
    agentMode: "Modo del agente",
    modeAuto: "Auto",
    modeRead: "Leer",
    modeMemory: "Memoria",
    modeCommand: "Cmd",
    modeWorkspace: "Trabajo",
    modeAutoTitle: "Inferir permisos de herramientas según la solicitud",
    modeReadTitle: "Buscar en memoria e inspeccionar archivos",
    modeMemoryTitle: "Permitir memoria e indexación de conocimiento",
    modeCommandTitle: "Permitir comandos locales seguros",
    modeWorkspaceTitle: "Permitir memoria, indexación y comandos seguros",
    branchSplit: "Dividir en ramas después de enviar",
    cancelBranchSplit: "Cancelar división en ramas después de enviar",
    connectorDraft: "Crear borrador de conector",
    cancelConnectorDraft: "Cancelar borrador de conector",
    onboardingDescription: "Espacio local para proyectos, tareas del agente, memoria, búsqueda y explicaciones visuales.",
    onboardingSetAccessTitle: "Configura el acceso al modelo",
    onboardingSetAccessText: "Guarda endpoint, modelo, clave API, idioma y tema en Ajustes.",
    onboardingWorkTitle: "Crea o revisa trabajo",
    onboardingWorkText: "Abre ventanas secundarias desde Ajustes y deja solo Chats/Búsqueda en la barra superior.",
    onboardingPrivacyTitle: "Mantén los datos locales",
    onboardingPrivacyText: "Chats, memoria, historial de comandos, rutas y claves API quedan en la base SQLite local.",
    newChat: "Nuevo chat",
    latestFirst: "Más recientes primero",
    noChats: "Sin chats",
    messages: "mensajes",
  },
  Belarusian: {
    agentSettings: "Налады агента",
    appearanceModelApi: "Выгляд, мова, мадэль і доступ да API",
    apiConnected: "API падключаны",
    noApiKey: "Няма API-ключа",
    theme: "Тэма",
    language: "Мова",
    model: "Мадэль",
    apiKey: "API-ключ",
    endpoint: "Endpoint",
    tools: "Інструменты",
    toolsDescription: "Другасныя вокны адкрываюцца адсюль",
    projects: "Праекты",
    tasks: "Задачы",
    terminal: "Тэрмінал",
    memory: "Памяць",
    knowledge: "Веды",
    connectors: "Канектары",
    connectorsDescription: "Згенераваныя навыкі выключаны, пакуль вы іх не ўключыце",
    loading: "Загрузка",
    noConnectorDrafts: "Чарнавікоў канектараў пакуль няма.",
    enable: "Уключыць",
    disable: "Выключыць",
    pending: "чарнавік",
    files: "Файлы",
    cancel: "Адмена",
    save: "Захаваць",
    saving: "Захаванне",
    chats: "Чаты",
    search: "Пошук",
    settings: "Налады",
    tree: "Дрэва",
    focus: "Фокус",
    homeFor: "для",
    askAnything: "Спытайце што-небудзь",
    editYourPrompt: "Змяніце запыт",
    parentBranchesReadonly: "Бацькоўскія галіны толькі для чытання",
    selectLeafBranch: "Выберыце або стварыце канчатковую галіну, каб пісаць.",
    editingYourMessage: "Рэдагаванне вашага паведамлення",
    loadingFiles: "Загрузка файлаў",
    attachFiles: "Прымацаваць файлы",
    send: "Адправіць",
    removeFile: "Выдаліць",
    agentMode: "Рэжым агента",
    modeAuto: "Аўта",
    modeRead: "Чытанне",
    modeMemory: "Памяць",
    modeCommand: "Cmd",
    modeWorkspace: "Праца",
    modeAutoTitle: "Аўтаматычна выбраць правы інструментаў па запыце",
    modeReadTitle: "Шукаць у памяці і праглядаць файлы",
    modeMemoryTitle: "Дазволіць памяць і індэксацыю ведаў",
    modeCommandTitle: "Дазволіць бяспечныя лакальныя каманды",
    modeWorkspaceTitle: "Дазволіць памяць, індэксацыю і бяспечныя каманды",
    branchSplit: "Падзяліць на галіны пасля адпраўкі",
    cancelBranchSplit: "Скасаваць падзел на галіны пасля адпраўкі",
    connectorDraft: "Стварыць чарнавік канектара",
    cancelConnectorDraft: "Скасаваць чарнавік канектара",
    onboardingDescription: "Лакальная працоўная прастора для праектаў, задач агента, памяці, пошуку і візуальных тлумачэнняў.",
    onboardingSetAccessTitle: "Наладзьце доступ да мадэлі",
    onboardingSetAccessText: "Захавайце endpoint, мадэль, API-ключ, мову і тэму ў наладах.",
    onboardingWorkTitle: "Стварайце і правярайце працу",
    onboardingWorkText: "Другасныя вокны адкрываюцца з налад, а ў верхняй панэлі застаюцца толькі чаты і пошук.",
    onboardingPrivacyTitle: "Захоўвайце даныя лакальна",
    onboardingPrivacyText: "Чаты, памяць, гісторыя каманд, шляхі і API-ключы застаюцца ў лакальнай SQLite-базе.",
    newChat: "Новы чат",
    latestFirst: "Спачатку новыя",
    noChats: "Чатаў няма",
    messages: "паведамленняў",
  },
};

export function uiText(language: InterfaceLanguage | string | undefined, key: TranslationKey) {
  const normalized =
    language && language in STRINGS ? (language as InterfaceLanguage) : "English";
  return STRINGS[normalized][key];
}
