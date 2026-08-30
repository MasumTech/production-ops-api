from django.db.models import (
    Case,
    Count,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Sum,
    When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    TeamLeaderAssignment,
)
from .permissions import (
    IsAssignedTeamLeaderOrStaff,
    IsEscalationParticipantOrStaff,
    IsStaffOrReadOnly,
)
from .serializers import (
    HourlyLineUpdateFilterSerializer,
    HourlyLineUpdateSerializer,
    OperationalEscalationFilterSerializer,
    OperationalEscalationResolveSerializer,
    OperationalEscalationSerializer,
    OperationsDashboardFilterSerializer,
    OperationsDashboardSummarySerializer,
    ProductionLineSerializer,
    ProductMaterialReadinessFilterSerializer,
    ProductMaterialReadinessSerializer,
    QualityIncidentSerializer,
    ShiftSerializer,
    TeamLeaderAssignmentFilterSerializer,
    TeamLeaderAssignmentSerializer,
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


@extend_schema_view(
    list=extend_schema(
        parameters=[TeamLeaderAssignmentFilterSerializer],
    ),
)
class TeamLeaderAssignmentViewSet(viewsets.ModelViewSet):
    queryset = TeamLeaderAssignment.objects.all()
    serializer_class = TeamLeaderAssignmentSerializer
    permission_classes = (IsStaffOrReadOnly,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "production_line__code",
        "production_line__name",
        "team_leader__username",
        "team_leader__email",
    )
    ordering_fields = (
        "date",
        "shift_type",
        "production_line__code",
        "team_leader__username",
        "created_at",
    )
    ordering = (
        "-date",
        "shift_type",
        "production_line__code",
    )

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "production_line",
            "team_leader",
            "assigned_by",
        )

        action_name = getattr(self, "action", None)

        if not self.request.user.is_staff or action_name == "my_lines":
            queryset = queryset.filter(
                team_leader=self.request.user,
            )

        filter_serializer = TeamLeaderAssignmentFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")

        if date:
            queryset = queryset.filter(date=date)

        if shift_type:
            queryset = queryset.filter(shift_type=shift_type)

        if production_line:
            queryset = queryset.filter(
                production_line_id=production_line,
            )

        return queryset

    def perform_create(self, serializer):
        serializer.save(assigned_by=self.request.user)

    @extend_schema(
        parameters=[TeamLeaderAssignmentFilterSerializer],
        responses=TeamLeaderAssignmentSerializer(many=True),
    )
    @action(
        detail=False,
        methods=("get",),
        url_path="my-lines",
    )
    def my_lines(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)

        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


@extend_schema_view(
    list=extend_schema(
        parameters=[HourlyLineUpdateFilterSerializer],
    ),
)
class HourlyLineUpdateViewSet(viewsets.ModelViewSet):
    queryset = HourlyLineUpdate.objects.all()
    serializer_class = HourlyLineUpdateSerializer
    permission_classes = (IsAssignedTeamLeaderOrStaff,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "assignment__production_line__code",
        "assignment__production_line__name",
        "assignment__team_leader__username",
        "current_product",
        "issue_summary",
        "action_taken",
        "support_required",
    )
    ordering_fields = (
        "recorded_at",
        "next_update_due_at",
        "status",
        "assignment__date",
        "assignment__production_line__code",
        "created_at",
    )
    ordering = ("-recorded_at", "-id")

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "action_owner",
            "recorded_by",
        )

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                assignment__team_leader=self.request.user,
            )

        filter_serializer = HourlyLineUpdateFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")
        status_value = filter_serializer.validated_data.get("status")
        requires_follow_up = filter_serializer.validated_data.get("requires_follow_up")

        if date is not None:
            queryset = queryset.filter(
                assignment__date=date,
            )

        if shift_type is not None:
            queryset = queryset.filter(
                assignment__shift_type=shift_type,
            )

        if production_line is not None:
            queryset = queryset.filter(
                assignment__production_line_id=production_line,
            )

        if status_value is not None:
            queryset = queryset.filter(
                status=status_value,
            )

        if requires_follow_up is not None:
            queryset = queryset.filter(
                requires_follow_up=requires_follow_up,
            )
        return queryset

    def perform_create(self, serializer):
        serializer.save(recorded_by=self.request.user)

    @extend_schema(
        parameters=[HourlyLineUpdateFilterSerializer],
        responses=HourlyLineUpdateSerializer(many=True),
    )
    @action(
        detail=False,
        methods=("get",),
        url_path="latest-status",
    )
    def latest_status(self, request):
        latest_update_id = (
            HourlyLineUpdate.objects.filter(
                assignment_id=OuterRef("assignment_id"),
            )
            .order_by("-recorded_at", "-id")
            .values("id")[:1]
        )

        queryset = self.filter_queryset(
            self.get_queryset(),
        ).filter(
            id=Subquery(latest_update_id),
        )

        page = self.paginate_queryset(queryset)

        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


