from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    OperationsDashboardView,
    ProductionLineViewSet,
    QualityIncidentViewSet,
    ShiftViewSet,
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

urlpatterns = [
    path(
        "dashboard/summary/",
        OperationsDashboardView.as_view(),
        name="operations-dashboard",
    ),
]

urlpatterns += router.urls
