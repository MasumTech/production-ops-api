from rest_framework.routers import DefaultRouter

from .views import (
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

urlpatterns = router.urls
