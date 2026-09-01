from django.urls import path

from .views import LossAnalyticsView

urlpatterns = [
    path(
        "loss-assets/",
        LossAnalyticsView.as_view(),
        name="loss-analytics",
    ),
]
