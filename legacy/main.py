from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import time
import traceback
import uuid
from urllib.parse import quote_plus, unquote
from typing import Any, Dict, List, Optional, Tuple

import requests
from PySide6.QtCore import Qt, QRectF, QPointF, QPoint, QSize, Signal, QThread, QTimer, QEvent
from PySide6.QtGui import QColor, QCursor, QFont, QPainter, QPainterPath, QPen, QBrush, QPixmap, QWheelEvent, QIcon, QAction, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QDialog,
    QFrame,
    QGraphicsDropShadowEffect,
    QGraphicsItem,
    QGraphicsScene,
    QGraphicsView,
    QHBoxLayout,
    QLabel,
    QInputDialog,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStyle,
    QVBoxLayout,
    QWidget,
    QMenu,
    QSystemTrayIcon,
    QToolBar,
)

try:
    import keyring  # type: ignore
except Exception:
    keyring = None

try:
    from PySide6.QtWebEngineWidgets import QWebEngineView  # type: ignore
except Exception:
    QWebEngineView = None  # type: ignore


APP_NAME = "treeAI"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
ICON_PATH = os.path.join(ASSETS_DIR, "icon.png") if os.path.exists(os.path.join(ASSETS_DIR, "icon.png")) else os.path.join(ASSETS_DIR, "logo.png")
DB_PATH = os.path.join(BASE_DIR, "treeai.sqlite3")


THEMES: Dict[str, Dict[str, str]] = {
    "Minimal Light": {
        "app_bg": "#F7F8FA",
        "sidebar": "#F1F3F5",
        "panel": "#FFFFFF",
        "panel_soft": "#FAFBFC",
        "text": "#171A1F",
        "muted": "#6B7280",
        "border": "#DDE1E7",
        "selected": "#E7ECF3",
        "user": "#EAF2FF",
        "assistant": "#FFFFFF",
        "accent": "#2563EB",
        "button": "#171A1F",
        "button_text": "#FFFFFF",
        "empty": "#9AA3AF",
    },
    "Obsidian Dark": {
        "app_bg": "#151518",
        "sidebar": "#17171B",
        "panel": "#202025",
        "panel_soft": "#1B1B20",
        "text": "#F4F4F5",
        "muted": "#A2A2AA",
        "border": "#34343A",
        "selected": "#2B2B32",
        "user": "#273451",
        "assistant": "#202025",
        "accent": "#8D7DFF",
        "button": "#F4F4F5",
        "button_text": "#111111",
        "empty": "#767680",
    },
    "Paper": {
        "app_bg": "#FAF6EC",
        "sidebar": "#F0E9DC",
        "panel": "#FFFDF7",
        "panel_soft": "#FBF5EA",
        "text": "#292119",
        "muted": "#8B8176",
        "border": "#DED4C3",
        "selected": "#E8DDCC",
        "user": "#E9EEF7",
        "assistant": "#FFFDF7",
        "accent": "#8B6DFF",
        "button": "#292119",
        "button_text": "#FFFFFF",
        "empty": "#9C9083",
    },
}


def configure_native_window(window, title: str = "") -> None:
    window.setWindowTitle(title)
    if sys.platform != "darwin":
        return
    if isinstance(window, QMainWindow) and not getattr(window, "_native_toolbar_configured", False):
        toolbar = QToolBar(window)
        toolbar.setObjectName("NativeTitleSpacer")
        toolbar.setMovable(False)
        toolbar.setFloatable(False)
        window.addToolBar(toolbar)
        window.setUnifiedTitleAndToolBarOnMac(True)
        window._native_toolbar_configured = True


def apply_theme(app: QApplication, theme: Dict[str, str]) -> None:
    app.setStyleSheet(
        f"""
        QMainWindow, QWidget {{
            background: {theme['app_bg']};
            color: {theme['text']};
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
        }}

        QMainWindow#AppWindow, QWidget#WindowRoot {{
            background: {theme['app_bg']};
        }}

        QFrame#WindowShell {{
            background: {theme['app_bg']};
            border: none;
        }}

        QFrame#Sidebar {{
            background: {theme['sidebar']};
            border-right: 1px solid {theme['border']};
        }}

        QFrame#MainPanel {{
            background: {theme['app_bg']};
        }}

        QToolBar#NativeTitleSpacer {{
            background: transparent;
            border: none;
            spacing: 0;
            padding: 0;
            margin: 0;
        }}

        QDialog#SettingsDialog, QDialog#AppMessageDialog {{
            background: {theme['panel']};
        }}

        QLabel#SidebarTitle {{
            font-size: 18px;
            font-weight: 700;
            background: transparent;
        }}

        QLabel#Muted {{
            color: {theme['muted']};
            background: transparent;
        }}

        QLabel#Empty {{
            color: {theme['empty']};
            background: transparent;
        }}

        QListWidget {{
            border: none;
            background: transparent;
            outline: none;
        }}

        QListWidget::item {{
            border-radius: 18px;
            padding: 10px 12px;
            margin: 2px 0;
        }}

        QListWidget::item:hover {{
            background: {theme['panel_soft']};
        }}

        QListWidget::item:selected {{
            background: {theme['selected']};
        }}

        QLineEdit, QTextEdit {{
            background: {theme['panel']};
            color: {theme['text']};
            border: 1px solid {theme['border']};
            border-radius: 22px;
            padding: 10px 12px;
            selection-background-color: {theme['accent']};
        }}

        QFrame#Composer {{
            background: {theme['panel']};
            border: 1px solid {theme['border']};
            border-radius: 26px;
        }}

        QLineEdit#ComposerInput {{
            background: transparent;
            border: none;
            border-radius: 22px;
            padding: 0 8px 0 16px;
            selection-background-color: {theme['accent']};
        }}

        QPushButton#ComposerToolButton {{
            min-width: 72px;
            padding: 0 12px;
        }}

        QPushButton {{
            background: {theme['panel']};
            color: {theme['text']};
            border: 1px solid {theme['border']};
            border-radius: 18px;
            min-height: 34px;
            padding: 0 16px;
        }}

        QPushButton:hover {{
            background: {theme['selected']};
        }}

        QPushButton:checked {{
            background: {theme['accent']};
            color: white;
            border-color: {theme['accent']};
        }}

        QPushButton#Primary {{
            background: {theme['button']};
            color: {theme['button_text']};
            border: 1px solid {theme['border']};
        }}

        QPushButton#Accent {{
            background: {theme['accent']};
            color: white;
            border: none;
        }}

        QPushButton#IconButton {{
            background: transparent;
            border: 1px solid transparent;
            min-width: 38px;
            max-width: 38px;
            min-height: 38px;
            max-height: 38px;
            padding: 0;
        }}

        QPushButton#IconButton:hover {{
            background: {theme['selected']};
            border-color: {theme['border']};
        }}

        QPushButton#AccentIcon {{
            background: {theme['accent']};
            color: white;
            border: none;
            border-radius: 20px;
            min-width: 40px;
            max-width: 40px;
            min-height: 40px;
            max-height: 40px;
            padding: 0;
        }}

        QComboBox {{
            background: {theme['panel']};
            color: {theme['text']};
            border: 1px solid {theme['border']};
            border-radius: 20px;
            min-height: 40px;
            padding: 0 42px 0 14px;
        }}

        QComboBox:hover {{
            background: {theme['panel_soft']};
        }}

        QComboBox::drop-down {{
            border: none;
            width: 36px;
            subcontrol-origin: padding;
            subcontrol-position: top right;
            border-top-right-radius: 20px;
            border-bottom-right-radius: 20px;
        }}

        QComboBox::down-arrow {{
            image: none;
            width: 0;
            height: 0;
        }}

        QComboBox QAbstractItemView {{
            background: {theme['panel']};
            color: {theme['text']};
            border: 1px solid {theme['border']};
            border-radius: 18px;
            padding: 6px;
            outline: none;
            selection-background-color: {theme['selected']};
            selection-color: {theme['text']};
        }}

        QScrollArea {{
            background: transparent;
            border: none;
        }}

        QScrollBar:vertical {{
            background: transparent;
            width: 10px;
            margin: 8px 2px 8px 2px;
        }}

        QScrollBar::handle:vertical {{
            background: {theme['muted']};
            border-radius: 5px;
            min-height: 32px;
        }}

        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
            height: 0;
            background: transparent;
        }}

        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
            background: transparent;
        }}
        """
    )


