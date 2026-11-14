"""download.fetch keeps a file only when all of it arrived, and download.trreb tells a report
that isn't posted yet (HTTP 404) from one it couldn't reach.

    python -m unittest discover -s pipeline/tests
"""
import contextlib
import http.server
import io
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import download  # noqa: E402

BODY = b"%PDF" + b"x" * 5000


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/whole":
            self.send_response(200)
            self.send_header("Content-Length", str(len(BODY)))
            self.end_headers()
            self.wfile.write(BODY)
        elif path == "/cut-short":  # says 1,000,000 bytes, sends 5,004, hangs up
            self.send_response(200)
            self.send_header("Content-Length", "1000000")
            self.end_headers()
            self.wfile.write(BODY)
        elif path == "/moved":
            self.send_error(500)
        else:
            self.send_error(404)

    def log_message(self, *args):
        pass


def quiet(fn, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        # the test server is on this machine: don't send its requests through a proxy
        cls.enterClassContext(mock.patch.dict("os.environ", {"no_proxy": "127.0.0.1", "NO_PROXY": "127.0.0.1"}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))


class Fetch(Server):
    def test_a_whole_file_is_kept(self):
        dest = self.dir / "a.pdf"
        self.assertTrue(quiet(download.fetch, f"{self.base}/whole", dest, b"%PDF"))
        self.assertEqual(dest.read_bytes(), BODY)

    def test_a_file_cut_short_is_not_kept(self):
        dest, errors = self.dir / "a.pdf", []
        self.assertFalse(quiet(download.fetch, f"{self.base}/cut-short", dest, b"%PDF", errors=errors))
        self.assertFalse(dest.exists())
        self.assertFalse(dest.with_name("a.pdf.part").exists())
        self.assertIn("incomplete", str(errors[0]))

    def test_the_wrong_kind_of_file_is_not_kept(self):
        dest = self.dir / "a.zip"
        self.assertFalse(quiet(download.fetch, f"{self.base}/whole", dest, b"PK"))
        self.assertFalse(dest.exists())

    def test_the_reason_for_a_failure_is_passed_back(self):
        errors = []
        quiet(download.fetch, f"{self.base}/absent", self.dir / "a.pdf", b"%PDF", errors=errors)
        self.assertEqual([e.code for e in errors], [404])


class Trreb(Server):
    """community.csv ends at 2025 Q3 and "today" is February 2026: the one quarter to ask for is 2025 Q4."""

    def run_trreb(self, path):
        done = self.dir / "community.csv"
        done.write_text("year,q\n2025,3\n")
        today = mock.Mock(tm_year=2026, tm_mon=2)  # the last finished quarter is 2025 Q4
        with mock.patch.object(download, "TRREB_DONE", done), mock.patch.object(download, "TRREB_DIR", self.dir / "reports"), \
                mock.patch.object(download, "TRREB_URL", f"{self.base}/{path}?{{y}}{{q}}{{r}}"), \
                mock.patch.object(download.time, "localtime", return_value=today), mock.patch.object(download.time, "sleep"):
            return quiet(download.trreb)

    def test_a_404_is_a_quarter_not_posted_yet(self):
        self.assertEqual(self.run_trreb("absent"), ([], []))

    def test_any_other_failure_is_reported(self):
        got, failed = self.run_trreb("moved")
        self.assertEqual(got, [])
        self.assertEqual([name for name, _ in failed], ["TRREB 2025 Q4"])

    def test_a_posted_quarter_is_fetched(self):
        got, failed = self.run_trreb("whole")
        self.assertEqual((got, failed), (["2025 Q4"], []))
        self.assertEqual(len(list((self.dir / "reports").glob("*.pdf"))), 3)


if __name__ == "__main__":
    unittest.main()
