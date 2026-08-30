from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    HourlyLineUpdateViewSet,
    OperationsDashboardView,
    ProductionLineViewSet,
    ProductMaterialReadinessViewSet,
    QualityIncidentViewSet,
    ShiftViewSet,
    TeamLeaderAssignmentViewSet,
)

router = DefaultRouter()
router.register(
    "production-lines",
    ProductionLineViewSet,
    basename="production-line",
)
router.register(
    "shifts",
    ShiftViewSet,
    basename="shift",
)
router.register(
    "quality-incidents",
    QualityIncidentViewSet,
    basename="quality-incident",
)
router.register(
    "team-leader-assignments",
    TeamLeaderAssignmentViewSet,
    basename="team-leader-assignment",
)
router.register(
    "hourly-line-updates",
    HourlyLineUpdateViewSet,
    basename="hourly-line-update",
)
router.register(
    "product-material-readiness",
    ProductMaterialReadinessViewSet,
    basename="product-material-readiness",
)

urlpatterns = [
    path(
        "dashboard/summary/",
        OperationsDashboardView.as_view(),
        name="operations-dashboard",
    ),
]

urlpatterns += router.urls
