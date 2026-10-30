"""Refuse request bodies over a size limit (ASGI middleware)."""


class _TooLarge(Exception):
    pass


class BodySizeLimit:
    """
    A stated Content-Length over the limit is refused before anything is read;
    a body sent without one (chunked) is counted as it arrives and refused
    once it passes the limit. Answers 413.
    """

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def _refuse(self, send):
        body = b'{"detail":"Request too large"}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and length.isdigit() and int(length) > self.max_bytes:
            return await self._refuse(send)
        seen = 0
        over = False
        sent_own = False

        async def counted_receive():
            nonlocal seen, over
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    over = True
                    raise _TooLarge()
            return message

        async def guarded_send(message):
            # Once the limit is passed the app's own answer (FastAPI says "400
            # error parsing the body") is replaced by a clear 413.
            nonlocal sent_own
            if over:
                if not sent_own:
                    sent_own = True
                    await self._refuse(send)
                return
            await send(message)

        try:
            await self.app(scope, counted_receive, guarded_send)
        except _TooLarge:
            pass
        if over and not sent_own:
            await self._refuse(send)
