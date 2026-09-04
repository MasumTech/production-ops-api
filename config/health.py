from django.conf import settings
from django.db import DatabaseError, connections
from drf_spectacular.utils import extend_schema
from redis import Redis
from redis.exceptions import RedisError
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckSerializer(serializers.Serializer):
    status = serializers.CharField()
    database = serializers.CharField()


class LivenessCheckSerializer(serializers.Serializer):
    status = serializers.CharField()


class ReadinessCheckSerializer(serializers.Serializer):
    status = serializers.CharField()
    database = serializers.CharField()
    redis = serializers.CharField()


def database_is_available():
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        return False

    return True


def redis_is_available():
    if not settings.REDIS_URL:
        return False

    client = None
    try:
        client = Redis.from_url(
            settings.REDIS_URL,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        return bool(client.ping())
    except (OSError, RedisError, ValueError):
        return False
    finally:
        if client is not None:
            client.close()


class LivenessCheckView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(responses={status.HTTP_200_OK: LivenessCheckSerializer})
    def get(self, request):
        return Response({"status": "healthy"})


class ReadinessCheckView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(
        responses={
            status.HTTP_200_OK: ReadinessCheckSerializer,
            status.HTTP_503_SERVICE_UNAVAILABLE: ReadinessCheckSerializer,
        }
    )
    def get(self, request):
        database_ready = database_is_available()
        redis_ready = redis_is_available()
        is_ready = database_ready and redis_ready

        return Response(
            {
                "status": "ready" if is_ready else "not_ready",
                "database": "connected" if database_ready else "unavailable",
                "redis": "connected" if redis_ready else "unavailable",
            },
            status=(
                status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE
            ),
        )


class HealthCheckView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(
        responses={
            status.HTTP_200_OK: HealthCheckSerializer,
            status.HTTP_503_SERVICE_UNAVAILABLE: HealthCheckSerializer,
        }
    )
    def get(self, request):
        if database_is_available():
            return Response(
                {
                    "status": "healthy",
                    "database": "connected",
                }
            )

        return Response(
            {
                "status": "unhealthy",
                "database": "unavailable",
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
