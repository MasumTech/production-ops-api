from django.db.models import Count, F, Max, Q, Sum
from django.db.models.functions import Coalesce
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from operations.models import OperationalEscalation

from .risk_briefing import build_daily_risk_briefing
from .serializers import (
    DailyRiskBriefingFilterSerializer,
    DailyRiskBriefingSerializer,
    LossAnalyticsFilterSerializer,
    LossAnalyticsReportSerializer,
)


class LossAnalyticsView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(
        parameters=[LossAnalyticsFilterSerializer],
        responses=LossAnalyticsReportSerializer,
    )
    def get(self, request):
        filter_serializer = LossAnalyticsFilterSerializer(
            data=request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data

        date_from = filters["date_from"]
        date_to = filters["date_to"]
        threshold = filters["recurring_threshold"]

        queryset = OperationalEscalation.objects.filter(
            assignment__date__range=(date_from, date_to),
        )

        production_line = filters.get("production_line")
        asset = filters.get("asset")

        if production_line:
            queryset = queryset.filter(
                assignment__production_line=production_line,
            )

        if asset:
            queryset = queryset.filter(asset=asset)

        raw_asset_rows = (
            queryset.filter(
                category=OperationalEscalation.Category.EQUIPMENT,
                asset__isnull=False,
            )
            .values(
                "asset_id",
                asset_code=F("asset__code"),
                asset_name=F("asset__name"),
                production_line_code=F("asset__production_line__code"),
            )
            .annotate(
                occurrences=Count("id"),
                affected_shifts=Count(
                    "assignment_id",
                    distinct=True,
                ),
                open_events=Count(
                    "id",
                    filter=~Q(
                        status=OperationalEscalation.Status.RESOLVED,
                    ),
                ),
                total_loss_minutes=Coalesce(
                    Sum("loss_minutes"),
                    0,
                ),
                total_estimated_lost_units=Coalesce(
                    Sum("estimated_lost_units"),
                    0,
                ),
                latest_event_at=Max("raised_at"),
            )
            .order_by(
                "-total_loss_minutes",
                "-occurrences",
                "asset_code",
            )
        )

        asset_rows = [
            {
                **row,
                "recurring": row["occurrences"] >= threshold,
            }
            for row in raw_asset_rows
        ]

        line_rows = list(
            queryset.values(
                "category",
                production_line_id=F("assignment__production_line_id"),
                production_line_code=F("assignment__production_line__code"),
            )
            .annotate(
                occurrences=Count("id"),
                affected_shifts=Count(
                    "assignment_id",
                    distinct=True,
                ),
                total_loss_minutes=Coalesce(
                    Sum("loss_minutes"),
                    0,
                ),
                total_estimated_lost_units=Coalesce(
                    Sum("estimated_lost_units"),
                    0,
                ),
            )
            .order_by(
                "-total_loss_minutes",
                "-occurrences",
                "production_line_code",
                "category",
            )
        )

        totals = queryset.aggregate(
            total_events=Count("id"),
            total_loss_minutes=Coalesce(
                Sum("loss_minutes"),
                0,
            ),
            total_estimated_lost_units=Coalesce(
                Sum("estimated_lost_units"),
                0,
            ),
        )

        payload = {
            "summary": {
                "date_from": date_from,
                "date_to": date_to,
                **totals,
                "unassigned_asset_events": queryset.filter(
                    category=OperationalEscalation.Category.EQUIPMENT,
                    asset__isnull=True,
                ).count(),
                "recurring_asset_count": sum(row["recurring"] for row in asset_rows),
            },
            "assets": asset_rows,
            "line_losses": line_rows,
        }

        return Response(LossAnalyticsReportSerializer(payload).data)


class DailyRiskBriefingView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(
        parameters=[DailyRiskBriefingFilterSerializer],
        responses=DailyRiskBriefingSerializer,
    )
    def get(self, request):
        filter_serializer = DailyRiskBriefingFilterSerializer(
            data=request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data

        payload = build_daily_risk_briefing(
            filters["date"],
            production_line=filters.get("production_line"),
        )

        return Response(DailyRiskBriefingSerializer(payload).data)
