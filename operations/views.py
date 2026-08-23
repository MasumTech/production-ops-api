from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from drf_spectacular.utils import extend_schema
from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ProductionLine, QualityIncident, Shift
from .serializers import (
    OperationsDashboardFilterSerializer,
    OperationsDashboardSummarySerializer,
    ProductionLineSerializer,
    QualityIncidentSerializer,
    ShiftSerializer,
)


class OperationsDashboardView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[OperationsDashboardFilterSerializer],
        responses=OperationsDashboardSummarySerializer,
    )
    def get(self, request):
        filter_serializer = OperationsDashboardFilterSerializer(
            data=request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date_from = filter_serializer.validated_data.get("date_from")
        date_to = filter_serializer.validated_data.get("date_to")

        shift_queryset = Shift.objects.all()
        incident_queryset = QualityIncident.objects.all()

        if date_from:
            shift_queryset = shift_queryset.filter(
                date__gte=date_from,
            )
            incident_queryset = incident_queryset.filter(
                occurred_at__date__gte=date_from,
            )

        if date_to:
            shift_queryset = shift_queryset.filter(
                date__lte=date_to,
            )
            incident_queryset = incident_queryset.filter(
                occurred_at__date__lte=date_to,
            )

        shift_summary = shift_queryset.aggregate(
            total_shifts=Count("id"),
            total_planned_output=Coalesce(
                Sum("planned_output"),
                0,
            ),
            total_actual_output=Coalesce(
                Sum("actual_output"),
                0,
            ),
            total_downtime_minutes=Coalesce(
                Sum("downtime_minutes"),
                0,
            ),
        )

        planned_output = shift_summary["total_planned_output"]
        actual_output = shift_summary["total_actual_output"]

        performance_percentage = None
        if planned_output:
            performance_percentage = round(
                (actual_output / planned_output) * 100,
                2,
            )

        incident_summary = incident_queryset.aggregate(
            open_incidents=Count(
                "id",
                filter=Q(status=QualityIncident.Status.OPEN),
            ),
            critical_incidents=Count(
                "id",
                filter=Q(
                    severity=QualityIncident.Severity.CRITICAL,
                ),
            ),
        )

        summary = {
            **shift_summary,
            "overall_performance_percentage": performance_percentage,
            **incident_summary,
        }

        serializer = OperationsDashboardSummarySerializer(summary)
        return Response(serializer.data)


class ProductionLineViewSet(viewsets.ModelViewSet):
    serializer_class = ProductionLineSerializer
    permission_classes = (IsAuthenticated,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = ("code", "name", "location")
    ordering_fields = (
        "code",
        "name",
        "status",
        "created_at",
    )
    ordering = ("code",)

    def get_queryset(self):
        queryset = ProductionLine.objects.all()
        status = self.request.query_params.get("status")

        if status:
            queryset = queryset.filter(status=status)

        return queryset


class ShiftViewSet(viewsets.ModelViewSet):
    serializer_class = ShiftSerializer
    permission_classes = (IsAuthenticated,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "production_line__code",
        "production_line__name",
        "supervisor__username",
        "notes",
    )
    ordering_fields = (
        "date",
        "planned_output",
        "actual_output",
        "downtime_minutes",
        "created_at",
    )
    ordering = ("-date",)

    def get_queryset(self):
        queryset = Shift.objects.select_related(
            "production_line",
            "supervisor",
        )

        production_line = self.request.query_params.get("production_line")
        shift_type = self.request.query_params.get("shift_type")
        shift_date = self.request.query_params.get("date")

        if production_line:
            queryset = queryset.filter(production_line_id=production_line)

        if shift_type:
            queryset = queryset.filter(shift_type=shift_type)

        if shift_date:
            queryset = queryset.filter(date=shift_date)

        return queryset

    def perform_create(self, serializer):
        if "supervisor" in serializer.validated_data:
            serializer.save()
        else:
            serializer.save(supervisor=self.request.user)


class QualityIncidentViewSet(viewsets.ModelViewSet):
    serializer_class = QualityIncidentSerializer
    permission_classes = (IsAuthenticated,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "title",
        "description",
        "root_cause",
        "shift__production_line__code",
    )
    ordering_fields = (
        "occurred_at",
        "resolved_at",
        "severity",
        "status",
        "created_at",
    )
    ordering = ("-occurred_at",)

    def get_queryset(self):
        queryset = QualityIncident.objects.select_related(
            "shift",
            "shift__production_line",
            "reported_by",
        )

        status = self.request.query_params.get("status")
        severity = self.request.query_params.get("severity")
        category = self.request.query_params.get("category")
        shift = self.request.query_params.get("shift")

        if status:
            queryset = queryset.filter(status=status)

        if severity:
            queryset = queryset.filter(severity=severity)

        if category:
            queryset = queryset.filter(category=category)

        if shift:
            queryset = queryset.filter(shift_id=shift)

        return queryset

    def perform_create(self, serializer):
        serializer.save(reported_by=self.request.user)
