from django.db import DatabaseError, connections
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckSerializer(serializers.Serializer):
    status = serializers.CharField()
    database = serializers.CharField()


def database_is_available():
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        return False

    return True


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
