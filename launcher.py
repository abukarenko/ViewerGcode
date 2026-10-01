"""Local ViewerGcode server and desktop launcher (Python standard library)."""
import json
import queue
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import socket
import threading
import urllib.error
import urllib.request
import webbrowser

HOST, PORT = "127.0.0.1", 4173
URL = f"http://{HOST}:{PORT}"
IDENTITY = "ViewerGcode-launcher-1"
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "cnc-viewer"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript; charset=utf-8",
                      ".css": "text/css; charset=utf-8",
                      ".html": "text/html; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/__viewer_launcher__":
            body = json.dumps({"application": IDENTITY}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(403)
        return None

    def log_message(self, format, *args):
        pass


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def create_server(root=ROOT, port=PORT):
    if not (root / "index.html").is_file():
        raise FileNotFoundError(f"Не найден файл: {root / 'index.html'}")
    return LocalServer((HOST, port), partial(Handler, directory=str(root)))


def validate_port(value):
    text = str(value).strip()
    if not text.isascii() or not text.isdecimal() or not 1024 <= int(text) <= 65535:
        raise ValueError("Введите целый номер порта от 1024 до 65535.")
    return int(text)


def settings_path():
    return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ViewerGcode" / "launcher.json"


def load_port(path=None):
    try:
        return validate_port(json.loads((path or settings_path()).read_text(encoding="utf-8"))["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return PORT


def save_port(port, path=None):
    path = path or settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"port": validate_port(port)}), encoding="utf-8")
    temporary.replace(path)


def already_running(port=PORT):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://{HOST}:{port}/__viewer_launcher__", timeout=1) as response:
            return json.load(response).get("application") == IDENTITY
    except (OSError, ValueError, urllib.error.URLError):
        return False


def main():
    import tkinter as tk
    from tkinter import messagebox, ttk
    import pystray
    from PIL import Image

    silent = "--tray" in sys.argv
    window = tk.Tk()
    window.withdraw()
    window.title("ViewerGcode — локальный сервер")
    icon_path = ROOT.parent / "assets" / "ViewerGcode.ico"
    window.iconbitmap(str(icon_path))
    port = load_port()
    server = None
    thread = None
    startup_error = ""
    try:
        server = create_server(port=port)
    except OSError as error:
        if already_running(port):
            if not silent:
                webbrowser.open(f"http://{HOST}:{port}")
            window.destroy()
            return
        startup_error = f"Не удалось запустить сервер на порту {port}. Выберите другой порт.\n{error}"
    if server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

    port_var = tk.StringVar(value=str(port))
    status_var = tk.StringVar()
    address_var = tk.StringVar()

    def refresh():
        address_var.set(f"http://{HOST}:{port}" if server else "Сервер не запущен")
        status_var.set("ViewerGcode запущен" if server else "Выберите порт сервера")
        tray.title = f"ViewerGcode — {port}" if server else "ViewerGcode — сервер не запущен"

    def open_browser():
        if not server:
            show_window()
            return
        url = f"http://{HOST}:{port}"
        if not webbrowser.open(url):
            messagebox.showinfo("ViewerGcode", f"Откройте в браузере:\n{url}")

    def restart():
        nonlocal thread, server, port
        replacement = None
        try:
            selected = validate_port(port_var.get())
            if not server or selected != port:
                replacement = create_server(port=selected)
            save_port(selected)
        except (OSError, ValueError) as error:
            if replacement:
                replacement.server_close()
            messagebox.showerror("ViewerGcode", f"Не удалось применить порт.\n\n{error}")
            return
        if server:
            server.shutdown()
            thread.join()
            if replacement:
                server.server_close()
        if replacement:
            server = replacement
        port = selected
        port_var.set(str(port))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        refresh()
        open_browser()

    closing = False

    def stop():
        nonlocal closing
        if not messagebox.askokcancel("Остановить сервер?",
                                     "Завершите работу с контроллером и сохраните изменения в браузере.\n\n"
                                     "Закрытие сервера не останавливает станок. Остановить сервер?"):
            return
        if server:
            server.shutdown()
            server.server_close()
        tray.stop()
        closing = True
        window.destroy()

    def show_window():
        window.deiconify()
        window.lift()

    # Tray callbacks run on a separate thread; Tk operations stay on its main thread.
    actions = queue.Queue()

    def enqueue(action):
        def callback(icon, item):
            actions.put(action)
        return callback

    tray = pystray.Icon("ViewerGcode", Image.open(icon_path), "ViewerGcode — сервер работает",
                        menu=pystray.Menu(
                            pystray.MenuItem("Открыть браузер", enqueue(open_browser), default=True),
                            pystray.MenuItem("Показать запускатель", enqueue(show_window)),
                            pystray.MenuItem("Перезапустить сервер", enqueue(restart)),
                            pystray.Menu.SEPARATOR,
                            pystray.MenuItem("Выход", enqueue(stop))))

    def poll_actions():
        try:
            action = actions.get_nowait()
        except queue.Empty:
            pass
        else:
            action()
            if closing:
                return
        window.after(100, poll_actions)

    window.resizable(False, False)
    panel = ttk.Frame(window, padding=24)
    panel.pack()
    ttk.Label(panel, textvariable=status_var, font=("Segoe UI", 14)).pack(pady=(0, 10))
    ttk.Label(panel, textvariable=address_var).pack()
    port_row = ttk.Frame(panel)
    port_row.pack(fill="x", pady=12)
    ttk.Label(port_row, text="Порт сервера:").pack(side="left", padx=(0, 12))
    port_input = ttk.Spinbox(port_row, from_=1024, to=65535, textvariable=port_var, width=10)
    port_input.pack(side="right")
    port_input.bind("<Return>", lambda event: restart())
    ttk.Label(panel, text="При смене порта настройки браузера будут отдельными.",
              foreground="#805a20").pack()
    ttk.Label(panel, text="Крестик скрывает окно в трей. Выход — через меню значка.\n"
                         "Для USB/Serial используйте Chrome или Edge.", justify="center").pack(pady=12)
    ttk.Button(panel, text="Открыть браузер", command=open_browser).pack(fill="x", pady=4)
    ttk.Button(panel, text="Применить порт и перезапустить", command=restart).pack(fill="x", pady=4)
    window.protocol("WM_DELETE_WINDOW", window.withdraw)
    refresh()
    tray.run_detached()
    window.after(100, poll_actions)
    if startup_error:
        show_window()
        window.after(200, lambda: messagebox.showerror("ViewerGcode", startup_error))
    elif not silent:
        show_window()
        window.after(200, open_browser)
    window.mainloop()


if __name__ == "__main__":
    main()
