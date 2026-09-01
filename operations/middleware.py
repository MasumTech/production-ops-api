import hashlib
import json
import uuid

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import IdempotentRequest


class IdempotencyMiddleware:
    """Make authenticated API POST retries safe for offline outbox replay."""

    header_name = "HTTP_IDEMPOTENCY_KEY"

    def __init__(self, get_response):
        self.get_response = get_response
        self.jwt_authentication = JWTAuthentication()

    def __call__(self, request):
        raw_key = request.META.get(self.header_name)
        if (
            request.method != "POST"
            or not request.path.startswith("/api/")
            or not raw_key
        ):
            return self.get_response(request)

        try:
            key = uuid.UUID(raw_key)
        except (TypeError, ValueError, AttributeError):
            return JsonResponse(
                {"detail": "Idempotency-Key must be a valid UUID."},
                status=400,
            )

        try:
            authenticated = self.jwt_authentication.authenticate(request)
        except AuthenticationFailed:
            return self.get_response(request)
        if authenticated is None:
            return self.get_response(request)

        user, _ = authenticated
        request_hash = self._request_hash(request)
        claim, replay = self._claim(user, key, request, request_hash)
        if replay is not None:
            return replay

        response = self.get_response(request)
        if response.status_code >= 500:
            claim.delete()
            return response

        if hasattr(response, "render") and not getattr(response, "is_rendered", True):
            response.render()

        claim.response_status = response.status_code
        claim.response_body = self._response_body(response)
        claim.completed_at = timezone.now()
        claim.save(
            update_fields=("response_status", "response_body", "completed_at"),
        )
        return response

    @staticmethod
    def _request_hash(request):
        digest = hashlib.sha256()
        digest.update(request.method.encode())
        digest.update(b"\0")
        digest.update(request.get_full_path().encode())
        digest.update(b"\0")
        digest.update(request.body)
        return digest.hexdigest()

    @staticmethod
    def _claim(user, key, request, request_hash):
        try:
            with transaction.atomic():
                claim = IdempotentRequest.objects.create(
                    user=user,
                    key=key,
                    method=request.method,
                    path=request.get_full_path(),
                    request_hash=request_hash,
                )
            return claim, None
        except IntegrityError:
            claim = IdempotentRequest.objects.get(user=user, key=key)

        if claim.request_hash != request_hash:
            return claim, JsonResponse(
                {
                    "detail": "This idempotency key was already used for another request."
                },
                status=409,
            )

        if claim.completed_at is None:
            return claim, JsonResponse(
                {"detail": "The original request is still being processed."},
                status=409,
            )

        response = JsonResponse(
            claim.response_body,
            status=claim.response_status,
            safe=not isinstance(claim.response_body, list),
        )
        response["Idempotency-Replayed"] = "true"
        return claim, response

    @staticmethod
    def _response_body(response):
        try:
            return json.loads(response.content)
        except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
            return {"detail": response.content.decode(errors="replace")}
