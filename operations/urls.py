from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ActiveUserListView,
    BreakRecoveryViewSet,
    CurrentUserView,
    HourlyLineUpdateViewSet,
    OperationalEscalationViewSet,
    OperationalEventViewSet,
    OperationsDashboardView,
    ProductionLineViewSet,
    ProductMaterialReadinessViewSet,
    QualityIncidentViewSet,
    ShiftHandoverViewSet,
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
router.register(
    "operational-escalations",
    OperationalEscalationViewSet,
    basename="operational-escalation",
)
router.register(
    "operational-events",
    OperationalEventViewSet,
    basename="operational-event",
)
router.register(
    "shift-handovers",
    ShiftHandoverViewSet,
    basename="shift-handover",
)
router.register(
    "break-recoveries",
    BreakRecoveryViewSet,
    basename="break-recovery",
)

urlpatterns = [
    path(
        "auth/me/",
        CurrentUserView.as_view(),
        name="current-user",
    ),
    path(
        "active-users/",
        ActiveUserListView.as_view(),
        name="active-user-list",
    ),
    path(
        "dashboard/summary/",
        OperationsDashboardView.as_view(),
        name="operations-dashboard",
    ),
]

urlpatterns += router.urls
