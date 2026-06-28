export type ThemeName = "Minimal Light" | "Obsidian Dark" | "Paper";

export interface ThemeTokens {
  appBg: string;
  sidebar: string;
  panel: string;
  panelSoft: string;
  text: string;
  muted: string;
  border: string;
  selected: string;
  user: string;
  assistant: string;
  accent: string;
  edge: string;
  button: string;
  buttonText: string;
  empty: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  "Minimal Light": {
    appBg: "#F6F8FB",
    sidebar: "#F0F3F8",
    panel: "#FFFFFF",
    panelSoft: "#F8FAFD",
    text: "#171A1F",
    muted: "#6B7280",
    border: "#E1E6EF",
    selected: "#EEF4FF",
    user: "#EAF2FF",
    assistant: "#FFFFFF",
    accent: "#3B63F4",
    edge: "#A6B4C8",
    button: "#171A1F",
    buttonText: "#FFFFFF",
    empty: "#9AA3AF",
  },
  "Obsidian Dark": {
    appBg: "#0B0B0D",
    sidebar: "#101114",
    panel: "#18191D",
    panelSoft: "#202126",
    text: "#F2F3F5",
    muted: "#8E939D",
    border: "#2A2C33",
    selected: "#282A31",
    user: "#1E2026",
    assistant: "#0B0B0D",
    accent: "#E9EDF8",
    edge: "#5F6674",
    button: "#F2F3F5",
    buttonText: "#111217",
    empty: "#737985",
  },
  Paper: {
    appBg: "#FAF6EC",
    sidebar: "#F0E9DC",
    panel: "#FFFDF7",
    panelSoft: "#FBF5EA",
    text: "#292119",
    muted: "#8B8176",
    border: "#DED4C3",
    selected: "#E8DDCC",
    user: "#E9EEF7",
    assistant: "#FFFDF7",
    accent: "#8B6DFF",
    edge: "#BBAE99",
    button: "#292119",
    buttonText: "#FFFFFF",
    empty: "#9C9083",
  },
};

export function applyThemeVars(theme: ThemeTokens) {
  const root = document.documentElement;
  root.style.setProperty("--app-bg", theme.appBg);
  root.style.setProperty("--sidebar", theme.sidebar);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--panel-soft", theme.panelSoft);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--muted", theme.muted);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--selected", theme.selected);
  root.style.setProperty("--user", theme.user);
  root.style.setProperty("--assistant", theme.assistant);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--edge", theme.edge);
  root.style.setProperty("--button", theme.button);
  root.style.setProperty("--button-text", theme.buttonText);
  root.style.setProperty("--empty", theme.empty);
}
