"""
A tiny Chrome DevTools Protocol client (Python standard library only), used by
smoke_browser.py to drive headless Chrome: open pages, run JavaScript, switch
the network off, fake a GPS position. No third-party packages.
"""
import base64
import json
import os
import socket
import struct
import subprocess
import time
import urllib.request


class CDPError(RuntimeError):
    pass


class _WebSocket:
    def __init__(self, url: str, timeout: float = 30.0):
        assert url.startswith("ws://")
        hostport, path = url[5:].split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
             f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
        )
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CDPError("websocket handshake failed")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise CDPError(f"websocket handshake refused: {head[:80]!r}")
        self.buf = head.split(b"\r\n\r\n", 1)[1]

    def send(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            header = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + mask + masked)

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise CDPError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self) -> str:
        message = b""
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            payload = self._read(n)
            opcode = b1 & 0x0F
            if opcode == 8:
                raise CDPError("websocket closed by Chrome")
            if opcode in (0, 1, 2):
                message += payload
                if b1 & 0x80:
                    return message.decode("utf-8", "replace")
            # ping/pong frames are ignored


class Chrome:
    """Headless Chrome with its own empty profile, controlled over CDP."""

    def __init__(self, profile_dir: str, port: int = 9333, binary: str = "google-chrome"):
        self.proc = subprocess.Popen(
            [binary, "--headless=new", "--no-sandbox", "--disable-gpu", f"--remote-debugging-port={port}",
             f"--user-data-dir={profile_dir}", "--no-first-run", "--window-size=412,915", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.port = port
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as r:
                    json.load(r)
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise CDPError("Chrome did not start")
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
            page = next(t for t in json.load(r) if t["type"] == "page")
        self.ws = _WebSocket(page["webSocketDebuggerUrl"])
        self._id = 0
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.call("Network.enable")

    def call(self, method: str, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise CDPError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expression: str, timeout_s: float = 30):
        """Run JavaScript (may be async) in the page and return its JSON value."""
        res = self.call(
            "Runtime.evaluate", expression=f"(async () => {{ {expression} }})()",
            awaitPromise=True, returnByValue=True, timeout=int(timeout_s * 1000),
        )
        if res.get("exceptionDetails"):
            raise CDPError(f"page error: {res['exceptionDetails'].get('exception', {}).get('description', res)}")
        return res.get("result", {}).get("value")

    def goto(self, url: str, settle_s: float = 2.5) -> None:
        self.call("Page.navigate", url=url)
        time.sleep(settle_s)

    def offline(self, on: bool) -> None:
        self.call("Network.emulateNetworkConditions", offline=on, latency=0,
                  downloadThroughput=-1, uploadThroughput=-1)

    def gps(self, lat: float, lon: float, accuracy: float = 8, origin: str | None = None) -> None:
        if origin:
            self.call("Browser.grantPermissions", origin=origin, permissions=["geolocation"])
        self.call("Emulation.setGeolocationOverride", latitude=lat, longitude=lon, accuracy=accuracy)

    def close(self) -> None:
        try:
            self.call("Browser.close")
        except Exception:  # noqa: BLE001
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
