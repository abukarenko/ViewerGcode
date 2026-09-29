import threading
import unittest
import urllib.error
import urllib.request

import launcher


class ServerTests(unittest.TestCase):
    def test_bundle_and_server(self):
        server = launcher.create_server(port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for path, mime in [("/", "text/html"), ("/app.js", "text/javascript"),
                               ("/style.css", "text/css")]:
                with opener.open(base + path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(mime, response.headers["Content-Type"])
                    self.assertGreater(len(response.read()), 0)
            with opener.open(base + "/__viewer_launcher__") as response:
                self.assertIn(launcher.IDENTITY.encode(), response.read())
            for path in ["/../launcher.py", "/%2e%2e/launcher.py", "/examples/"]:
                with self.assertRaises(urllib.error.HTTPError):
                    opener.open(base + path)
            with self.assertRaises(OSError):
                launcher.create_server(port=server.server_port)
            server.shutdown()
            thread.join()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            with opener.open(base + "/") as response:
                self.assertEqual(response.status, 200)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