@extend_schema_view(
    list=extend_schema(
        parameters=[ProductMaterialReadinessFilterSerializer],
    ),
)
class ProductMaterialReadinessViewSet(viewsets.ModelViewSet):
    queryset = ProductMaterialReadiness.objects.all()
    serializer_class = ProductMaterialReadinessSerializer
    permission_classes = (IsAssignedTeamLeaderOrStaff,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "product_code",
        "product_name",
        "assignment__production_line__code",
        "assignment__production_line__name",
        "assignment__team_leader__username",
        "owner__username",
        "hold_reason",
        "notes",
    )
    ordering_fields = (
        "sequence_number",
        "product_code",
        "status",
        "shortage_quantity",
        "expected_available_at",
        "assignment__date",
        "assignment__production_line__code",
        "created_at",
    )
    ordering = (
        "-assignment__date",
        "assignment__shift_type",
        "assignment__production_line__code",
        "sequence_number",
    )

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "owner",
            "released_by",
            "created_by",
        )

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                assignment__team_leader=self.request.user,
            )

        filter_serializer = ProductMaterialReadinessFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")
        status_value = filter_serializer.validated_data.get("status")
        owner = filter_serializer.validated_data.get("owner")
        product_code = filter_serializer.validated_data.get("product_code")

        if date is not None:
            queryset = queryset.filter(assignment__date=date)

        if shift_type is not None:
            queryset = queryset.filter(
                assignment__shift_type=shift_type,
            )

        if production_line is not None:
            queryset = queryset.filter(
                assignment__production_line_id=production_line,
            )

        if status_value is not None:
            queryset = queryset.filter(status=status_value)

        if owner is not None:
            queryset = queryset.filter(owner_id=owner)

        if product_code is not None:
            queryset = queryset.filter(product_code__iexact=product_code)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @extend_schema(
        request=None,
        responses=ProductMaterialReadinessSerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="release",
    )
    def release(self, request, pk=None):
        readiness = self.get_object()

        if not request.user.is_staff:
            raise PermissionDenied("Only management staff can release held material.")

        if readiness.status != ProductMaterialReadiness.Status.HELD:
            raise ValidationError({"status": "Only held material can be released."})

        readiness.status = ProductMaterialReadiness.Status.READY
        readiness.released_at = timezone.now()
        readiness.released_by = request.user
        readiness.save(
            update_fields=(
                "status",
                "released_at",
                "released_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(readiness)
        return Response(serializer.data)


@extend_schema_view(
    list=extend_schema(
        parameters=[OperationalEscalationFilterSerializer],
    ),
)
class OperationalEscalationViewSet(viewsets.ModelViewSet):
    queryset = OperationalEscalation.objects.all()
    serializer_class = OperationalEscalationSerializer
    permission_classes = (IsEscalationParticipantOrStaff,)
    http_method_names = (
        "get",
        "post",
        "head",
        "options",
    )
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "summary",
        "details",
        "immediate_action",
        "resolution_notes",
        "assignment__production_line__code",
        "assignment__production_line__name",
        "assignment__team_leader__username",
        "owner__username",
    )
    ordering_fields = (
        "raised_at",
        "response_due_at",
        "priority",
        "status",
        "assignment__date",
        "assignment__production_line__code",
        "created_at",
    )
    ordering = (
        "status",
        "response_due_at",
        "-raised_at",
    )

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "hourly_update",
            "quality_incident",
            "quality_incident__shift",
            "owner",
            "raised_by",
            "acknowledged_by",
            "resolved_by",
        )

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                Q(assignment__team_leader=self.request.user)
                | Q(owner=self.request.user)
            )

        filter_serializer = OperationalEscalationFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")
        category = filter_serializer.validated_data.get("category")
        priority = filter_serializer.validated_data.get("priority")
        status_value = filter_serializer.validated_data.get("status")
        owner = filter_serializer.validated_data.get("owner")
        overdue = filter_serializer.validated_data.get("overdue")
        unassigned = filter_serializer.validated_data.get("unassigned")

        if date is not None:
            queryset = queryset.filter(
                assignment__date=date,
            )

        if shift_type is not None:
            queryset = queryset.filter(
                assignment__shift_type=shift_type,
            )

        if production_line is not None:
            queryset = queryset.filter(
                assignment__production_line_id=production_line,
            )

        if category is not None:
            queryset = queryset.filter(category=category)

        if priority is not None:
            queryset = queryset.filter(priority=priority)

        if status_value is not None:
            queryset = queryset.filter(status=status_value)

        if owner is not None:
            queryset = queryset.filter(owner_id=owner)

        if overdue is not None:
            overdue_query = Q(
                status__in=(
                    OperationalEscalation.Status.OPEN,
                    OperationalEscalation.Status.ACKNOWLEDGED,
                ),
                response_due_at__lt=timezone.now(),
            )

            if overdue:
                queryset = queryset.filter(overdue_query)
            else:
                queryset = queryset.exclude(overdue_query)

        if unassigned is not None:
            queryset = queryset.filter(
                owner__isnull=unassigned,
            )

        return queryset.distinct()

    def perform_create(self, serializer):
        serializer.save(raised_by=self.request.user)

    @extend_schema(
        request=None,
        responses=OperationalEscalationSerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="acknowledge",
    )
    def acknowledge(self, request, pk=None):
        escalation = self.get_object()

        if escalation.status != OperationalEscalation.Status.OPEN:
            raise ValidationError(
                {"status": ("Only an open escalation can be acknowledged.")}
            )

        if not request.user.is_staff and escalation.owner_id != request.user.id:
            raise PermissionDenied(
                "Only the assigned owner or management staff can acknowledge."
            )

        update_fields = [
            "status",
            "acknowledged_at",
            "acknowledged_by",
            "updated_at",
        ]

        if escalation.owner_id is None:
            escalation.owner = request.user
            update_fields.append("owner")

        escalation.status = OperationalEscalation.Status.ACKNOWLEDGED
        escalation.acknowledged_at = timezone.now()
        escalation.acknowledged_by = request.user
        escalation.save(update_fields=update_fields)

        serializer = self.get_serializer(escalation)
        return Response(serializer.data)

    @extend_schema(
        request=OperationalEscalationResolveSerializer,
        responses=OperationalEscalationSerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="resolve",
    )
    def resolve(self, request, pk=None):
        escalation = self.get_object()

        if escalation.status != OperationalEscalation.Status.ACKNOWLEDGED:
            raise ValidationError(
                {"status": ("Escalation must be acknowledged before resolution.")}
            )

        if not request.user.is_staff and escalation.owner_id != request.user.id:
            raise PermissionDenied(
                "Only the assigned owner or management staff can resolve."
            )

        input_serializer = OperationalEscalationResolveSerializer(
            data=request.data,
        )
        input_serializer.is_valid(raise_exception=True)

        escalation.status = OperationalEscalation.Status.RESOLVED
        escalation.resolution_notes = input_serializer.validated_data[
            "resolution_notes"
        ]
        escalation.resolved_at = timezone.now()
        escalation.resolved_by = request.user
        escalation.save(
            update_fields=(
                "status",
                "resolution_notes",
                "resolved_at",
                "resolved_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(escalation)
        return Response(serializer.data)

    @extend_schema(
        parameters=[OperationalEscalationFilterSerializer],
        responses=OperationalEscalationSerializer(many=True),
    )
    @action(
        detail=False,
        methods=("get",),
        url_path="attention-required",
    )
    def attention_required(self, request):
        queryset = (
            self.filter_queryset(
                self.get_queryset(),
            )
            .filter(
                Q(owner__isnull=True)
                | Q(response_due_at__lt=timezone.now())
                | Q(priority=(OperationalEscalation.Priority.CRITICAL)),
            )
            .exclude(
                status=OperationalEscalation.Status.RESOLVED,
            )
            .annotate(
                attention_priority=Case(
                    When(
                        priority=(OperationalEscalation.Priority.CRITICAL),
                        then=0,
                    ),
                    When(
                        priority=(OperationalEscalation.Priority.HIGH),
                        then=1,
                    ),
                    When(
                        priority=(OperationalEscalation.Priority.MEDIUM),
                        then=2,
                    ),
                    default=3,
                    output_field=IntegerField(),
                ),
            )
            .order_by(
                "attention_priority",
                "response_due_at",
                "-raised_at",
            )
        )

        page = self.paginate_queryset(queryset)

        if page is not None:
            serializer = self.get_serializer(
                page,
                many=True,
            )
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(
            queryset,
            many=True,
        )
        return Response(serializer.data)
