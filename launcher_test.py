import tempfile
import threading
import unittest
from pathlib import Path
import launcher

class LauncherTests(unittest.TestCase):
    def test_port_validation(self):
        for value in ('', '80', '65536', '4173.0', '-1', True):
            with self.assertRaises(ValueError):
                launcher.validate_port(value)
        self.assertEqual(launcher.validate_port(' 5000 '), 5000)

    def test_settings_roundtrip_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            self.assertEqual(launcher.load_port(path), 4173)
            launcher.save_port(5001, path)
            self.assertEqual(launcher.load_port(path), 5001)
            path.write_text('{broken')
            self.assertEqual(launcher.load_port(path), 4173)
            path.write_text('{"port": 0}')
            self.assertEqual(launcher.load_port(path), 4173)

    def test_conflict_preserves_existing_server(self):
        server = launcher.create_server(port=0)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertTrue(launcher.already_running(port))
            with self.assertRaises(OSError):
                launcher.create_server(port=port)
            self.assertTrue(launcher.already_running(port))
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

if __name__ == '__main__':
    unittest.main()
