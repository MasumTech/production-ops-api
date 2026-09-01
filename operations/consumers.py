from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import event_queryset_for_user, serialize_event

REPLAY_LIMIT = 100


@database_sync_to_async
def _replay_for_user(user, after):
    queryset = event_queryset_for_user(user)
    latest_cursor = queryset.order_by("-id").values_list("id", flat=True).first() or 0
    events = list(queryset.filter(id__gt=after).order_by("id")[: REPLAY_LIMIT + 1])
    overflow = len(events) > REPLAY_LIMIT
    return (
        [serialize_event(event) for event in events[:REPLAY_LIMIT]],
        latest_cursor,
        overflow,
    )


class OperationalEventConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return

        try:
            after = int(
                parse_qs(self.scope["query_string"].decode()).get("after", ["0"])[0]
            )
            if after < 0:
                raise ValueError
        except (TypeError, ValueError):
            await self.close(code=4400)
            return

        self.groups_for_user = [f"operations.user.{user.id}"]
        if user.is_staff:
            self.groups_for_user.append("operations.staff")
        for group in self.groups_for_user:
            await self.channel_layer.group_add(group, self.channel_name)

        await self.accept(subprotocol="operations.v1")
        events, latest_cursor, overflow = await _replay_for_user(user, after)
        if overflow:
            await self.send_json(
                {"type": "resync_required", "cursor": latest_cursor},
            )
            return
        for event in events:
            await self.send_json({"type": "event", "event": event})
        await self.send_json({"type": "ready", "cursor": latest_cursor})

    async def disconnect(self, close_code):
        for group in getattr(self, "groups_for_user", ()):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def operational_event(self, event):
        await self.send_json({"type": "event", "event": event["event"]})
