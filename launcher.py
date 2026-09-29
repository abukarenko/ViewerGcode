"""Local ViewerGcode server and desktop launcher (Python standard library)."""
import json
import queue
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


def already_running():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(URL + "/__viewer_launcher__", timeout=1) as response:
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
    try:
        server = create_server()
    except OSError as error:
        if already_running():
            if not silent:
                webbrowser.open(URL)
        else:
            messagebox.showerror("ViewerGcode", f"Не удалось запустить сервер.\n\n{error}\n\n"
                                 f"Если порт {PORT} занят, закройте другой сервер и повторите запуск.")
        window.destroy()
        return

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def open_browser():
        if not webbrowser.open(URL):
            messagebox.showinfo("ViewerGcode", f"Откройте в браузере:\n{URL}")

    def restart():
        nonlocal thread
        server.shutdown()
        thread.join()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        open_browser()

    closing = False

    def stop():
        nonlocal closing
        if not messagebox.askokcancel("Остановить сервер?",
                                     "Завершите работу с контроллером и сохраните изменения в браузере.\n\n"
                                     "Закрытие сервера не останавливает станок. Остановить сервер?"):
            return
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
    ttk.Label(panel, text="ViewerGcode запущен", font=("Segoe UI", 14)).pack(pady=(0, 10))
    ttk.Label(panel, text=URL).pack()
    ttk.Label(panel, text="Крестик скрывает окно в трей. Выход — через меню значка.\n"
                         "Для USB/Serial используйте Chrome или Edge.", justify="center").pack(pady=12)
    ttk.Button(panel, text="Открыть браузер", command=open_browser).pack(fill="x", pady=4)
    ttk.Button(panel, text="Перезапустить сервер", command=restart).pack(fill="x", pady=4)
    window.protocol("WM_DELETE_WINDOW", window.withdraw)
    tray.run_detached()
    window.after(100, poll_actions)
    if not silent:
        window.after(200, open_browser)
    window.mainloop()


if __name__ == "__main__":
    main()
