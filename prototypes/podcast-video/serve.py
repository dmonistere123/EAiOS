"""Loopback-only staging server with video byte-range support."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re


class ReviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.remaining = None
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / 'index.html'
        if not path.is_file():
            self.send_error(404)
            return None
        size = path.stat().st_size
        start, end = 0, size - 1
        requested = self.headers.get('Range')
        if requested:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
            try:
                if not match or not any(match.groups()):
                    raise ValueError()
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                else:
                    start = max(0, size - int(last))
                if start > end or start >= size:
                    raise ValueError()
            except ValueError:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
        self.send_response(206 if requested else 200)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Cache-Control', 'no-cache')
        if requested:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        source = path.open('rb')
        source.seek(start)
        self.remaining = end - start + 1
        return source

    def copyfile(self, source, outputfile):
        try:
            while self.remaining:
                data = source.read(min(65536, self.remaining))
                if not data:
                    break
                outputfile.write(data)
                self.remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A seek may cancel the previous media request.


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--port', type=int, default=5291)
    args = parser.parse_args()
    if not args.directory.is_dir():
        parser.error('Review directory does not exist')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(ReviewHandler, directory=str(args.directory.resolve())))
    print(f'Review: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
