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
  codeBg: string;
  codeText: string;
  codeComment: string;
  codeString: string;
  codeKeyword: string;
  codeNumber: string;
  codePreprocessor: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  "Minimal Light": {
    appBg: "#FFFFFF",
    sidebar: "#F9F9F9",
    panel: "#FFFFFF",
    panelSoft: "#F7F7F8",
    text: "#0D0D0D",
    muted: "#8E8E8E",
    border: "rgba(0, 0, 0, 0.08)",
    selected: "rgba(0, 0, 0, 0.07)",
    user: "#F7F7F8",
    assistant: "#FFFFFF",
    accent: "#0D0D0D",
    edge: "rgba(127, 127, 127, 0.28)",
    button: "#0D0D0D",
    buttonText: "#FFFFFF",
    empty: "#8E8E8E",
    codeBg: "#F6F8FA",
    codeText: "#24292F",
    codeComment: "#6A737D",
    codeString: "#0A3069",
    codeKeyword: "#CF222E",
    codeNumber: "#0550AE",
    codePreprocessor: "#953800",
  },
  "Obsidian Dark": {
    appBg: "#212121",
    sidebar: "#171717",
    panel: "#212121",
    panelSoft: "#2F2F2F",
    text: "#ECECEC",
    muted: "#8B8B8B",
    border: "rgba(255, 255, 255, 0.08)",
    selected: "rgba(255, 255, 255, 0.10)",
    user: "#2F2F2F",
    assistant: "#212121",
    accent: "#ECECEC",
    edge: "rgba(255, 255, 255, 0.22)",
    button: "#FFFFFF",
    buttonText: "#0D0D0D",
    empty: "#8B8B8B",
    codeBg: "#161B22",
    codeText: "#C9D1D9",
    codeComment: "#8B949E",
    codeString: "#A5D6FF",
    codeKeyword: "#FF7B72",
    codeNumber: "#79C0FF",
    codePreprocessor: "#FFA657",
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
    user: "#F1E6D6",
    assistant: "#FFFDF7",
    accent: "#8B6DFF",
    edge: "#BBAE99",
    button: "#292119",
    buttonText: "#FFFFFF",
    empty: "#9C9083",
    codeBg: "#F7EFE3",
    codeText: "#292119",
    codeComment: "#8B8176",
    codeString: "#7A4E12",
    codeKeyword: "#9F3A38",
    codeNumber: "#5B5AAE",
    codePreprocessor: "#8A5A16",
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
  root.style.setProperty("--code-bg", theme.codeBg);
  root.style.setProperty("--code-text", theme.codeText);
  root.style.setProperty("--code-comment", theme.codeComment);
  root.style.setProperty("--code-string", theme.codeString);
  root.style.setProperty("--code-keyword", theme.codeKeyword);
  root.style.setProperty("--code-number", theme.codeNumber);
  root.style.setProperty("--code-preprocessor", theme.codePreprocessor);
}
