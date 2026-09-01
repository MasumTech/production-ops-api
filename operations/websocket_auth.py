from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _user_for_token(token):
    try:
        validated = AccessToken(token)
        user_id = validated.get("user_id")
        if user_id is None:
            return AnonymousUser()
        return get_user_model().objects.get(id=user_id, is_active=True)
    except (InvalidToken, TokenError, get_user_model().DoesNotExist):
        return AnonymousUser()


class JWTSubprotocolAuthMiddleware:
    """Authenticate a socket without placing its JWT in the request URL."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = next(
            (
                protocol.removeprefix("jwt.")
                for protocol in scope.get("subprotocols", ())
                if protocol.startswith("jwt.")
            ),
            None,
        )
        scope = dict(scope)
        scope["user"] = await _user_for_token(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)
