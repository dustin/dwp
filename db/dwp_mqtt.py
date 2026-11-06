"""Just enough MQTT 3.1.1 (QoS 0) for publishd and its callers: no
dependencies, so it runs anywhere python3 does. bot/mqtt_weather.py has
its own copy of the framing for the weather feed.

    send(host, topic, payload, retain=False)
    with Client(host, [topic, ...]) as c:
        for topic, payload in c.messages(timeout): ...
"""

import socket
import struct
import time

KEEPALIVE = 60


def _str(s):
    b = s.encode()
    return struct.pack(">H", len(b)) + b


def _packet(kind, body):
    n, length = len(body), b""
    while True:
        n, digit = divmod(n, 128)
        length += bytes([digit | (0x80 if n else 0)])
        if not n:
            return bytes([kind]) + length + body


def _read(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("broker closed the connection")
        buf += chunk
    return buf


def _next(sock):
    kind = _read(sock, 1)[0]
    n, shift = 0, 0
    while True:
        digit = _read(sock, 1)[0]
        n += (digit & 0x7F) << shift
        shift += 7
        if not digit & 0x80:
            return kind, _read(sock, n)


def _addr(host):
    h, _, p = host.rpartition(":") if ":" in host else (host, "", "1883")
    return h, int(p)


class Client:
    """A connection subscribed to topics (QoS 0)."""

    def __init__(self, host, topics=(), name="dwp"):
        self.sock = socket.create_connection(_addr(host), timeout=KEEPALIVE / 2)
        self.sock.sendall(_packet(0x10, _str("MQTT") + bytes([4, 0x02]) + struct.pack(">H", KEEPALIVE)
                                  + _str(f"{name}-{socket.gethostname()}-{time.time_ns()}")))
        kind, body = _next(self.sock)
        if kind >> 4 != 2 or body[1] != 0:
            raise ConnectionError(f"connect refused ({body[1:2].hex()})")
        if topics:
            self.sock.sendall(_packet(0x82, struct.pack(">H", 1) + b"".join(_str(t) + b"\0" for t in topics)))
            kind, _ = _next(self.sock)  # SUBACK, so nothing sent after this is missed
            if kind >> 4 != 9:
                raise ConnectionError("no SUBACK")
        self.heard = time.time()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            self.sock.sendall(b"\xe0\0")  # DISCONNECT
        except OSError:
            pass
        self.sock.close()

    def send(self, topic, payload, retain=False):
        if isinstance(payload, str):
            payload = payload.encode()
        self.sock.sendall(_packet(0x30 | (1 if retain else 0), _str(topic) + payload))

    def messages(self, timeout=None):
        """(topic, payload bytes) as they come; stops after timeout seconds
        (None: never). Keeps the connection alive meanwhile."""
        end = None if timeout is None else time.time() + timeout
        while end is None or time.time() < end:
            if end is not None:
                self.sock.settimeout(max(0.1, min(KEEPALIVE / 2, end - time.time())))
            try:
                kind, body = _next(self.sock)
                self.heard = time.time()
            except socket.timeout:
                if time.time() - self.heard > 2 * KEEPALIVE:
                    raise ConnectionError("broker stopped answering")
                self.sock.sendall(b"\xc0\0")  # PINGREQ
                continue
            if kind >> 4 == 3:
                n = struct.unpack(">H", body[:2])[0]
                yield body[2:2 + n].decode(), body[2 + n + (2 if kind & 0x06 else 0):]


def send(host, topic, payload, retain=False):
    with Client(host) as c:
        c.send(topic, payload, retain)
