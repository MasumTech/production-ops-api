from django.urls import path

from .views import DailyRiskBriefingView, LossAnalyticsView

urlpatterns = [
    path(
        "loss-assets/",
        LossAnalyticsView.as_view(),
        name="loss-analytics",
    ),
    path(
        "daily-risk-briefing/",
        DailyRiskBriefingView.as_view(),
        name="daily-risk-briefing",
    ),
]
