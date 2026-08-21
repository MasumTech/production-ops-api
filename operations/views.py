from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from .models import ProductionLine, QualityIncident, Shift
from .serializers import (
    ProductionLineSerializer,
    QualityIncidentSerializer,
    ShiftSerializer,
)


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