def black_circle_cursor(size: int = 16, scale: int = 4) -> QCursor:
    pixel_size = size * scale
    pixmap = QPixmap(pixel_size, pixel_size)
    pixmap.setDevicePixelRatio(scale)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QBrush(QColor("#111111")))
    margin = 2.0
    painter.drawEllipse(QRectF(margin, margin, size - margin * 2, size - margin * 2))
    painter.end()
    return QCursor(pixmap, size // 2, size // 2)



def _inline_markup_to_html(text: str, theme: Dict[str, str]) -> str:
    r"""Small, dependency-free Markdown + LaTeX-ish renderer for chat bubbles.

    It intentionally stays local and lightweight:
    - Markdown: headings, bullets, code fences, inline code, bold/italic, links.
    - LaTeX: $...$, $$...$$, \(...\), \[...\] are rendered as styled formula blocks/spans.

    This is not a full TeX engine. It displays formulas cleanly without requiring MathJax,
    a browser engine, or a server.
    """
    placeholders: Dict[str, str] = {}

    def stash(html_fragment: str) -> str:
        key = f"@@TREECHAT_BLOCK_{len(placeholders)}@@"
        placeholders[key] = html_fragment
        return key

    def code_block(match: re.Match) -> str:
        lang = html.escape((match.group(1) or "").strip())
        code = html.escape(match.group(2).rstrip())
        label = f"<div style='opacity:.65; font-size:11px; margin-bottom:6px;'>{lang}</div>" if lang else ""
        return stash(
            "<div style='margin:8px 0; padding:12px; border-radius:14px; "
            f"border:1px solid {theme['border']}; background:{theme['panel_soft']};'>"
            f"{label}<pre style='margin:0; white-space:pre-wrap; font-family:Menlo, Monaco, Consolas, monospace; font-size:12px;'>"
            f"{code}</pre></div>"
        )

    def display_math(match: re.Match) -> str:
        body = html.escape((match.group(1) or match.group(2) or "").strip())
        return stash(
            "<div style='margin:8px 0; padding:10px 12px; border-radius:14px; "
            f"border:1px solid {theme['border']}; background:{theme['panel_soft']}; "
            "font-family:Menlo, Monaco, Consolas, monospace; font-size:14px;'>"
            f"{body}</div>"
        )

    text = re.sub(r"```([\w.+-]*)\n([\s\S]*?)```", code_block, text)
    text = re.sub(r"\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]", display_math, text)

    escaped = html.escape(text)

    # Inline code first, then links/bold/italic, then inline LaTeX.
    escaped = re.sub(
        r"`([^`]+)`",
        lambda m: f"<code style='font-family:Menlo, Monaco, Consolas, monospace; padding:2px 5px; border-radius:6px; background:{theme['panel_soft']}; border:1px solid {theme['border']};'>{m.group(1)}</code>",
        escaped,
    )
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r"<a href='\2' style='color:%s;'>\1</a>" % theme["accent"],
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = re.sub(
        r"\\\((.+?)\\\)|\$([^$\n]+?)\$",
        lambda m: (
            f"<span style='font-family:Menlo, Monaco, Consolas, monospace; padding:1px 5px; "
            f"border-radius:6px; background:{theme['panel_soft']}; border:1px solid {theme['border']};'>"
            f"{m.group(1) or m.group(2)}</span>"
        ),
        escaped,
    )

    html_lines: List[str] = []
    in_ul = False
    for raw_line in escaped.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            html_lines.append("<br>")
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        bullet = re.match(r"^\s*[-*]\s+(.+)$", line)
        if heading:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            level = min(4, len(heading.group(1)) + 2)
            html_lines.append(f"<h{level} style='margin:8px 0 4px 0;'>{heading.group(2)}</h{level}>")
        elif bullet:
            if not in_ul:
                html_lines.append("<ul style='margin:6px 0 6px 18px; padding:0;'>")
                in_ul = True
            html_lines.append(f"<li>{bullet.group(1)}</li>")
        else:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            html_lines.append(f"<div style='margin:3px 0;'>{line}</div>")
    if in_ul:
        html_lines.append("</ul>")

    result = "".join(html_lines)
    for key, value in placeholders.items():
        result = result.replace(key, value)
    return result


def render_markdown_latex(content: str, theme: Dict[str, str]) -> str:
    return (
        f"<div style='color:{theme['text']}; font-size:14px; line-height:1.45;'>"
        f"{_inline_markup_to_html(content, theme)}"
        "</div>"
    )



def _markdown_to_mathjax_body(content: str, theme: Dict[str, str]) -> str:
    r"""Markdown renderer that keeps TeX delimiters intact for MathJax.

    Supports the same lightweight markdown subset as the QLabel fallback,
    but leaves $...$, $$...$$, \(...\), and \[...] for MathJax to render.
    """
    placeholders: Dict[str, str] = {}

    def stash(fragment: str) -> str:
        key = f"@@TREECHAT_WEB_BLOCK_{len(placeholders)}@@"
        placeholders[key] = fragment
        return key

    def code_block(match: re.Match) -> str:
        lang = html.escape((match.group(1) or "").strip())
        code = html.escape(match.group(2).rstrip())
        label = f"<div class='code-label'>{lang}</div>" if lang else ""
        return stash(f"<div class='code-block'>{label}<pre>{code}</pre></div>")

    content = re.sub(r"```([\w.+-]*)\n([\s\S]*?)```", code_block, content)
    escaped = html.escape(content)

    escaped = re.sub(
        r"`([^`]+)`",
        lambda m: f"<code>{m.group(1)}</code>",
        escaped,
    )
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r"<a href='\2'>\1</a>",
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", escaped)

    html_lines: List[str] = []
    in_ul = False
    for raw_line in escaped.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            html_lines.append("<br>")
            continue

        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        bullet = re.match(r"^\s*[-*]\s+(.+)$", line)
        if heading:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            level = min(4, len(heading.group(1)) + 2)
            html_lines.append(f"<h{level}>{heading.group(2)}</h{level}>")
        elif bullet:
            if not in_ul:
                html_lines.append("<ul>")
                in_ul = True
            html_lines.append(f"<li>{bullet.group(1)}</li>")
        else:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            html_lines.append(f"<div class='p'>{line}</div>")

    if in_ul:
        html_lines.append("</ul>")

    body = "".join(html_lines)
    for key, value in placeholders.items():
        body = body.replace(key, value)
    return body


def render_markdown_mathjax_document(content: str, theme: Dict[str, str]) -> str:
    """Full HTML document for QWebEngineView + MathJax.

    This is used when PySide6-WebEngine is installed. It renders real TeX math
    for both user and assistant messages, while the app still has a QLabel
    fallback if WebEngine is unavailable.
    """
    body = _markdown_to_mathjax_body(content, theme)
    return f"""
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{
    margin: 0;
    padding: 0;
    background: transparent;
    color: {theme['text']};
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.46;
    overflow-wrap: anywhere;
  }}
  body {{ padding: 0; }}
  .p {{ margin: 3px 0; }}
  h3, h4, h5, h6 {{ margin: 8px 0 4px; line-height: 1.25; }}
  ul {{ margin: 6px 0 6px 18px; padding: 0; }}
  li {{ margin: 3px 0; }}
  a {{ color: {theme['accent']}; text-decoration: none; }}
  code {{
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    padding: 2px 5px;
    border-radius: 6px;
    background: {theme['panel_soft']};
    border: 1px solid {theme['border']};
  }}
  .code-block {{
    margin: 8px 0;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid {theme['border']};
    background: {theme['panel_soft']};
  }}
  .code-label {{ opacity: .65; font-size: 11px; margin-bottom: 6px; }}
  pre {{
    margin: 0;
    white-space: pre-wrap;
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }}
  mjx-container {{ overflow-x: auto; overflow-y: hidden; max-width: 100%; }}
</style>
<script>
window.MathJax = {{
  tex: {{
    inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
    displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
    processEscapes: true
  }},
  svg: {{ fontCache: 'global' }},
  options: {{ skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }}
}};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</head>
<body>{body}</body>
</html>
"""


def estimate_bubble_height(content: str) -> int:
    lines = content.count("\n") + 1
    display_math = len(re.findall(r"\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]", content))
    code_blocks = len(re.findall(r"```[\s\S]*?```", content))
    soft_wraps = max(0, len(content) // 72)
    height = 32 + lines * 23 + soft_wraps * 18 + display_math * 34 + code_blocks * 70
    return max(54, min(height, 720))


def web_search_duckduckgo(query: str, max_results: int = 5) -> str:
    """Local, no-server web search helper using DuckDuckGo HTML results.

    This avoids adding backend infrastructure or paid search APIs for the MVP.
    It is best-effort and can break if DuckDuckGo changes its markup.
    """
    q = query.strip()
    if not q:
        return ""
    url = f"https://duckduckgo.com/html/?q={quote_plus(q)}"
    headers = {"User-Agent": "Mozilla/5.0 treeAI/0.1"}
    response = requests.get(url, headers=headers, timeout=12)
    response.raise_for_status()
    page = response.text

    results: List[str] = []
    pattern = re.compile(
        r"<a[^>]+class=\"result__a\"[^>]+href=\"(?P<href>[^\"]+)\"[^>]*>(?P<title>[\s\S]*?)</a>[\s\S]*?"
        r"<a[^>]+class=\"result__snippet\"[^>]*>(?P<snippet>[\s\S]*?)</a>",
        re.IGNORECASE,
    )
    for match in pattern.finditer(page):
        title = re.sub(r"<[^>]+>", "", match.group("title"))
        snippet = re.sub(r"<[^>]+>", "", match.group("snippet"))
        href = html.unescape(match.group("href"))
        # DuckDuckGo often wraps target URL in uddg=...
        uddg = re.search(r"[?&]uddg=([^&]+)", href)
        if uddg:
            href = unquote(uddg.group(1))
        title = html.unescape(title).strip()
        snippet = html.unescape(snippet).strip()
        if title:
            results.append(f"{len(results)+1}. {title}\nURL: {href}\nSnippet: {snippet}")
        if len(results) >= max_results:
            break

    if not results:
        return ""
    return "\n\n".join(results)


class Store:
    def __init__(self, path: str = DB_PATH):
        self.path = path
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.init_db()
        self.remove_seed_data()
        self.remove_empty_default_trees()

    @staticmethod
    def now() -> int:
        return int(time.time())

    def init_db(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS trees (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_node_id TEXT
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                tree_id TEXT NOT NULL,
                parent_id TEXT,
                title TEXT NOT NULL,
                summary TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                tree_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS prompt_cache (
                prompt_hash TEXT PRIMARY KEY,
                tree_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                model TEXT NOT NULL,
                token_estimate INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL
            );
            """
        )
        self.conn.commit()

    def remove_seed_data(self) -> None:
        if self.get_setting("seed_data_removed", "") == "1":
            return
        seed_titles = (
            "AI app idea",
            "Pricing strategy",
            "Book outline",
            "Architecture",
            "Customer research",
            "Marketing ideas",
        )
        placeholders = ",".join("?" for _ in seed_titles)
        rows = list(self.conn.execute(f"SELECT id FROM trees WHERE title IN ({placeholders})", seed_titles))
        for row in rows:
            self.delete_tree(row["id"], commit=False)
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("seed_data_removed", "1"),
        )
        self.conn.commit()

    def remove_empty_default_trees(self) -> None:
        if self.get_setting("empty_default_trees_removed", "") == "1":
            return
        rows = list(
            self.conn.execute(
                """
                SELECT t.id
                FROM trees t
                LEFT JOIN messages m ON m.tree_id = t.id
                WHERE t.title = 'Untitled tree'
                GROUP BY t.id
                HAVING COUNT(m.id) = 0
                """
            )
        )
        for row in rows:
            self.delete_tree(row["id"], commit=False)
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("empty_default_trees_removed", "1"),
        )
        self.conn.commit()

    def get_setting(self, key: str, default: str = "") -> str:
        row = self.conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        self.conn.commit()

    def get_api_key(self) -> str:
        if keyring is not None:
            try:
                return keyring.get_password(APP_NAME, "api_key") or ""
            except Exception:
                pass
        return self.get_setting("api_key", "")

    def set_api_key(self, api_key: str) -> None:
        if keyring is not None:
            try:
                keyring.set_password(APP_NAME, "api_key", api_key)
                self.set_setting("api_key", "")
                return
            except Exception:
                pass
        self.set_setting("api_key", api_key)

    def list_trees(self) -> List[sqlite3.Row]:
        return list(
            self.conn.execute(
                """
                SELECT t.*, COUNT(m.id) AS message_count
                FROM trees t
                LEFT JOIN messages m ON m.tree_id = t.id
                GROUP BY t.id
                ORDER BY t.updated_at DESC
                """
            )
        )

    def count_tree_messages(self, tree_id: str) -> int:
        row = self.conn.execute("SELECT COUNT(*) AS c FROM messages WHERE tree_id = ?", (tree_id,)).fetchone()
        return int(row["c"] if row else 0)

    def is_tree_empty(self, tree_id: str) -> bool:
        return self.count_tree_messages(tree_id) == 0

    def create_tree(self, title: str = "Untitled tree") -> str:
        ts = self.now()
        tree_id = str(uuid.uuid4())
        root_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO trees(id, title, created_at, updated_at, last_node_id) VALUES (?, ?, ?, ?, ?)",
            (tree_id, title, ts, ts, root_id),
        )
        self.conn.execute(
            "INSERT INTO nodes(id, tree_id, parent_id, title, summary, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
            (root_id, tree_id, "Root", title, ts, ts),
        )
        self.conn.commit()
        return tree_id

    def delete_tree(self, tree_id: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM messages WHERE tree_id = ?", (tree_id,))
        self.conn.execute("DELETE FROM nodes WHERE tree_id = ?", (tree_id,))
        self.conn.execute("DELETE FROM trees WHERE id = ?", (tree_id,))
        if commit:
            self.conn.commit()

    def get_tree(self, tree_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM trees WHERE id = ?", (tree_id,)).fetchone()
        if row is None:
            raise RuntimeError("Tree not found")
        return row

    def get_root_node(self, tree_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM nodes WHERE tree_id = ? AND parent_id IS NULL LIMIT 1", (tree_id,)).fetchone()
        if row is None:
            raise RuntimeError("Root node not found")
        return row

    def get_node(self, node_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if row is None:
            raise RuntimeError("Node not found")
        return row

    def get_nodes(self, tree_id: str) -> List[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM nodes WHERE tree_id = ? ORDER BY created_at", (tree_id,)))

    def create_child_node(self, tree_id: str, parent_id: str, title: str = "New node") -> str:
        ts = self.now()
        node_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO nodes(id, tree_id, parent_id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (node_id, tree_id, parent_id, title, "Empty", ts, ts),
        )
        self.conn.execute("UPDATE trees SET updated_at = ? WHERE id = ?", (ts, tree_id))
        self.conn.commit()
        return node_id

    def rename_node(self, tree_id: str, node_id: str, title: str) -> None:
        title = title.strip()[:96]
        if not title:
            return
        ts = self.now()
        self.conn.execute(
            "UPDATE nodes SET title = ?, updated_at = ? WHERE id = ? AND tree_id = ?",
            (title, ts, node_id, tree_id),
        )
        self.conn.execute("UPDATE trees SET updated_at = ? WHERE id = ?", (ts, tree_id))
        self.conn.commit()

    def delete_node(self, tree_id: str, node_id: str) -> Tuple[Optional[str], List[str]]:
        node = self.conn.execute("SELECT * FROM nodes WHERE id = ? AND tree_id = ?", (node_id, tree_id)).fetchone()
        if node is None or node["parent_id"] is None:
            return None, []

        rows = list(
            self.conn.execute(
                """
                WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM nodes WHERE id = ? AND tree_id = ?
                    UNION ALL
                    SELECT n.id
                    FROM nodes n
                    JOIN subtree s ON n.parent_id = s.id
                    WHERE n.tree_id = ?
                )
                SELECT id FROM subtree
                """,
                (node_id, tree_id, tree_id),
            )
        )
        deleted_ids = [row["id"] for row in rows]
        if not deleted_ids:
            return None, []
        placeholders = ",".join("?" for _ in deleted_ids)
        self.conn.execute(
            f"DELETE FROM messages WHERE tree_id = ? AND node_id IN ({placeholders})",
            (tree_id, *deleted_ids),
        )
        self.conn.execute(
            f"DELETE FROM nodes WHERE tree_id = ? AND id IN ({placeholders})",
            (tree_id, *deleted_ids),
        )
        self.conn.execute("UPDATE trees SET updated_at = ? WHERE id = ?", (self.now(), tree_id))
        self.conn.commit()
        return node["parent_id"], deleted_ids

    def set_last_node(self, tree_id: str, node_id: str, commit: bool = True) -> None:
        ts = self.now()
        self.conn.execute("UPDATE trees SET last_node_id = ?, updated_at = ? WHERE id = ?", (node_id, ts, tree_id))
        if commit:
            self.conn.commit()

    def add_message(self, tree_id: str, node_id: str, role: str, content: str) -> str:
        ts = self.now()
        msg_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO messages(id, tree_id, node_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, tree_id, node_id, role, content, ts),
        )
        snippet = content.strip().splitlines()[0][:46] if content.strip() else "Empty"
        node = self.get_node(node_id)
        if role == "user" and node["title"] in ("Root", "New node"):
            self.conn.execute(
                "UPDATE nodes SET title = ?, summary = ?, updated_at = ? WHERE id = ?",
                (snippet, snippet, ts, node_id),
            )
        elif role == "assistant" and (not node["summary"] or node["summary"] == "Empty"):
            self.conn.execute(
                "UPDATE nodes SET summary = ?, updated_at = ? WHERE id = ?",
                (snippet, ts, node_id),
            )
        else:
            self.conn.execute("UPDATE nodes SET updated_at = ? WHERE id = ?", (ts, node_id))
        self.set_last_node(tree_id, node_id, commit=False)
        self.conn.commit()
        return msg_id

    def get_path_nodes(self, node_id: str) -> List[sqlite3.Row]:
        result: List[sqlite3.Row] = []
        current: Optional[str] = node_id
        while current:
            node = self.get_node(current)
            result.append(node)
            current = node["parent_id"]
        return list(reversed(result))

    def get_messages_for_path(self, tree_id: str, node_id: str) -> List[sqlite3.Row]:
        path = self.get_path_nodes(node_id)
        ids = [n["id"] for n in path]
        if not ids:
            return []
        placeholders = ",".join("?" for _ in ids)
        return list(
            self.conn.execute(
                f"SELECT * FROM messages WHERE tree_id = ? AND node_id IN ({placeholders}) ORDER BY created_at",
                (tree_id, *ids),
            )
        )


class ApiWorker(QThread):
    delta = Signal(str)
    status = Signal(str)
    finished_ok = Signal(str)
    failed = Signal(str)

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, str]],
        stream: bool = True,
        use_web_search: bool = False,
        web_query: str = "",
    ):
        super().__init__()
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.messages = messages
        self.stream = stream
        self.use_web_search = use_web_search
        self.web_query = web_query
        self._buffer = ""

    def run(self) -> None:
        try:
            if not self.api_key:
                self.failed.emit("API key is empty. Open Settings and add your key.")
                return
            if self.use_web_search:
                self.status.emit("Searching the web…")
                try:
                    results = web_search_duckduckgo(self.web_query)
                except Exception as exc:
                    results = f"Web search failed: {exc}"
                if results:
                    self.messages = [
                        *self.messages,
                        {
                            "role": "system",
                            "content": (
                                "The user enabled web search for this request. Use the following search results as fresh external context. "
                                "Mention when the results are insufficient or uncertain. Search results:\n\n" + results
                            ),
                        },
                    ]
                else:
                    self.messages = [
                        *self.messages,
                        {"role": "system", "content": "The user enabled web search, but no useful search results were found."},
                    ]
            payload = {
                "model": self.model,
                "messages": self.messages,
                "temperature": 0.7,
                "stream": self.stream,
            }
            headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
            if self.stream:
                self._run_streaming(payload, headers)
            else:
                self._run_non_streaming(payload, headers)
        except Exception as exc:
            self.failed.emit(str(exc))

    def _run_non_streaming(self, payload: Dict, headers: Dict[str, str]) -> None:
        payload = dict(payload)
        payload["stream"] = False
        response = requests.post(self.endpoint, headers=headers, json=payload, timeout=120)
        if response.status_code >= 400:
            self.failed.emit(f"API error {response.status_code}: {response.text[:1000]}")
            return
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        self.finished_ok.emit(content)

    def _run_streaming(self, payload: Dict, headers: Dict[str, str]) -> None:
        with requests.post(self.endpoint, headers=headers, json=payload, timeout=120, stream=True) as response:
            if response.status_code >= 400:
                if response.status_code in (400, 404, 422):
                    self._run_non_streaming(payload, headers)
                    return
                self.failed.emit(f"API error {response.status_code}: {response.text[:1000]}")
                return
            for raw_line in response.iter_lines(decode_unicode=True):
                if self.isInterruptionRequested():
                    break
                if not raw_line:
                    continue
                line = raw_line.strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    data = json.loads(line)
                except Exception:
                    continue
                choice = data.get("choices", [{}])[0]
                delta = choice.get("delta", {})
                piece = delta.get("content")
                if piece is None:
                    piece = choice.get("message", {}).get("content")
                if piece:
                    self._buffer += piece
                    self.delta.emit(piece)
            self.finished_ok.emit(self._buffer)


class ChildNodesWorker(QThread):
    finished_ok = Signal(list)
    failed = Signal(str)

    def __init__(self, endpoint: str, api_key: str, model: str, context_messages: List[Dict[str, str]], count: int = 5):
        super().__init__()
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.context_messages = context_messages
        self.count = count

    def run(self) -> None:
        try:
            if not self.api_key:
                self.failed.emit("API key is empty. Open Settings and add your key.")
                return

            messages: List[Dict[str, str]] = [
                {
                    "role": "system",
                    "content": (
                        "You are generating child nodes for a visual tree-based AI thinking app. "
                        "Return ONLY valid JSON. No Markdown. No explanation. "
                        "The JSON must be an array of short node titles, for example: "
                        "[\"Market risks\", \"Alternative proof\", \"Next experiments\"]. "
                        "Each title must be concise, useful, and distinct. Maximum 42 characters each."
                    ),
                },
                *self.context_messages[-24:],
                {
                    "role": "user",
                    "content": f"Create {self.count} useful child node titles for continuing from the current node. Return only a JSON array of strings.",
                },
            ]
            response = requests.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={"model": self.model, "messages": messages, "temperature": 0.6, "stream": False},
                timeout=90,
            )
            if response.status_code >= 400:
                self.failed.emit(f"API error {response.status_code}: {response.text[:1000]}")
                return
            content = response.json()["choices"][0]["message"]["content"]
            titles = self.parse_titles(content)
            if not titles:
                self.failed.emit("The model did not return usable node titles.")
                return
            self.finished_ok.emit(titles[: self.count])
        except Exception as exc:
            self.failed.emit(str(exc))

    @staticmethod
    def parse_titles(content: str) -> List[str]:
        raw = content.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
        candidates = [raw]
        match = re.search(r"\[[\s\S]*\]", raw)
        if match:
            candidates.insert(0, match.group(0))
        for candidate in candidates:
            try:
                data = json.loads(candidate)
                if isinstance(data, dict):
                    data = data.get("nodes") or data.get("titles") or data.get("children") or []
                if isinstance(data, list):
                    out: List[str] = []
                    seen = set()
                    for item in data:
                        if isinstance(item, dict):
                            title = str(item.get("title") or item.get("name") or "").strip()
                        else:
                            title = str(item).strip()
                        title = re.sub(r"\s+", " ", title).strip(" -•\t\n\r")[:64]
                        if title and title.lower() not in seen:
                            seen.add(title.lower())
                            out.append(title)
                    return out
            except Exception:
                continue
        # Last-resort parser for numbered/bulleted lines.
        out = []
        seen = set()
        for line in raw.splitlines():
            title = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip().strip('"')[:64]
            if title and not title.startswith("{") and title.lower() not in seen:
                seen.add(title.lower())
                out.append(title)
        return out


class ChatBubble(QFrame):
    def __init__(self, role: str, content: str, theme: Dict[str, str]):
        super().__init__()
        self.setObjectName("ChatBubble")
        self.role = role
        self.theme = theme
        self.bg = QColor(theme["user"] if role == "user" else theme["assistant"])
        self.border = QColor(theme["border"])
        self.content = content
        self.setStyleSheet(
            f"""
            QFrame#ChatBubble {{ background: transparent; border: none; }}
            QLabel {{
                background: transparent;
                color: {theme['text']};
                font-size: 14px;
                line-height: 1.45;
            }}
            """
        )
        self.setMaximumWidth(610)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 14, 18, 14)

        self.webview = None
        self.label = None
        if QWebEngineView is not None:
            self.webview = QWebEngineView()
            self.webview.setContextMenuPolicy(Qt.ContextMenuPolicy.DefaultContextMenu)
            self.webview.setStyleSheet("background: transparent;")
            self.webview.setFixedHeight(estimate_bubble_height(content))
            layout.addWidget(self.webview)
        else:
            self.label = QLabel()
            self.label.setWordWrap(True)
            self.label.setTextFormat(Qt.RichText)
            self.label.setOpenExternalLinks(True)
            self.label.setTextInteractionFlags(Qt.TextSelectableByMouse | Qt.LinksAccessibleByMouse)
            layout.addWidget(self.label)

        self.set_content(content)

    def set_content(self, content: str) -> None:
        self.content = content
        if self.webview is not None:
            self.webview.setFixedHeight(estimate_bubble_height(content))
            self.webview.setHtml(render_markdown_mathjax_document(content, self.theme))
        elif self.label is not None:
            self.label.setText(render_markdown_latex(content, self.theme))

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        rect = QRectF(0.5, 0.5, self.width() - 1, self.height() - 1)
        painter.setBrush(QBrush(self.bg))
        painter.setPen(QPen(self.border, 1))
        painter.drawRoundedRect(rect, 22, 22)
        super().paintEvent(event)


class EmptyState(QWidget):
    def __init__(self, theme: Dict[str, str], title_text: str = "Empty root", subtitle_text: str = "Write the first message. A normal chat is just one root node."):
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignCenter)
        title = QLabel(title_text)
        title.setObjectName("Empty")
        title.setStyleSheet("font-size: 24px; font-weight: 700; background: transparent;")
        subtitle = QLabel(subtitle_text)
        subtitle.setObjectName("Empty")
        subtitle.setAlignment(Qt.AlignCenter)
        subtitle.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(subtitle)


class TreeListRow(QWidget):
    def __init__(self, tree_id: str, on_select, on_delete_requested):
        super().__init__()
        self.tree_id = tree_id
        self.on_select = on_select
        self.on_delete_requested = on_delete_requested

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self.on_select(self.tree_id)
            event.accept()
            return
        if event.button() == Qt.RightButton:
            self.on_delete_requested(self.tree_id)
            event.accept()
            return
        super().mousePressEvent(event)


class TreeCanvasView(QGraphicsView):
    zoom_changed = Signal(float)

    def __init__(self, scene: QGraphicsScene, parent=None):
        super().__init__(scene, parent)
        self.zoom_factor = 1.0
        self._last_pan_pos: Optional[QPoint] = None
        self.setRenderHint(QPainter.Antialiasing)
        self.setFrameShape(QFrame.NoFrame)
        self.setStyleSheet("background: transparent;")
        self.setDragMode(QGraphicsView.NoDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorViewCenter)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setViewportUpdateMode(QGraphicsView.FullViewportUpdate)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setCursor(black_circle_cursor())
        self.viewport().setCursor(black_circle_cursor())

    def viewportEvent(self, event) -> bool:
        if event.type() == QEvent.NativeGesture:
            gesture_type = event.gestureType()
            if gesture_type == Qt.ZoomNativeGesture:
                factor = max(0.2, 1.0 + event.value())
                self.zoom_by(factor)
                event.accept()
                return True
            if gesture_type == Qt.SmartZoomNativeGesture:
                self.reset_zoom()
                event.accept()
                return True
        return super().viewportEvent(event)

    def keyPressEvent(self, event) -> None:
        scene = self.scene()
        if event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            if hasattr(scene, "delete_current"):
                scene.delete_current()
            event.accept()
            return
        if event.key() == Qt.Key_Escape:
            if hasattr(scene, "on_close"):
                scene.on_close()
            event.accept()
            return
        super().keyPressEvent(event)

    def wheelEvent(self, event: QWheelEvent) -> None:
        wants_zoom = bool(event.modifiers() & (Qt.ControlModifier | Qt.MetaModifier))
        if wants_zoom:
            delta_y = event.pixelDelta().y() or event.angleDelta().y()
            if delta_y == 0:
                event.accept()
                return
            self.zoom_by(1.0015 ** delta_y)
            event.accept()
            return
        delta = event.pixelDelta()
        if delta.isNull():
            angle = event.angleDelta()
            dx = angle.x() / 2
            dy = angle.y() / 2
        else:
            dx = delta.x()
            dy = delta.y()
        self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - int(dx))
        self.verticalScrollBar().setValue(self.verticalScrollBar().value() - int(dy))
        event.accept()

    def mousePressEvent(self, event) -> None:
        item = self.itemAt(event.position().toPoint())
        if event.button() == Qt.LeftButton and (item is None or not isinstance(item, NodeCard)):
            self._last_pan_pos = event.position().toPoint()
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._last_pan_pos is not None and event.buttons() & Qt.LeftButton:
            pos = event.position().toPoint()
            delta = pos - self._last_pan_pos
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - delta.x())
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - delta.y())
            self._last_pan_pos = pos
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        self._last_pan_pos = None
        super().mouseReleaseEvent(event)

    def zoom_by(self, factor: float) -> None:
        new_zoom = max(0.35, min(2.5, self.zoom_factor * factor))
        factor = new_zoom / self.zoom_factor
        self.zoom_factor = new_zoom
        self.scale(factor, factor)
        self.zoom_changed.emit(self.zoom_factor)

    def reset_zoom(self) -> None:
        self.resetTransform()
        self.zoom_factor = 1.0
        self.zoom_changed.emit(self.zoom_factor)

    def set_zoom_factor(self, value: float) -> None:
        self.zoom_factor = value
        self.zoom_changed.emit(self.zoom_factor)


class TreeScene(QGraphicsScene):
    def __init__(self):
        super().__init__()
        self.on_select_node = lambda node_id: None
        self.on_add_child = lambda node_id: None
        self.on_delete_node = lambda node_id: None
        self.on_rename_node = lambda node_id: None
        self.on_close = lambda: None
        self.current_node_id: Optional[str] = None

    def delete_current(self) -> None:
        if self.current_node_id:
            self.on_delete_node(self.current_node_id)


class NodeCard(QGraphicsItem):
    W = 156
    H = 88
    PLUS_R = 13
    DELETE_SIZE = 24
    DELETE_MARGIN = 8

    def __init__(self, node: sqlite3.Row, theme: Dict[str, str], selected: bool = False):
        super().__init__()
        self.node = node
        self.theme = theme
        self.selected = selected
        self.setAcceptHoverEvents(True)
        self.hovered = False

    def boundingRect(self) -> QRectF:
        return QRectF(-10, -10, self.W + 20, self.H + self.PLUS_R + 12)

    def delete_rect(self) -> QRectF:
        return QRectF(self.W - self.DELETE_SIZE - self.DELETE_MARGIN, self.DELETE_MARGIN, self.DELETE_SIZE, self.DELETE_SIZE)

    def hoverEnterEvent(self, event) -> None:
        self.hovered = True
        self.update()

    def hoverLeaveEvent(self, event) -> None:
        self.hovered = False
        self.update()

    def mouseDoubleClickEvent(self, event) -> None:
        scene = self.scene()
        if hasattr(scene, "on_rename_node"):
            scene.on_rename_node(self.node["id"])
        event.accept()

    def mousePressEvent(self, event) -> None:
        p = event.pos()
        if self.node["parent_id"] is not None and self.delete_rect().contains(p):
            scene = self.scene()
            if hasattr(scene, "on_delete_node"):
                scene.on_delete_node(self.node["id"])
            event.accept()
            return
        cx = self.W / 2
        cy = self.H
        if (p.x() - cx) ** 2 + (p.y() - cy) ** 2 <= self.PLUS_R ** 2:
            scene = self.scene()
            if hasattr(scene, "on_add_child"):
                scene.on_add_child(self.node["id"])
            event.accept()
            return
        scene = self.scene()
        if hasattr(scene, "on_select_node"):
            scene.on_select_node(self.node["id"])
        event.accept()

    def paint(self, painter: QPainter, option, widget=None) -> None:
        painter.setRenderHint(QPainter.Antialiasing)
        is_root = self.node["parent_id"] is None
        show_delete = not is_root and (self.hovered or self.selected)
        rect = QRectF(0, 0, self.W, self.H)
        bg = QColor(self.theme["panel"])
        if is_root:
            bg = QColor("#F7F4E8") if self.theme["app_bg"] != "#151518" else QColor("#28241D")
        border_color = QColor(self.theme["accent"] if self.selected else self.theme["border"])
        border_width = 2.0 if self.selected else 1.2
        if self.hovered and not self.selected:
            border_color = QColor(self.theme["muted"])
        painter.setPen(QPen(border_color, border_width))
        painter.setBrush(QBrush(bg))
        painter.drawRoundedRect(rect, 18, 18)

        painter.setPen(QColor(self.theme["text"]))
        title_font = QFont()
        title_font.setPointSize(11)
        title_font.setWeight(QFont.DemiBold)
        painter.setFont(title_font)
        title_width = self.W - (48 if show_delete else 28)
        painter.drawText(QRectF(14, 12, title_width, 22), Qt.AlignLeft | Qt.AlignVCenter, self.node["title"][:24])

        if show_delete:
            delete_rect = self.delete_rect()
            danger_bg = QColor("#FEF3F2") if self.theme["app_bg"] != "#151518" else QColor("#3A2020")
            danger = QColor("#B42318") if self.theme["app_bg"] != "#151518" else QColor("#FCA5A5")
            painter.setPen(QPen(danger, 1.3))
            painter.setBrush(QBrush(danger_bg))
            painter.drawRoundedRect(delete_rect, 12, 12)
            painter.drawLine(delete_rect.left() + 6, delete_rect.top() + 7, delete_rect.right() - 6, delete_rect.top() + 7)
            painter.drawLine(delete_rect.left() + 8, delete_rect.top() + 10, delete_rect.left() + 9, delete_rect.bottom() - 5)
            painter.drawLine(delete_rect.right() - 8, delete_rect.top() + 10, delete_rect.right() - 9, delete_rect.bottom() - 5)
            painter.drawLine(delete_rect.left() + 8, delete_rect.bottom() - 5, delete_rect.right() - 8, delete_rect.bottom() - 5)

        painter.setPen(QColor(self.theme["muted"]))
        summary_font = QFont()
        summary_font.setPointSize(9)
        painter.setFont(summary_font)
        summary = self.node["summary"] or "Empty"
        painter.drawText(QRectF(14, 39, self.W - 28, 40), Qt.AlignLeft | Qt.TextWordWrap, summary[:52])

        cx = self.W / 2
        cy = self.H
        painter.setPen(QPen(QColor(self.theme["border"]), 1.1))
        painter.setBrush(QBrush(QColor(self.theme["panel"])))
        painter.drawEllipse(QPointF(cx, cy), self.PLUS_R, self.PLUS_R)
        painter.setPen(QPen(QColor(self.theme["text"]), 1.5))
        painter.drawLine(QPointF(cx - 5, cy), QPointF(cx + 5, cy))
        painter.drawLine(QPointF(cx, cy - 5), QPointF(cx, cy + 5))


class TreeOverlay(QFrame):
    node_selected = Signal(str)
    child_requested = Signal(str)
    delete_requested = Signal(str)
    rename_requested = Signal(str)
    ai_children_requested = Signal(str)
    closed = Signal()

    def __init__(self, store: Store, theme: Dict[str, str], parent=None):
        super().__init__(parent)
        self.store = store
        self.theme = theme
        self.tree_id: Optional[str] = None
        self.current_node_id: Optional[str] = None
        self.node_positions: Dict[str, Tuple[float, float]] = {}
        self.anchor_node_id: Optional[str] = None
        self.setObjectName("TreeOverlay")
        self.apply_overlay_theme()
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(38)
        shadow.setOffset(0, 14)
        shadow.setColor(QColor(0, 0, 0, 42))
        self.setGraphicsEffect(shadow)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        toolbar = QHBoxLayout()
        toolbar.setContentsMargins(18, 16, 18, 8)
        toolbar.setSpacing(8)
        close_btn = QPushButton("Close")
        close_btn.setFixedHeight(34)
        close_btn.clicked.connect(self.closed.emit)
        toolbar.addWidget(close_btn)
        toolbar.addStretch(1)
        self.rename_btn = QPushButton("Rename")
        self.rename_btn.setFixedHeight(34)
        self.rename_btn.clicked.connect(lambda: self.current_node_id and self.rename_requested.emit(self.current_node_id))
        toolbar.addWidget(self.rename_btn)
        self.ai_children_btn = QPushButton("AI children")
        self.ai_children_btn.setObjectName("Primary")
        self.ai_children_btn.setFixedHeight(34)
        self.ai_children_btn.clicked.connect(lambda: self.current_node_id and self.ai_children_requested.emit(self.current_node_id))
        toolbar.addWidget(self.ai_children_btn)
        root.addLayout(toolbar)

        self.scene = TreeScene()
        self.scene.on_select_node = self.node_selected.emit
        self.scene.on_add_child = self.child_requested.emit
        self.scene.on_delete_node = self.delete_requested.emit
        self.scene.on_rename_node = self.rename_requested.emit
        self.scene.on_close = self.closed.emit
        self.view = TreeCanvasView(self.scene)
        root.addWidget(self.view, 1)

    def apply_overlay_theme(self) -> None:
        self.setStyleSheet(
            f"""
            QFrame#TreeOverlay {{
                background: {self.theme['panel']};
                border: 1px solid {self.theme['border']};
                border-radius: 24px;
            }}
            """
        )

    def set_theme(self, theme: Dict[str, str]) -> None:
        self.theme = theme
        self.apply_overlay_theme()

    def load_tree(self, tree_id: str, current_node_id: str, preserve_view: bool = True) -> None:
        same_tree = self.tree_id == tree_id
        can_preserve = preserve_view and same_tree and bool(self.node_positions)
        old_center = self.view.mapToScene(self.view.viewport().rect().center()) if can_preserve else None
        old_transform = self.view.transform() if can_preserve else None
        old_zoom = self.view.zoom_factor
        previous_current_node_id = self.current_node_id
        self.tree_id = tree_id
        self.current_node_id = current_node_id
        self.scene.current_node_id = current_node_id
        self.scene.clear()
        nodes = self.store.get_nodes(tree_id)
        if not nodes:
            self.node_positions = {}
            self.anchor_node_id = None
            return
        children: Dict[Optional[str], List[sqlite3.Row]] = {}
        for node in nodes:
            children.setdefault(node["parent_id"], []).append(node)
        root_node = next((n for n in nodes if n["parent_id"] is None), None)
        if root_node is None:
            self.node_positions = {}
            self.anchor_node_id = None
            return
        positions: Dict[str, Tuple[float, float]] = {}
        leaf_gap = 210
        level_gap = 170
        next_leaf_x = 0

        def layout_subtree(node: sqlite3.Row, depth: int) -> float:
            nonlocal next_leaf_x
            node_children = children.get(node["id"], [])
            if not node_children:
                x = next_leaf_x * leaf_gap
                next_leaf_x += 1
            else:
                child_xs = [layout_subtree(child, depth + 1) for child in node_children]
                x = (min(child_xs) + max(child_xs)) / 2
            positions[node["id"]] = (x, depth * level_gap)
            return x

        layout_subtree(root_node, 0)
        anchor_id = self.anchor_node_id or previous_current_node_id or current_node_id
        if can_preserve and anchor_id in self.node_positions and anchor_id in positions:
            old_x, old_y = self.node_positions[anchor_id]
            new_x, new_y = positions[anchor_id]
            delta_x = old_x - new_x
            delta_y = old_y - new_y
            positions = {k: (x + delta_x, y + delta_y) for k, (x, y) in positions.items()}
        elif positions:
            min_x = min(x for x, _ in positions.values())
            max_x = max(x for x, _ in positions.values())
            offset_x = -((min_x + max_x) / 2)
            positions = {k: (x + offset_x, y) for k, (x, y) in positions.items()}
        self.anchor_node_id = None
        self.node_positions = dict(positions)
        connector_pen = QPen(QColor(self.theme["border"]), 1.4)
        for node in nodes:
            parent_id = node["parent_id"]
            if not parent_id:
                continue
            px, py = positions[parent_id]
            cx, cy = positions[node["id"]]
            start = QPointF(px + NodeCard.W / 2, py + NodeCard.H)
            end = QPointF(cx + NodeCard.W / 2, cy)
            mid_y = (start.y() + end.y()) / 2
            path = QPainterPath(start)
            path.lineTo(QPointF(start.x(), mid_y))
            path.lineTo(QPointF(end.x(), mid_y))
            path.lineTo(end)
            self.scene.addPath(path, connector_pen)
        for node in nodes:
            if not node["parent_id"]:
                continue
            x, y = positions[node["id"]]
            self.scene.addEllipse(
                x + NodeCard.W / 2 - 4,
                y - 4,
                8,
                8,
                QPen(QColor(self.theme["border"]), 1.2),
                QBrush(QColor(self.theme["panel"])),
            )
        for node in nodes:
            x, y = positions[node["id"]]
            card = NodeCard(node, self.theme, selected=(node["id"] == current_node_id))
            card.setPos(x, y)
            self.scene.addItem(card)
        rect = self.scene.itemsBoundingRect().adjusted(-180, -120, 180, 160)
        self.scene.setSceneRect(rect)
        if can_preserve and old_center is not None and old_transform is not None:
            self.view.setTransform(old_transform)
            self.view.set_zoom_factor(old_zoom)
            self.view.centerOn(old_center)
        else:
            self.view.resetTransform()
            self.view.fitInView(rect, Qt.KeepAspectRatio)
            self.view.set_zoom_factor(1.0)


class SettingsDialog(QDialog):
    def __init__(self, store: Store, parent=None):
        super().__init__(parent)
        self.setObjectName("SettingsDialog")
        self.store = store
        configure_native_window(self)
        self.setMinimumWidth(560)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 22, 22, 22)
        layout.setSpacing(14)
        title = QLabel("Settings")
        title.setStyleSheet("font-size: 24px; font-weight: 760; background: transparent;")
        layout.addWidget(title)
        layout.addWidget(QLabel("Theme"))
        self.theme_box = QComboBox()
        self.theme_box.addItems(THEMES.keys())
        self.theme_box.setCurrentText(store.get_setting("theme", "Minimal Light"))
        self.theme_box.setFixedHeight(42)
        self.theme_box.setMaxVisibleItems(len(THEMES))
        layout.addWidget(self.theme_box)
        layout.addWidget(QLabel("API key"))
        self.api_key = QLineEdit()
        self.api_key.setEchoMode(QLineEdit.Password)
        self.api_key.setPlaceholderText("sk-...")
        self.api_key.setText(store.get_api_key())
        layout.addWidget(self.api_key)
        layout.addWidget(QLabel("OpenAI-compatible endpoint"))
        self.endpoint = QLineEdit()
        self.endpoint.setPlaceholderText("https://api.openai.com/v1/chat/completions")
        self.endpoint.setText(store.get_setting("endpoint", "https://api.openai.com/v1/chat/completions"))
        layout.addWidget(self.endpoint)
        layout.addWidget(QLabel("Model"))
        self.model = QLineEdit()
        self.model.setPlaceholderText("gpt-4.1-mini")
        self.model.setText(store.get_setting("model", "gpt-4.1-mini"))
        layout.addWidget(self.model)
        hint = QLabel("The app works without a server. Requests are sent directly from this local app to the endpoint you provide.")
        hint.setWordWrap(True)
        hint.setObjectName("Muted")
        layout.addWidget(hint)
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        save = QPushButton("Save")
        save.setObjectName("Primary")
        cancel.clicked.connect(self.reject)
        save.clicked.connect(self.save)
        buttons.addWidget(cancel)
        buttons.addWidget(save)
        layout.addLayout(buttons)

    def save(self) -> None:
        self.store.set_setting("theme", self.theme_box.currentText())
        self.store.set_api_key(self.api_key.text().strip())
        self.store.set_setting("endpoint", self.endpoint.text().strip())
        self.store.set_setting("model", self.model.text().strip())
        self.accept()


class AppMessageDialog(QDialog):
    def __init__(
        self,
        parent,
        theme: Dict[str, str],
        title: str,
        message: str,
        confirm_text: str = "OK",
        cancel_text: Optional[str] = None,
        destructive: bool = False,
    ):
        super().__init__(parent)
        self.theme = theme
        self.setObjectName("AppMessageDialog")
        configure_native_window(self)
        self.setModal(True)
        self.setMinimumWidth(460)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 20)
        layout.setSpacing(16)

        title_label = QLabel(title)
        title_label.setObjectName("AppMessageTitle")
        title_label.setWordWrap(True)
        layout.addWidget(title_label)

        body = QLabel(message)
        body.setObjectName("AppMessageBody")
        body.setWordWrap(True)
        body.setTextInteractionFlags(Qt.TextSelectableByMouse)
        layout.addWidget(body)

        buttons = QHBoxLayout()
        buttons.addStretch()
        if cancel_text:
            cancel = QPushButton(cancel_text)
            cancel.setFixedHeight(38)
            cancel.clicked.connect(self.reject)
            buttons.addWidget(cancel)
        ok = QPushButton(confirm_text)
        ok.setObjectName("Primary")
        if destructive:
            ok.setObjectName("Destructive")
        ok.setFixedHeight(38)
        ok.clicked.connect(self.accept)
        buttons.addWidget(ok)
        layout.addLayout(buttons)

        self.apply_message_theme()

    def apply_message_theme(self) -> None:
        self.setStyleSheet(
            f"""
            QLabel#AppMessageTitle {{
                background: transparent;
                color: {self.theme['text']};
                font-size: 18px;
                font-weight: 760;
            }}
            QLabel#AppMessageBody {{
                background: transparent;
                color: {self.theme['muted']};
                font-size: 14px;
                line-height: 1.4;
            }}
            QPushButton {{
                background: {self.theme['panel']};
                color: {self.theme['text']};
                border: 1px solid {self.theme['border']};
                border-radius: 19px;
                padding: 0 18px;
            }}
            QPushButton#Primary {{
                background: {self.theme['button']};
                color: {self.theme['button_text']};
                border: none;
            }}
            QPushButton#Destructive {{
                background: #B42318;
                color: #FFFFFF;
                border: none;
            }}
            """
        )


def show_app_error(parent, theme: Dict[str, str], title: str, message: str) -> None:
    AppMessageDialog(parent, theme, title, message).exec()


def ask_app_confirmation(parent, theme: Dict[str, str], title: str, message: str, confirm_text: str = "Delete") -> bool:
    dialog = AppMessageDialog(parent, theme, title, message, confirm_text=confirm_text, cancel_text="Cancel", destructive=True)
    return dialog.exec() == QDialog.Accepted


def install_exception_hook(app: QApplication) -> None:
    def handle_exception(exc_type, exc, tb) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb)
            return
        try:
            parent = app.activeWindow()
            theme = getattr(parent, "theme", None)
            if theme is None:
                for widget in app.topLevelWidgets():
                    theme = getattr(widget, "theme", None)
                    if theme is not None:
                        parent = widget
                        break
            if theme is None:
                theme = THEMES["Minimal Light"]
            message = "".join(traceback.format_exception(exc_type, exc, tb)).strip()
            show_app_error(parent, theme, "Unexpected error", message)
        except Exception:
            sys.__excepthook__(exc_type, exc, tb)
    sys.excepthook = handle_exception


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setObjectName("AppWindow")
        self.store = Store()
        self.current_tree_id: Optional[str] = None
        self.current_node_id: Optional[str] = None
        self.worker: Optional[ApiWorker] = None
        self.child_worker: Optional[ChildNodesWorker] = None
        self.pending_response_tree_id: Optional[str] = None
        self.pending_response_node_id: Optional[str] = None
        # Async generation state. Multiple leaves may generate at the same time.
        # Same-leaf prompts are queued because they depend on the previous assistant reply.
        self.active_requests: Dict[str, Dict[str, Any]] = {}
        self.node_request_id: Dict[str, str] = {}
        self.prompt_queues: Dict[str, List[Dict[str, object]]] = {}
        self.pending_child_creations: Dict[str, List[str]] = {}
        self.pending_ai_children_after_response: set[str] = set()

        # Backward-compatible fields; old code paths no longer rely on these.
        self.prompt_queue: List[Dict[str, object]] = []
        self.streaming_bubble: Optional[ChatBubble] = None
        self.streaming_text = ""
        self.web_search_enabled = False
        self.tray_icon: Optional[QSystemTrayIcon] = None
        self._draft_tree_id: Optional[str] = None
        self.theme_name = self.store.get_setting("theme", "Minimal Light")
        self.theme = THEMES.get(self.theme_name, THEMES["Minimal Light"])
        apply_theme(QApplication.instance(), self.theme)
        configure_native_window(self)
        self.resize(980, 680)
        self.setMinimumSize(760, 520)
        root = QWidget()
        root.setObjectName("WindowRoot")
        self.setCentralWidget(root)
        outer_layout = QVBoxLayout(root)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        outer_layout.setSpacing(0)
        self.shell = QFrame()
        self.shell.setObjectName("WindowShell")
        outer_layout.addWidget(self.shell)
        self.root_layout = QHBoxLayout(self.shell)
        self.root_layout.setContentsMargins(0, 0, 0, 0)
        self.root_layout.setSpacing(0)
        self.sidebar = QFrame()
        self.sidebar.setObjectName("Sidebar")
        self.sidebar.setFixedWidth(300)
        self.root_layout.addWidget(self.sidebar)
        self.build_sidebar()
        self.main = QFrame()
        self.main.setObjectName("MainPanel")
        self.root_layout.addWidget(self.main, 1)
        self.build_main()
        self.install_shortcuts()
        self.setup_tray_icon()
        self.tree_overlay = TreeOverlay(self.store, self.theme, self.main)
        self.tree_overlay.hide()
        self.tree_overlay.closed.connect(self.hide_tree)
        self.tree_overlay.node_selected.connect(self.enter_node_state)
        self.tree_overlay.child_requested.connect(self.create_child_node)
        self.tree_overlay.delete_requested.connect(self.delete_node)
        self.tree_overlay.rename_requested.connect(self.rename_node_dialog)
        self.tree_overlay.ai_children_requested.connect(self.generate_ai_children)
        self.load_tree_list()
        trees = self.store.list_trees()
        if trees:
            self.select_tree(trees[0]["id"])
        else:
            self.render_chat()
        QTimer.singleShot(0, self.center_on_screen)

    def build_sidebar(self) -> None:
        layout = QVBoxLayout(self.sidebar)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(16)
        top = QHBoxLayout()
        title = QLabel("Trees")
        title.setObjectName("SidebarTitle")
        add = QPushButton("New")
        add.setObjectName("Primary")
        add.setFixedSize(64, 36)
        add.clicked.connect(self.new_tree)
        top.addWidget(title)
        top.addStretch()
        top.addWidget(add)
        layout.addLayout(top)
        self.tree_list = QListWidget()
        self.tree_list.itemClicked.connect(lambda item: self.select_tree(item.data(Qt.UserRole)))
        layout.addWidget(self.tree_list, 1)
        actions = QHBoxLayout()
        self.tree_btn = QPushButton("Tree")
        self.tree_btn.setToolTip("Open Tree Mode")
        self.tree_btn.setFixedHeight(36)
        self.tree_btn.clicked.connect(self.toggle_tree)
        actions.addWidget(self.tree_btn)
        settings = QPushButton("Settings")
        settings.setFixedHeight(36)
        settings.clicked.connect(self.open_settings)
        actions.addWidget(settings)
        actions.addStretch()
        layout.addLayout(actions)

    def build_main(self) -> None:
        layout = QVBoxLayout(self.main)
        layout.setContentsMargins(34, 28, 34, 28)
        layout.setSpacing(16)
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.chat = QWidget()
        self.chat_layout = QVBoxLayout(self.chat)
        self.chat_layout.setContentsMargins(0, 10, 0, 10)
        self.chat_layout.setSpacing(14)
        self.scroll.setWidget(self.chat)
        layout.addWidget(self.scroll, 1)
        self.composer_frame = QFrame()
        self.composer_frame.setObjectName("Composer")
        self.composer_frame.setFixedHeight(56)
        composer = QHBoxLayout(self.composer_frame)
        composer.setContentsMargins(8, 7, 8, 7)
        composer.setSpacing(8)
        self.web_btn = QPushButton("Web")
        self.web_btn.setObjectName("ComposerToolButton")
        self.web_btn.setCheckable(True)
        self.web_btn.setToolTip("Use web search for this message")
        self.web_btn.setFixedHeight(40)
        self.web_btn.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Fixed)
        self.web_btn.clicked.connect(self.toggle_web_search)
        composer.addWidget(self.web_btn)
        self.ai_nodes_btn = QPushButton("AI nodes")
        self.ai_nodes_btn.setObjectName("ComposerToolButton")
        self.ai_nodes_btn.setToolTip("Let the model create child nodes from the current node")
        self.ai_nodes_btn.setFixedHeight(40)
        self.ai_nodes_btn.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Fixed)
        self.ai_nodes_btn.clicked.connect(lambda: self.current_node_id and self.generate_ai_children(self.current_node_id))
        composer.addWidget(self.ai_nodes_btn)
        self.input = QLineEdit()
        self.input.setObjectName("ComposerInput")
        self.input.setPlaceholderText("Ask anything…")
        self.input.returnPressed.connect(self.send_message)
        composer.addWidget(self.input, 1)
        self.send_btn = QPushButton()
        self.send_btn.setObjectName("AccentIcon")
        self.send_btn.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_ArrowUp))
        self.send_btn.setIconSize(QSize(18, 18))
        self.send_btn.clicked.connect(self.send_message)
        composer.addWidget(self.send_btn)
        layout.addWidget(self.composer_frame)

    def install_shortcuts(self) -> None:
        # macOS: Cmd+N. Windows/Linux: Ctrl+N.
        self.new_tree_shortcut = QShortcut(QKeySequence.StandardKey.New, self)
        self.new_tree_shortcut.setContext(Qt.ApplicationShortcut)
        self.new_tree_shortcut.activated.connect(self.new_tree)

    def setup_tray_icon(self) -> None:
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return

        icon = QIcon(ICON_PATH) if os.path.exists(ICON_PATH) else self.windowIcon()
        self.tray_icon = QSystemTrayIcon(icon, self)
        self.tray_icon.setToolTip("treeAI")

        menu = QMenu(self)
        show_action = QAction("Show treeAI", self)
        show_action.triggered.connect(self.show_from_tray)
        new_action = QAction("New Tree", self)
        new_action.setShortcut(QKeySequence.StandardKey.New)
        new_action.triggered.connect(self.new_tree)
        quit_action = QAction("Quit", self)
        quit_action.triggered.connect(QApplication.instance().quit)

        menu.addAction(show_action)
        menu.addAction(new_action)
        menu.addSeparator()
        menu.addAction(quit_action)
        self.tray_icon.setContextMenu(menu)
        self.tray_icon.activated.connect(self.on_tray_activated)
        self.tray_icon.show()

    def on_tray_activated(self, reason) -> None:
        trigger = getattr(QSystemTrayIcon.ActivationReason, "Trigger", None)
        double_click = getattr(QSystemTrayIcon.ActivationReason, "DoubleClick", None)
        if reason in (trigger, double_click):
            self.show_from_tray()

    def show_from_tray(self) -> None:
        self.show()
        self.raise_()
        self.activateWindow()

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key_Escape and self.tree_overlay.isVisible():
            self.hide_tree()
            event.accept()
            return
        super().keyPressEvent(event)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self.position_tree_overlay()

    def center_on_screen(self) -> None:
        screen = QApplication.primaryScreen()
        if screen is None:
            return
        available = screen.availableGeometry()
        self.move(available.center() - self.rect().center())

    def position_tree_overlay(self) -> None:
        if not hasattr(self, "tree_overlay"):
            return
        margin = 24
        self.tree_overlay.setGeometry(margin, margin, self.main.width() - margin * 2, self.main.height() - margin * 2)

    def discard_empty_draft_tree(self, tree_id: Optional[str] = None) -> bool:
        tree_id = tree_id or self.current_tree_id
        if not tree_id:
            return False
        try:
            if self.store.is_tree_empty(tree_id):
                self.store.delete_tree(tree_id)
                if tree_id == self.current_tree_id:
                    self.current_tree_id = None
                    self.current_node_id = None
                if tree_id == self._draft_tree_id:
                    self._draft_tree_id = None
                return True
        except RuntimeError:
            pass
        return False

    def discard_current_empty_draft_if_needed(self, next_tree_id: Optional[str] = None) -> None:
        if self.current_tree_id and self.current_tree_id != next_tree_id:
            self.discard_empty_draft_tree(self.current_tree_id)

    def load_tree_list(self) -> None:
        self.tree_list.clear()
        for tree in self.store.list_trees():
            empty = tree["message_count"] == 0
            subtitle = "Empty" if empty else self.relative_time(tree["updated_at"])
            item = QListWidgetItem()
            item.setData(Qt.UserRole, tree["id"])
            if empty:
                item.setForeground(QColor(self.theme["empty"]))
            self.tree_list.addItem(item)
            item.setSizeHint(QSize(252, 74))
            self.tree_list.setItemWidget(item, self.build_tree_list_row(tree["id"], tree["title"], subtitle, empty))

    def build_tree_list_row(self, tree_id: str, title: str, subtitle: str, empty: bool) -> QWidget:
        row = TreeListRow(tree_id, self.select_tree, self.confirm_delete_tree)
        row.setCursor(black_circle_cursor())
        layout = QHBoxLayout(row)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(0)
        labels = QVBoxLayout()
        labels.setContentsMargins(0, 0, 0, 0)
        labels.setSpacing(2)
        title_label = QLabel(title)
        title_label.setStyleSheet("font-weight: 700; background: transparent;")
        subtitle_label = QLabel(subtitle)
        subtitle_label.setObjectName("Muted" if not empty else "Empty")
        labels.addWidget(title_label)
        labels.addWidget(subtitle_label)
        layout.addLayout(labels, 1)
        return row

    def confirm_delete_tree(self, tree_id: str) -> None:
        try:
            tree = self.store.get_tree(tree_id)
        except RuntimeError:
            return
        if ask_app_confirmation(self, self.theme, "Delete tree", f"Delete \"{tree['title']}\" and all of its nodes?", "Delete"):
            self.delete_tree(tree_id)

    def delete_tree(self, tree_id: str) -> None:
        was_current = tree_id == self.current_tree_id
        self.store.delete_tree(tree_id)
        self.load_tree_list()
        trees = self.store.list_trees()
        if was_current:
            self.current_tree_id = None
            self.current_node_id = None
            self.hide_tree()
            if trees:
                self.select_tree(trees[0]["id"])
            else:
                self.render_chat()
        elif self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def set_current_tree_item(self, tree_id: str) -> None:
        for i in range(self.tree_list.count()):
            item = self.tree_list.item(i)
            if item.data(Qt.UserRole) == tree_id:
                self.tree_list.setCurrentItem(item)
                return

    @staticmethod
    def relative_time(ts: int) -> str:
        delta = max(0, int(time.time()) - ts)
        if delta < 60:
            return "Just now"
        if delta < 3600:
            return f"{delta // 60}m ago"
        if delta < 86400:
            return f"{delta // 3600}h ago"
        return f"{delta // 86400}d ago"

    def new_tree(self) -> None:
        if self.worker is not None and self.worker.isRunning():
            show_app_error(self, self.theme, "Generation in progress", "Finish or queue prompts in the current tree before creating a new one.")
            return
        self.discard_current_empty_draft_if_needed()
        tree_id = self.store.create_tree("Untitled tree")
        self._draft_tree_id = tree_id
        self.load_tree_list()
        self.select_tree(tree_id)
        self.input.setFocus()

    def select_tree(self, tree_id: str) -> None:
        if self.worker is not None and self.worker.isRunning():
            show_app_error(self, self.theme, "Generation in progress", "Wait for the current answer to finish before switching trees.")
            return
        if tree_id != self.current_tree_id:
            self.discard_current_empty_draft_if_needed(next_tree_id=tree_id)
            self.load_tree_list()
        tree = self.store.get_tree(tree_id)
        self.current_tree_id = tree_id
        self.current_node_id = tree["last_node_id"] or self.store.get_root_node(tree_id)["id"]
        self.set_current_tree_item(tree_id)
        self.render_chat()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id, preserve_view=False)

    def select_node(self, node_id: str, keep_tree_open: bool = True) -> None:
        if self.worker is not None and self.worker.isRunning():
            show_app_error(self, self.theme, "Generation in progress", "Wait for the current answer to finish before switching nodes.")
            return
        if not self.current_tree_id:
            return
        self.current_node_id = node_id
        self.store.set_last_node(self.current_tree_id, node_id)
        self.render_chat()
        self.load_tree_list()
        if keep_tree_open and self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def enter_node_state(self, node_id: str) -> None:
        self.select_node(node_id, keep_tree_open=False)
        self.hide_tree()
        self.input.setFocus()

    def create_child_node(self, parent_id: str) -> None:
        if not self.current_tree_id:
            return
        if self.tree_overlay.isVisible():
            self.tree_overlay.anchor_node_id = parent_id
        self.store.create_child_node(self.current_tree_id, parent_id, "New node")
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def rename_node_dialog(self, node_id: str) -> None:
        if not self.current_tree_id:
            return
        try:
            node = self.store.get_node(node_id)
        except RuntimeError:
            return
        title, ok = QInputDialog.getText(self, "Rename node", "Node title:", text=node["title"] or "")
        if not ok:
            return
        title = title.strip()
        if not title:
            return
        self.store.rename_node(self.current_tree_id, node_id, title)
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_node_id:
            self.tree_overlay.anchor_node_id = node_id
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def get_context_messages_for_current_path(self) -> List[Dict[str, str]]:
        if not self.current_tree_id or not self.current_node_id:
            return []
        rows = self.store.get_messages_for_path(self.current_tree_id, self.current_node_id)
        messages: List[Dict[str, str]] = []
        for row in rows:
            if row["role"] in ("user", "assistant", "system"):
                messages.append({"role": row["role"], "content": row["content"]})
        return messages

    def generate_ai_children(self, parent_id: str) -> None:
        if self.worker is not None and self.worker.isRunning():
            return
        if self.child_worker is not None and self.child_worker.isRunning():
            return
        if not self.current_tree_id:
            return
        endpoint = self.store.get_setting("endpoint", "https://api.openai.com/v1/chat/completions")
        model = self.store.get_setting("model", "gpt-4.1-mini")
        api_key = self.store.get_api_key()
        context_messages = self.get_context_messages_for_current_path()
        self.ai_nodes_btn.setEnabled(False)
        self.send_btn.setEnabled(False)
        self.input.setPlaceholderText("Creating child nodes…")
        self.child_worker = ChildNodesWorker(endpoint, api_key, model, context_messages, count=5)
        self.child_worker.finished_ok.connect(lambda titles, pid=parent_id: self.on_ai_children_ok(pid, titles))
        self.child_worker.failed.connect(self.on_ai_children_failed)
        self.child_worker.finished.connect(self.cleanup_child_worker)
        self.child_worker.start()

    def on_ai_children_ok(self, parent_id: str, titles: list) -> None:
        if not self.current_tree_id:
            self.ai_nodes_btn.setEnabled(True)
            self.send_btn.setEnabled(True)
            self.input.setPlaceholderText("Ask with web search…" if self.web_search_enabled else "Ask anything…")
            return
        created = []
        for title in titles:
            title = str(title).strip()
            if title:
                created.append(self.store.create_child_node(self.current_tree_id, parent_id, title))
        self.ai_nodes_btn.setEnabled(True)
        self.send_btn.setEnabled(True)
        self.input.setPlaceholderText("Ask with web search…" if self.web_search_enabled else "Ask anything…")
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_node_id:
            self.tree_overlay.anchor_node_id = parent_id
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        elif created:
            self.show_tree()

    def on_ai_children_failed(self, error: str) -> None:
        self.ai_nodes_btn.setEnabled(True)
        self.send_btn.setEnabled(True)
        self.input.setPlaceholderText("Ask with web search…" if self.web_search_enabled else "Ask anything…")
        show_app_error(self, self.theme, "AI children error", error)

    def cleanup_child_worker(self) -> None:
        self.child_worker = None

    def delete_node(self, node_id: str) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        fallback_id, deleted_ids = self.store.delete_node(self.current_tree_id, node_id)
        if fallback_id is None:
            return
        if self.current_node_id in deleted_ids:
            self.current_node_id = fallback_id
        self.store.set_last_node(self.current_tree_id, self.current_node_id)
        self.tree_overlay.anchor_node_id = self.current_node_id
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def clear_chat(self) -> None:
        while self.chat_layout.count():
            item = self.chat_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def render_chat(self) -> None:
        self.clear_chat()
        if not self.current_tree_id or not self.current_node_id:
            self.chat_layout.addWidget(EmptyState(self.theme, "No trees yet", "Create a tree when you are ready to start."), 1)
            return
        messages = self.store.get_messages_for_path(self.current_tree_id, self.current_node_id)
        if not messages:
            node = self.store.get_node(self.current_node_id)
            is_root = node["parent_id"] is None
            title = "Empty root" if is_root else "Empty state"
            subtitle = "Write the first message. A normal chat is just one root node." if is_root else "Write a message to continue from this node."
            self.chat_layout.addWidget(EmptyState(self.theme, title, subtitle), 1)
            return
        for message in messages:
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            bubble = ChatBubble(message["role"], message["content"], self.theme)
            if message["role"] == "user":
                row.addStretch(1)
                row.addWidget(bubble)
            else:
                row.addWidget(bubble)
                row.addStretch(1)
            wrapper = QWidget()
            wrapper.setLayout(row)
            self.chat_layout.addWidget(wrapper)
        self.chat_layout.addStretch(1)
        QApplication.processEvents()
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def toggle_web_search(self) -> None:
        self.web_search_enabled = self.web_btn.isChecked()
        self.input.setPlaceholderText("Ask with web search…" if self.web_search_enabled else "Ask anything…")

    def send_message(self) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        text = self.input.text().strip()
        if not text:
            return

        # If an answer is already streaming, the next prompt is queued instead of being lost.
        # It will be sent automatically after the current assistant response is saved.
        if self.worker is not None and self.worker.isRunning():
            self.queue_prompt(text)
            self.input.clear()
            return

        self.input.clear()
        self.store.add_message(self.current_tree_id, self.current_node_id, "user", text)
        if self.current_tree_id == self._draft_tree_id:
            self._draft_tree_id = None
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        self.call_api()

    def queue_prompt(self, text: str) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        self.prompt_queue.append(
            {
                "tree_id": self.pending_response_tree_id or self.current_tree_id,
                "node_id": self.pending_response_node_id or self.current_node_id,
                "text": text,
                "use_web": bool(self.web_search_enabled),
            }
        )
        self.add_queued_user_bubble(text)
        self.update_queue_ui()

    def add_queued_user_bubble(self, text: str) -> None:
        if self.chat_layout.count():
            last = self.chat_layout.itemAt(self.chat_layout.count() - 1)
            if last and last.spacerItem():
                self.chat_layout.takeAt(self.chat_layout.count() - 1)
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        bubble = ChatBubble("user", f"_Queued:_\n\n{text}", self.theme)
        bubble.setToolTip("This prompt is queued and will be sent after the current answer finishes.")
        row.addStretch(1)
        row.addWidget(bubble)
        wrapper = QWidget()
        wrapper.setLayout(row)
        self.chat_layout.addWidget(wrapper)
        self.chat_layout.addStretch(1)
        QApplication.processEvents()
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def update_queue_ui(self) -> None:
        count = len(self.prompt_queue)
        if self.worker is not None and self.worker.isRunning():
            if count:
                self.input.setPlaceholderText(f"Generating… {count} prompt{'s' if count != 1 else ''} queued")
            else:
                self.input.setPlaceholderText("Generating… type another prompt to queue it")
            self.send_btn.setToolTip("Add prompt to queue")
        else:
            self.input.setPlaceholderText("Ask with web search…" if self.web_search_enabled else "Ask anything…")
            self.send_btn.setToolTip("Send")

    def process_next_queued_prompt(self) -> None:
        if self.worker is not None and self.worker.isRunning():
            QTimer.singleShot(80, self.process_next_queued_prompt)
            return
        if not self.prompt_queue:
            self.update_queue_ui()
            return

        item = self.prompt_queue.pop(0)
        tree_id = str(item.get("tree_id") or "")
        node_id = str(item.get("node_id") or "")
        text = str(item.get("text") or "").strip()
        use_web = bool(item.get("use_web"))
        if not tree_id or not node_id or not text:
            self.update_queue_ui()
            QTimer.singleShot(0, self.process_next_queued_prompt)
            return

        try:
            self.store.get_tree(tree_id)
            self.store.get_node(node_id)
        except RuntimeError:
            self.update_queue_ui()
            QTimer.singleShot(0, self.process_next_queued_prompt)
            return

        self.current_tree_id = tree_id
        self.current_node_id = node_id
        self.store.set_last_node(tree_id, node_id)
        self.set_current_tree_item(tree_id)
        self.store.add_message(tree_id, node_id, "user", text)
        if tree_id == self._draft_tree_id:
            self._draft_tree_id = None
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(tree_id, node_id)
        self.call_api(use_web_override=use_web)

    def call_api(self, use_web_override: Optional[bool] = None) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        rows = self.store.get_messages_for_path(self.current_tree_id, self.current_node_id)
        messages: List[Dict[str, str]] = [
            {
                "role": "system",
                "content": "You are a helpful assistant inside a local tree-based AI chat app. Answer clearly and keep context from the selected tree path.",
            }
        ]
        for row in rows:
            if row["role"] in ("user", "assistant", "system"):
                messages.append({"role": row["role"], "content": row["content"]})
        endpoint = self.store.get_setting("endpoint", "https://api.openai.com/v1/chat/completions")
        model = self.store.get_setting("model", "gpt-4.1-mini")
        api_key = self.store.get_api_key()
        use_web = self.web_search_enabled if use_web_override is None else use_web_override
        web_query = ""
        for row in reversed(rows):
            if row["role"] == "user":
                web_query = row["content"]
                break
        self.send_btn.setEnabled(True)
        self.web_btn.setEnabled(False)
        self.ai_nodes_btn.setEnabled(False)
        self.streaming_text = ""
        self.pending_response_tree_id = self.current_tree_id
        self.pending_response_node_id = self.current_node_id
        self.add_streaming_assistant_bubble("Searching the web…" if use_web else "")
        self.worker = ApiWorker(endpoint, api_key, model, messages, stream=True, use_web_search=use_web, web_query=web_query)
        self.worker.delta.connect(self.on_api_delta)
        self.worker.status.connect(self.on_api_status)
        self.worker.finished_ok.connect(self.on_api_ok)
        self.worker.failed.connect(self.on_api_failed)
        self.worker.finished.connect(self.cleanup_worker)
        self.worker.start()
        self.update_queue_ui()

    def cleanup_worker(self) -> None:
        self.worker = None

    def stop_worker(self) -> None:
        if self.worker is None or not self.worker.isRunning():
            self.worker = None
            return
        self.worker.requestInterruption()
        if not self.worker.wait(400):
            self.worker.terminate()
            self.worker.wait(1200)
        self.worker = None
        self.pending_response_tree_id = None
        self.pending_response_node_id = None

    def stop_child_worker(self) -> None:
        if self.child_worker is None or not self.child_worker.isRunning():
            self.child_worker = None
            return
        self.child_worker.requestInterruption()
        if not self.child_worker.wait(400):
            self.child_worker.terminate()
            self.child_worker.wait(1200)
        self.child_worker = None

    def add_streaming_assistant_bubble(self, initial_text: str = "") -> None:
        if self.chat_layout.count():
            last = self.chat_layout.itemAt(self.chat_layout.count() - 1)
            if last and last.spacerItem():
                self.chat_layout.takeAt(self.chat_layout.count() - 1)
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        self.streaming_bubble = ChatBubble("assistant", initial_text, self.theme)
        row.addWidget(self.streaming_bubble)
        row.addStretch(1)
        wrapper = QWidget()
        wrapper.setLayout(row)
        self.chat_layout.addWidget(wrapper)
        self.chat_layout.addStretch(1)
        QApplication.processEvents()
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def on_api_status(self, status: str) -> None:
        if self.streaming_bubble is not None and not self.streaming_text:
            self.streaming_bubble.set_content(status)

    def on_api_delta(self, piece: str) -> None:
        self.streaming_text += piece
        if self.streaming_bubble is not None:
            self.streaming_bubble.set_content(self.streaming_text)
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def on_api_ok(self, content: str) -> None:
        final_content = content or self.streaming_text
        target_tree_id = self.pending_response_tree_id or self.current_tree_id
        target_node_id = self.pending_response_node_id or self.current_node_id
        if target_tree_id and target_node_id and final_content.strip():
            self.store.add_message(target_tree_id, target_node_id, "assistant", final_content)
        self.streaming_bubble = None
        self.streaming_text = ""
        self.pending_response_tree_id = None
        self.pending_response_node_id = None
        self.send_btn.setEnabled(True)
        self.web_btn.setEnabled(True)
        self.ai_nodes_btn.setEnabled(True)
        self.update_queue_ui()
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        if self.prompt_queue:
            QTimer.singleShot(80, self.process_next_queued_prompt)

    def on_api_failed(self, error: str) -> None:
        self.streaming_bubble = None
        self.streaming_text = ""
        self.pending_response_tree_id = None
        self.pending_response_node_id = None
        self.send_btn.setEnabled(True)
        self.web_btn.setEnabled(True)
        self.ai_nodes_btn.setEnabled(True)
        self.update_queue_ui()
        self.render_chat()
        show_app_error(self, self.theme, "API error", error)


    # -------------------------------------------------------------------------
    # v5 async/tree semantics overrides
    # -------------------------------------------------------------------------

    def has_children(self, tree_id: str, node_id: str) -> bool:
        row = self.store.conn.execute(
            "SELECT COUNT(*) AS c FROM nodes WHERE tree_id = ? AND parent_id = ?",
            (tree_id, node_id),
        ).fetchone()
        return bool(row and int(row["c"]) > 0)

    def is_leaf_node(self, tree_id: str, node_id: str) -> bool:
        return not self.has_children(tree_id, node_id)

    def node_has_active_request(self, node_id: str) -> bool:
        rid = self.node_request_id.get(node_id)
        return bool(rid and rid in self.active_requests)

    def active_request_count(self) -> int:
        return len(self.active_requests)

    def build_api_messages_for_node(self, tree_id: str, node_id: str) -> Tuple[List[Dict[str, str]], List[sqlite3.Row], str, int]:
        rows = self.store.get_messages_for_path(tree_id, node_id)
        messages: List[Dict[str, str]] = [
            {
                "role": "system",
                "content": (
                    "You are a helpful assistant inside a local tree-based AI chat app. "
                    "A selected node represents the full conversation path from root to that node. "
                    "Answer clearly and keep context from the selected tree path."
                ),
            }
        ]
        for row in rows:
            if row["role"] in ("user", "assistant", "system"):
                messages.append({"role": row["role"], "content": row["content"]})
        canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        prompt_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        token_estimate = max(1, len(canonical) // 4)
        return messages, rows, prompt_hash, token_estimate

    def remember_prompt_cache(self, prompt_hash: str, tree_id: str, node_id: str, model: str, token_estimate: int) -> None:
        now = self.store.now()
        self.store.conn.execute(
            """
            INSERT INTO prompt_cache(prompt_hash, tree_id, node_id, model, token_estimate, created_at, last_used_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(prompt_hash) DO UPDATE SET last_used_at = excluded.last_used_at
            """,
            (prompt_hash, tree_id, node_id, model, int(token_estimate), now, now),
        )
        self.store.conn.commit()

    def discard_current_empty_draft_if_needed(self, next_tree_id: Optional[str] = None) -> None:
        if not self._draft_tree_id:
            return
        if next_tree_id and next_tree_id == self._draft_tree_id:
            return
        try:
            if self.store.is_tree_empty(self._draft_tree_id):
                self.store.delete_tree(self._draft_tree_id)
        except Exception:
            pass
        self._draft_tree_id = None

    def new_tree(self) -> None:
        self.discard_current_empty_draft_if_needed()
        tree_id = self.store.create_tree("Untitled tree")
        self._draft_tree_id = tree_id
        self.load_tree_list()
        self.select_tree(tree_id)
        self.input.setFocus()

    def select_tree(self, tree_id: str) -> None:
        if tree_id != self.current_tree_id:
            self.discard_current_empty_draft_if_needed(next_tree_id=tree_id)
            self.load_tree_list()
        try:
            tree = self.store.get_tree(tree_id)
        except RuntimeError:
            return
        self.current_tree_id = tree_id
        self.current_node_id = tree["last_node_id"] or self.store.get_root_node(tree_id)["id"]
        self.set_current_tree_item(tree_id)
        self.render_chat()
        self.update_queue_ui()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id, preserve_view=False)

    def select_node(self, node_id: str, keep_tree_open: bool = True) -> None:
        if not self.current_tree_id:
            return
        try:
            self.store.get_node(node_id)
        except RuntimeError:
            return
        self.current_node_id = node_id
        self.store.set_last_node(self.current_tree_id, node_id)
        self.render_chat()
        self.update_queue_ui()
        self.load_tree_list()
        if keep_tree_open and self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def create_child_node(self, parent_id: str) -> None:
        if not self.current_tree_id:
            return
        if self.node_has_active_request(parent_id):
            self.pending_child_creations.setdefault(parent_id, []).append("New node")
            self.update_queue_ui()
            return
        if self.tree_overlay.isVisible():
            self.tree_overlay.anchor_node_id = parent_id
        self.store.create_child_node(self.current_tree_id, parent_id, "New node")
        self.load_tree_list()
        self.update_queue_ui()
        if self.tree_overlay.isVisible() and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)

    def generate_ai_children(self, parent_id: str) -> None:
        if self.node_has_active_request(parent_id):
            self.pending_ai_children_after_response.add(parent_id)
            self.update_queue_ui()
            return
        if self.child_worker is not None and self.child_worker.isRunning():
            return
        try:
            parent_node = self.store.get_node(parent_id)
        except RuntimeError:
            return
        tree_id = parent_node["tree_id"]
        endpoint = self.store.get_setting("endpoint", "https://api.openai.com/v1/chat/completions")
        model = self.store.get_setting("model", "gpt-4.1-mini")
        api_key = self.store.get_api_key()
        context_messages, _, _, _ = self.build_api_messages_for_node(tree_id, parent_id)
        # ChildNodesWorker adds its own system message, so strip our generic one.
        context_messages = [m for m in context_messages if m.get("role") != "system"]
        self.ai_nodes_btn.setEnabled(False)
        self.input.setPlaceholderText("Creating child nodes…")
        self.child_worker = ChildNodesWorker(endpoint, api_key, model, context_messages, count=5)
        self.child_worker.finished_ok.connect(lambda titles, tid=tree_id, pid=parent_id: self.on_ai_children_ok(tid, pid, titles))
        self.child_worker.failed.connect(self.on_ai_children_failed)
        self.child_worker.finished.connect(self.cleanup_child_worker)
        self.child_worker.start()

    def on_ai_children_ok(self, tree_id: str, parent_id: str, titles: list) -> None:
        created = []
        for title in titles:
            title = str(title).strip()
            if title:
                created.append(self.store.create_child_node(tree_id, parent_id, title))
        self.ai_nodes_btn.setEnabled(True)
        self.update_queue_ui()
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
            self.tree_overlay.anchor_node_id = parent_id
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        elif created and self.current_tree_id == tree_id:
            self.show_tree()

    def _add_message_row(self, role: str, content: str, tooltip: str = "") -> ChatBubble:
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        bubble = ChatBubble(role, content, self.theme)
        if tooltip:
            bubble.setToolTip(tooltip)
        if role == "user":
            row.addStretch(1)
            row.addWidget(bubble)
        else:
            row.addWidget(bubble)
            row.addStretch(1)
        wrapper = QWidget()
        wrapper.setLayout(row)
        self.chat_layout.addWidget(wrapper)
        return bubble

    def clear_chat(self) -> None:
        for state in self.active_requests.values():
            state["bubble"] = None
        while self.chat_layout.count():
            item = self.chat_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def render_chat(self) -> None:
        self.clear_chat()
        if not self.current_tree_id or not self.current_node_id:
            self.chat_layout.addWidget(EmptyState(self.theme, "No trees yet", "Create a tree when you are ready to start."), 1)
            return

        messages = self.store.get_messages_for_path(self.current_tree_id, self.current_node_id)
        if not messages:
            node = self.store.get_node(self.current_node_id)
            is_root = node["parent_id"] is None
            title = "Empty root" if is_root else "Empty leaf"
            subtitle = "Write the first message. A normal chat is just one root node." if is_root else "Write a message to continue from this leaf."
            self.chat_layout.addWidget(EmptyState(self.theme, title, subtitle), 1)
        else:
            for message in messages:
                self._add_message_row(message["role"], message["content"])

        # Show queued prompts for the selected leaf.
        for item in self.prompt_queues.get(self.current_node_id, []):
            text = str(item.get("text") or "")
            self._add_message_row("user", f"_Queued:_\n\n{text}", "This prompt will run after the current answer in this leaf finishes.")

        # Show live assistant generation for the selected leaf, if any.
        rid = self.node_request_id.get(self.current_node_id)
        if rid and rid in self.active_requests:
            state = self.active_requests[rid]
            text = str(state.get("text") or state.get("status") or "")
            state["bubble"] = self._add_message_row("assistant", text)

        self.chat_layout.addStretch(1)
        QApplication.processEvents()
        self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def send_message(self) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        text = self.input.text().strip()
        if not text:
            return
        if not self.is_leaf_node(self.current_tree_id, self.current_node_id):
            show_app_error(
                self,
                self.theme,
                "This node is not a leaf",
                "You can only write into leaf nodes. Create or select a child node to continue from this point.",
            )
            return

        self.input.clear()
        use_web = bool(self.web_search_enabled)

        # Same leaf is sequential: the next user prompt depends on the current assistant answer.
        if self.node_has_active_request(self.current_node_id):
            self.queue_prompt(self.current_tree_id, self.current_node_id, text, use_web)
            return

        self.store.add_message(self.current_tree_id, self.current_node_id, "user", text)
        if self.current_tree_id == self._draft_tree_id:
            self._draft_tree_id = None
        self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible():
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        self.call_api_for_node(self.current_tree_id, self.current_node_id, use_web_override=use_web)

    def queue_prompt(self, tree_id: str, node_id: str, text: str, use_web: bool) -> None:
        self.prompt_queues.setdefault(node_id, []).append(
            {"tree_id": tree_id, "node_id": node_id, "text": text, "use_web": bool(use_web)}
        )
        self.render_chat()
        self.update_queue_ui()

    def update_queue_ui(self) -> None:
        if self.current_node_id and self.node_has_active_request(self.current_node_id):
            count = len(self.prompt_queues.get(self.current_node_id, []))
            self.input.setPlaceholderText(
                f"Generating in this leaf… {count} queued" if count else "Generating in this leaf… type another prompt to queue it"
            )
            self.send_btn.setToolTip("Add prompt to this leaf queue")
        else:
            base = "Ask with web search…" if self.web_search_enabled else "Ask anything…"
            if self.current_tree_id and self.current_node_id and not self.is_leaf_node(self.current_tree_id, self.current_node_id):
                base = "Read-only: select a leaf node or create a child"
            active = self.active_request_count()
            self.input.setPlaceholderText(f"{base}  •  {active} running" if active else base)
            self.send_btn.setToolTip("Send")
        self.web_btn.setEnabled(True)
        self.ai_nodes_btn.setEnabled(True)

    def process_next_queued_prompt_for_node(self, node_id: str) -> None:
        queue = self.prompt_queues.get(node_id, [])
        if not queue or self.node_has_active_request(node_id):
            self.update_queue_ui()
            return
        item = queue.pop(0)
        if not queue:
            self.prompt_queues.pop(node_id, None)
        tree_id = str(item.get("tree_id") or "")
        text = str(item.get("text") or "").strip()
        use_web = bool(item.get("use_web"))
        if not tree_id or not text:
            self.update_queue_ui()
            return
        try:
            self.store.get_tree(tree_id)
            self.store.get_node(node_id)
        except RuntimeError:
            self.update_queue_ui()
            return
        if not self.is_leaf_node(tree_id, node_id):
            # The queued prompt cannot be applied after this node became an internal branch point.
            # Keep tree semantics strict: only leaves are writable.
            self.update_queue_ui()
            return
        self.store.add_message(tree_id, node_id, "user", text)
        self.store.set_last_node(tree_id, node_id)
        if tree_id == self._draft_tree_id:
            self._draft_tree_id = None
        if self.current_tree_id == tree_id and self.current_node_id == node_id:
            self.render_chat()
        self.load_tree_list()
        if self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        self.call_api_for_node(tree_id, node_id, use_web_override=use_web)

    def call_api(self, use_web_override: Optional[bool] = None) -> None:
        if self.current_tree_id and self.current_node_id:
            self.call_api_for_node(self.current_tree_id, self.current_node_id, use_web_override=use_web_override)

    def call_api_for_node(self, tree_id: str, node_id: str, use_web_override: Optional[bool] = None) -> None:
        if self.node_has_active_request(node_id):
            return
        messages, rows, prompt_hash, token_estimate = self.build_api_messages_for_node(tree_id, node_id)
        endpoint = self.store.get_setting("endpoint", "https://api.openai.com/v1/chat/completions")
        model = self.store.get_setting("model", "gpt-4.1-mini")
        api_key = self.store.get_api_key()
        self.remember_prompt_cache(prompt_hash, tree_id, node_id, model, token_estimate)
        use_web = self.web_search_enabled if use_web_override is None else bool(use_web_override)
        web_query = ""
        for row in reversed(rows):
            if row["role"] == "user":
                web_query = row["content"]
                break

        request_id = str(uuid.uuid4())
        worker = ApiWorker(endpoint, api_key, model, messages, stream=True, use_web_search=use_web, web_query=web_query)
        self.active_requests[request_id] = {
            "worker": worker,
            "tree_id": tree_id,
            "node_id": node_id,
            "text": "",
            "status": "Searching the web…" if use_web else "",
            "bubble": None,
            "prompt_hash": prompt_hash,
            "token_estimate": token_estimate,
        }
        self.node_request_id[node_id] = request_id
        if self.current_tree_id == tree_id and self.current_node_id == node_id:
            self.render_chat()

        worker.delta.connect(lambda piece, rid=request_id: self.on_api_delta_for_request(rid, piece))
        worker.status.connect(lambda status, rid=request_id: self.on_api_status_for_request(rid, status))
        worker.finished_ok.connect(lambda content, rid=request_id: self.on_api_ok_for_request(rid, content))
        worker.failed.connect(lambda error, rid=request_id: self.on_api_failed_for_request(rid, error))
        worker.finished.connect(lambda rid=request_id: self.cleanup_worker_for_request(rid))
        worker.start()
        self.update_queue_ui()

    def cleanup_worker(self) -> None:
        # Kept for compatibility with old signal connections.
        pass

    def cleanup_worker_for_request(self, request_id: str) -> None:
        state = self.active_requests.get(request_id)
        if state and state.get("worker") is not None and state.get("node_id") in self.node_request_id:
            # Actual removal is handled in success/error handlers so queued prompts can start with a saved answer.
            pass

    def stop_worker(self) -> None:
        for request_id, state in list(self.active_requests.items()):
            worker = state.get("worker")
            if worker is not None and worker.isRunning():
                worker.requestInterruption()
                if not worker.wait(400):
                    worker.terminate()
                    worker.wait(1200)
            node_id = str(state.get("node_id") or "")
            if node_id:
                self.node_request_id.pop(node_id, None)
            self.active_requests.pop(request_id, None)

    def on_api_status_for_request(self, request_id: str, status: str) -> None:
        state = self.active_requests.get(request_id)
        if not state:
            return
        if not state.get("text"):
            state["status"] = status
            bubble = state.get("bubble")
            if bubble is not None:
                bubble.set_content(status)

    def on_api_delta_for_request(self, request_id: str, piece: str) -> None:
        state = self.active_requests.get(request_id)
        if not state:
            return
        state["text"] = str(state.get("text") or "") + piece
        bubble = state.get("bubble")
        if bubble is not None:
            bubble.set_content(str(state["text"]))
            self.scroll.verticalScrollBar().setValue(self.scroll.verticalScrollBar().maximum())

    def _finish_request_common(self, request_id: str) -> Optional[Dict[str, Any]]:
        state = self.active_requests.pop(request_id, None)
        if not state:
            return None
        node_id = str(state.get("node_id") or "")
        if node_id:
            self.node_request_id.pop(node_id, None)
        return state

    def on_api_ok_for_request(self, request_id: str, content: str) -> None:
        state = self._finish_request_common(request_id)
        if not state:
            return
        tree_id = str(state.get("tree_id") or "")
        node_id = str(state.get("node_id") or "")
        final_content = content or str(state.get("text") or "")
        if tree_id and node_id and final_content.strip():
            self.store.add_message(tree_id, node_id, "assistant", final_content)

        # Deferred child creation is done after the assistant answer is saved,
        # so new chats start from the complete shared past and benefit from API prompt caching.
        # If same-leaf prompts are queued, keep the node writable until the queue drains.
        has_same_node_queue = bool(self.prompt_queues.get(node_id))
        if not has_same_node_queue:
            for title in self.pending_child_creations.pop(node_id, []):
                self.store.create_child_node(tree_id, node_id, title or "New node")
            should_ai_children = node_id in self.pending_ai_children_after_response
            self.pending_ai_children_after_response.discard(node_id)
        else:
            should_ai_children = False

        self.load_tree_list()
        if self.current_tree_id == tree_id and self.current_node_id == node_id:
            self.render_chat()
        else:
            self.update_queue_ui()
        if self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
            self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)
        QTimer.singleShot(60, lambda nid=node_id: self.process_next_queued_prompt_for_node(nid))
        if should_ai_children and self.current_tree_id == tree_id:
            QTimer.singleShot(120, lambda pid=node_id: self.generate_ai_children(pid))

    def on_api_failed_for_request(self, request_id: str, error: str) -> None:
        state = self._finish_request_common(request_id)
        if not state:
            return
        tree_id = str(state.get("tree_id") or "")
        node_id = str(state.get("node_id") or "")
        if self.current_tree_id == tree_id and self.current_node_id == node_id:
            self.render_chat()
        self.update_queue_ui()
        show_app_error(self, self.theme, "API error", error)
        QTimer.singleShot(60, lambda nid=node_id: self.process_next_queued_prompt_for_node(nid))

    # Compatibility shims for old ApiWorker callbacks. New code uses request-specific handlers.
    def add_streaming_assistant_bubble(self, initial_text: str = "") -> None:
        pass

    def on_api_status(self, status: str) -> None:
        pass

    def on_api_delta(self, piece: str) -> None:
        pass

    def on_api_ok(self, content: str) -> None:
        pass

    def on_api_failed(self, error: str) -> None:
        show_app_error(self, self.theme, "API error", error)

    def toggle_tree(self) -> None:
        self.hide_tree() if self.tree_overlay.isVisible() else self.show_tree()

    def show_tree(self) -> None:
        if not self.current_tree_id or not self.current_node_id:
            return
        self.position_tree_overlay()
        self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id, preserve_view=False)
        self.tree_overlay.show()
        self.tree_overlay.raise_()
        self.tree_overlay.view.setFocus()

    def hide_tree(self) -> None:
        self.tree_overlay.hide()

    def closeEvent(self, event) -> None:
        self.discard_current_empty_draft_if_needed()
        self.prompt_queues.clear()
        self.stop_worker()
        self.stop_child_worker()
        super().closeEvent(event)

    def open_settings(self) -> None:
        dialog = SettingsDialog(self.store, self)
        if dialog.exec():
            self.theme_name = self.store.get_setting("theme", "Minimal Light")
            self.theme = THEMES.get(self.theme_name, THEMES["Minimal Light"])
            apply_theme(QApplication.instance(), self.theme)
            self.tree_overlay.set_theme(self.theme)
            self.render_chat()
            self.load_tree_list()
            if self.tree_overlay.isVisible() and self.current_tree_id and self.current_node_id:
                self.tree_overlay.load_tree(self.current_tree_id, self.current_node_id)


def main() -> None:
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName(APP_NAME)
    if os.path.exists(ICON_PATH):
        app.setWindowIcon(QIcon(ICON_PATH))
    install_exception_hook(app)
    app.setOverrideCursor(black_circle_cursor())
    window = MainWindow()
    if os.path.exists(ICON_PATH):
        window.setWindowIcon(QIcon(ICON_PATH))
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
