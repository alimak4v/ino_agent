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
  | "focus";

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
  },
};

export function uiText(language: InterfaceLanguage | string | undefined, key: TranslationKey) {
  const normalized =
    language && language in STRINGS ? (language as InterfaceLanguage) : "English";
  return STRINGS[normalized][key];
}
