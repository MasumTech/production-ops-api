from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

from .health import HealthCheckView, LivenessCheckView, ReadinessCheckView

urlpatterns = [
    path("admin/", admin.site.urls),
    path(
        "api/auth/token/",
        TokenObtainPairView.as_view(),
        name="token-obtain-pair",
    ),
    path(
        "api/auth/token/refresh/",
        TokenRefreshView.as_view(),
        name="token-refresh",
    ),
    path(
        "api/schema/",
        SpectacularAPIView.as_view(),
        name="api-schema",
    ),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="api-schema"),
        name="api-docs",
    ),
    path("api/", include("operations.urls")),
    path(
        "api/health/live/",
        LivenessCheckView.as_view(),
        name="liveness-check",
    ),
    path(
        "api/health/ready/",
        ReadinessCheckView.as_view(),
        name="readiness-check",
    ),
    path(
        "api/health/",
        HealthCheckView.as_view(),
        name="health-check",
    ),
    path(
        "api/analytics/",
        include("analytics.urls"),
    ),
]
