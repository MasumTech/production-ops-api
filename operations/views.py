from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db.models import (
    Avg,
    Case,
    Count,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.health import database_is_available, redis_is_available

from .access import OPERATIONAL_SUPPORT_GROUP, WorkspaceRole
from .break_opportunities import detect_break_opportunity
from .events import create_operational_event, event_queryset_for_user
from .models import (
    BreakOpportunity,
    BreakRecovery,
    DailyPlanBlock,
    HourlyLineUpdate,
    OperationalEscalation,
    OperationalEvent,
    OperationalEventReadReceipt,
    OperationalWorkerHeartbeat,
    PilotApproval,
    PilotFeedback,
    PilotObservation,
    PilotTrial,
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)
from .permissions import (
    IsAssignedTeamLeaderOrStaff,
    IsBreakRecoveryParticipantOrStaff,
    IsEscalationParticipantOrStaff,
    IsHandoverParticipantOrStaff,
    IsOperationalSupport,
    IsStaffOrReadOnly,
)
from .serializers import (
    BreakOpportunityDeclineSerializer,
    BreakOpportunityFilterSerializer,
    BreakOpportunityResumeSerializer,
    BreakOpportunitySerializer,
    BreakRecoveryCancelSerializer,
    BreakRecoveryCompleteSerializer,
    BreakRecoveryFilterSerializer,
    BreakRecoverySerializer,
    CurrentUserSerializer,
    DailyPlanBlockFilterSerializer,
    DailyPlanBlockSerializer,
    HourlyLineUpdateFilterSerializer,
    HourlyLineUpdateSerializer,
    NotificationInboxSerializer,
    ObservabilitySummarySerializer,
    OperationalEscalationFilterSerializer,
    OperationalEscalationResolveSerializer,
    OperationalEscalationSerializer,
    OperationalEventCursorSerializer,
    OperationalEventFilterSerializer,
    OperationalEventReadReceiptSerializer,
    OperationalEventSerializer,
    OperationsDashboardFilterSerializer,
    OperationsDashboardSummarySerializer,
    PilotApprovalSerializer,
    PilotApprovalWriteSerializer,
    PilotDecisionSerializer,
    PilotEvidenceSerializer,
    PilotFeedbackSerializer,
    PilotObservationSerializer,
    PilotStatusSerializer,
    PilotTrialSerializer,
    ProductionAssetSerializer,
    ProductionLineSerializer,
    ProductMaterialReadinessFilterSerializer,
    ProductMaterialReadinessSerializer,
    QualityIncidentSerializer,
    ShiftHandoverFilterSerializer,
    ShiftHandoverSerializer,
    ShiftSerializer,
    SupportCompanionFilterSerializer,
    SupportCompanionSerializer,
    TeamLeaderAssignmentFilterSerializer,
    TeamLeaderAssignmentSerializer,
    UserChoiceSerializer,
    WorkspaceRoleUpdateSerializer,
)

User = get_user_model()
REQUIRED_PILOT_APPROVAL_ROLES = tuple(PilotApproval.ReviewerRole.values)


class CurrentUserView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=CurrentUserSerializer)
    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


class NotificationInboxView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=NotificationInboxSerializer)
    def get(self, request):
        unread_events = event_queryset_for_user(request.user).exclude(
            read_receipts__user=request.user,
        )
        unread_count = unread_events.count()
        events = unread_events.order_by("-id")[:50]
        serializer = NotificationInboxSerializer(
            {
                "unread_count": unread_count,
                "results": events,
            }
        )
        return Response(serializer.data)


class NotificationReadView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=None,
        responses=OperationalEventReadReceiptSerializer,
    )
    def post(self, request, event_id):
        event = event_queryset_for_user(request.user).filter(id=event_id).first()
        if event is None:
            raise NotFound("Notification was not found.")
        receipt, _ = OperationalEventReadReceipt.objects.get_or_create(
            event=event,
            user=request.user,
        )
        return Response(OperationalEventReadReceiptSerializer(receipt).data)


class WorkspaceRoleView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(responses=CurrentUserSerializer(many=True))
    def get(self, request):
        users = (
            User.objects.filter(
                is_active=True,
                is_superuser=False,
            )
            .prefetch_related("groups")
            .order_by("username")
        )
        return Response(CurrentUserSerializer(users, many=True).data)

    @extend_schema(
        request=WorkspaceRoleUpdateSerializer,
        responses=CurrentUserSerializer,
    )
    def post(self, request):
        serializer = WorkspaceRoleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        workspace = serializer.validated_data["workspace"]
        support_group, _ = Group.objects.get_or_create(
            name=OPERATIONAL_SUPPORT_GROUP,
        )
        if workspace == WorkspaceRole.SUPPORT:
            user.groups.add(support_group)
        else:
            user.groups.remove(support_group)
        create_operational_event(
            event_type="workspace_role.changed",
            resource_type="user",
            resource_id=user.id,
            actor=request.user,
            severity=OperationalEvent.Severity.INFO,
            metadata={"workspace": workspace},
            recipients=(user,),
        )
        return Response(CurrentUserSerializer(user).data)


class PilotStatusView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(responses=PilotStatusSerializer)
    def get(self, request):
        now = timezone.now()
        heartbeat = OperationalWorkerHeartbeat.objects.filter(
            worker_name="operational-reminders",
        ).first()
        worker_status = "not_started"
        if heartbeat:
            fresh_after = now - timedelta(minutes=3)
            worker_status = (
                "healthy"
                if heartbeat.last_completed_at
                and heartbeat.last_completed_at >= fresh_after
                and not heartbeat.last_error
                else "attention"
            )
        worker = {
            "status": worker_status,
            "last_started_at": heartbeat.last_started_at if heartbeat else None,
            "last_completed_at": heartbeat.last_completed_at if heartbeat else None,
            "last_error": heartbeat.last_error if heartbeat else "",
            "published_count": heartbeat.published_count if heartbeat else 0,
        }
        unresolved = OperationalEscalation.objects.filter(
            status__in=(
                OperationalEscalation.Status.OPEN,
                OperationalEscalation.Status.ACKNOWLEDGED,
            )
        )
        latest_event_at = (
            OperationalEvent.objects.order_by("-id")
            .values_list(
                "occurred_at",
                flat=True,
            )
            .first()
        )
        unread_notifications = (
            event_queryset_for_user(request.user)
            .exclude(
                read_receipts__user=request.user,
            )
            .count()
        )
        payload = {
            "status": "ready" if worker_status == "healthy" else "attention",
            "generated_at": now,
            "active_users": User.objects.filter(is_active=True).count(),
            "support_users": User.objects.filter(
                is_active=True,
                groups__name=OPERATIONAL_SUPPORT_GROUP,
            ).count(),
            "events_last_hour": OperationalEvent.objects.filter(
                occurred_at__gte=now - timedelta(hours=1),
            ).count(),
            "latest_event_at": latest_event_at,
            "unread_notifications": unread_notifications,
            "open_actions": unresolved.count(),
            "overdue_actions": unresolved.filter(response_due_at__lt=now).count(),
            "unassigned_actions": unresolved.filter(owner__isnull=True).count(),
            "reminder_worker": worker,
        }
        return Response(PilotStatusSerializer(payload).data)


class PilotTrialViewSet(viewsets.ModelViewSet):
    queryset = PilotTrial.objects.all()
    serializer_class = PilotTrialSerializer
    permission_classes = (IsAdminUser,)
    http_method_names = ("get", "post", "patch", "head", "options")
    filter_backends = (filters.OrderingFilter,)
    ordering_fields = ("created_at", "start_date", "end_date", "status")
    ordering = ("-created_at",)

    def get_queryset(self):
        return self.queryset.select_related(
            "created_by",
            "started_by",
            "decided_by",
        ).prefetch_related("selected_lines")

    def perform_create(self, serializer):
        trial = serializer.save(created_by=self.request.user)
        PilotApproval.objects.bulk_create(
            [
                PilotApproval(trial=trial, reviewer_role=reviewer_role)
                for reviewer_role in REQUIRED_PILOT_APPROVAL_ROLES
            ]
        )

    @extend_schema(request=None, responses=PilotTrialSerializer)
    @action(detail=True, methods=("post",), url_path="start")
    def start(self, request, pk=None):
        trial = self.get_object()
        if trial.status != PilotTrial.Status.PLANNED:
            raise ValidationError({"status": "Only a planned trial can be started."})
        if not trial.selected_lines.exists():
            raise ValidationError(
                {"selected_lines": "Select at least one line before starting."}
            )
        approved_roles = set(
            trial.approvals.filter(
                decision=PilotApproval.Decision.APPROVED
            ).values_list(
                "reviewer_role",
                flat=True,
            )
        )
        missing_roles = [
            dict(PilotApproval.ReviewerRole.choices)[role]
            for role in REQUIRED_PILOT_APPROVAL_ROLES
            if role not in approved_roles
        ]
        if missing_roles:
            raise ValidationError(
                {
                    "approvals": (
                        "Complete all required pre-pilot reviews before starting: "
                        + ", ".join(missing_roles)
                    )
                }
            )
        trial.status = PilotTrial.Status.ACTIVE
        trial.started_at = timezone.now()
        trial.started_by = request.user
        trial.save(update_fields=("status", "started_at", "started_by", "updated_at"))
        create_operational_event(
            event_type="pilot_trial.started",
            resource_type="pilot_trial",
            resource_id=trial.id,
            actor=request.user,
            severity=OperationalEvent.Severity.INFO,
            metadata={"name": trial.name, "line_count": trial.selected_lines.count()},
        )
        return Response(self.get_serializer(trial).data)

    @extend_schema(request=PilotDecisionSerializer, responses=PilotTrialSerializer)
    @action(detail=True, methods=("post",), url_path="decide")
    def decide(self, request, pk=None):
        trial = self.get_object()
        if trial.status != PilotTrial.Status.ACTIVE:
            raise ValidationError({"status": "Only an active trial can be decided."})
        decision_serializer = PilotDecisionSerializer(data=request.data)
        decision_serializer.is_valid(raise_exception=True)
        trial.status = decision_serializer.validated_data["decision"]
        trial.decision_note = decision_serializer.validated_data["decision_note"]
        trial.decided_at = timezone.now()
        trial.decided_by = request.user
        trial.save(
            update_fields=(
                "status",
                "decision_note",
                "decided_at",
                "decided_by",
                "updated_at",
            )
        )
        create_operational_event(
            event_type="pilot_trial.decided",
            resource_type="pilot_trial",
            resource_id=trial.id,
            actor=request.user,
            severity=OperationalEvent.Severity.INFO,
            metadata={"name": trial.name, "decision": trial.status},
        )
        return Response(self.get_serializer(trial).data)

    @extend_schema(responses=PilotEvidenceSerializer)
    @action(detail=True, methods=("get",), url_path="evidence")
    def evidence(self, request, pk=None):
        trial = self.get_object()
        observations = list(
            trial.observations.select_related("production_line", "observed_by")
        )
        approvals = list(trial.approvals.select_related("decided_by"))
        feedback = list(trial.feedback.select_related("created_by"))
        approved_count = sum(
            approval.decision == PilotApproval.Decision.APPROVED
            for approval in approvals
        )
        changes_requested = sum(
            approval.decision == PilotApproval.Decision.CHANGES_REQUESTED
            for approval in approvals
        )
        aggregate = trial.observations.aggregate(
            observation_count=Count("id"),
            average_update_duration_seconds=Avg("update_duration_seconds"),
            average_escalation_ack_seconds=Avg("escalation_ack_seconds"),
            missed_actions=Coalesce(Sum("missed_actions"), 0),
            accurate_updates=Count("id", filter=Q(status_was_accurate=True)),
            paper_fallback_count=Count("id", filter=Q(used_paper_fallback=True)),
        )
        payload = {
            "trial": trial,
            "summary": aggregate,
            "review": {
                "required_approvals": len(REQUIRED_PILOT_APPROVAL_ROLES),
                "approved_approvals": approved_count,
                "pending_approvals": len(approvals)
                - approved_count
                - changes_requested,
                "changes_requested": changes_requested,
                "feedback_count": len(feedback),
                "ready_for_start": approved_count == len(REQUIRED_PILOT_APPROVAL_ROLES),
            },
            "approvals": approvals,
            "feedback": feedback,
            "observations": observations,
        }
        return Response(
            PilotEvidenceSerializer(payload, context={"request": request}).data
        )

    @extend_schema(
        request=PilotApprovalWriteSerializer,
        responses=PilotApprovalSerializer(many=True),
    )
    @action(detail=True, methods=("get", "post"), url_path="approvals")
    def approvals(self, request, pk=None):
        trial = self.get_object()
        if request.method == "GET":
            approvals = trial.approvals.select_related("decided_by")
            return Response(PilotApprovalSerializer(approvals, many=True).data)
        if trial.status != PilotTrial.Status.PLANNED:
            raise ValidationError(
                {
                    "trial": "Pre-pilot reviews can only change while the trial is planned."
                }
            )

        approval_input = PilotApprovalWriteSerializer(data=request.data)
        approval_input.is_valid(raise_exception=True)
        values = approval_input.validated_data
        decision = values["decision"]
        note = values.get("note", "")
        decided_at = (
            None if decision == PilotApproval.Decision.PENDING else timezone.now()
        )
        decided_by = (
            None if decision == PilotApproval.Decision.PENDING else request.user
        )
        approval, created = PilotApproval.objects.get_or_create(
            trial=trial,
            reviewer_role=values["reviewer_role"],
            defaults={
                "decision": decision,
                "note": note,
                "decided_at": decided_at,
                "decided_by": decided_by,
            },
        )
        if not created:
            approval.decision = decision
            approval.note = note
            approval.decided_at = decided_at
            approval.decided_by = decided_by
            approval.full_clean()
            approval.save(
                update_fields=(
                    "decision",
                    "note",
                    "decided_at",
                    "decided_by",
                    "updated_at",
                )
            )
        create_operational_event(
            event_type="pilot_trial.approval.recorded",
            resource_type="pilot_approval",
            resource_id=approval.id,
            actor=request.user,
            severity=(
                OperationalEvent.Severity.WARNING
                if decision == PilotApproval.Decision.CHANGES_REQUESTED
                else OperationalEvent.Severity.INFO
            ),
            metadata={
                "trial_id": trial.id,
                "reviewer_role": approval.reviewer_role,
                "decision": approval.decision,
            },
        )
        return Response(
            PilotApprovalSerializer(approval).data,
            status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED,
        )


class PilotObservationViewSet(viewsets.ModelViewSet):
    queryset = PilotObservation.objects.all()
    serializer_class = PilotObservationSerializer
    permission_classes = (IsAdminUser,)
    http_method_names = ("get", "post", "head", "options")
    filter_backends = (filters.OrderingFilter,)
    ordering_fields = ("observed_on", "created_at", "line_status")
    ordering = ("-observed_on", "-created_at")

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "trial",
            "production_line",
            "observed_by",
        )
        trial = self.request.query_params.get("trial")
        if trial:
            queryset = queryset.filter(trial_id=trial)
        observed_on = self.request.query_params.get("observed_on")
        if observed_on:
            queryset = queryset.filter(observed_on=observed_on)
        return queryset

    def perform_create(self, serializer):
        serializer.save(observed_by=self.request.user)


class PilotFeedbackViewSet(viewsets.ModelViewSet):
    queryset = PilotFeedback.objects.all()
    serializer_class = PilotFeedbackSerializer
    permission_classes = (IsAdminUser,)
    http_method_names = ("get", "post", "head", "options")
    filter_backends = (filters.OrderingFilter,)
    ordering_fields = ("created_at", "category", "sentiment")
    ordering = ("-created_at",)

    def get_queryset(self):
        queryset = self.queryset.select_related("trial", "created_by")
        trial = self.request.query_params.get("trial")
        if trial:
            queryset = queryset.filter(trial_id=trial)
        return queryset

    def perform_create(self, serializer):
        feedback = serializer.save(created_by=self.request.user)
        create_operational_event(
            event_type="pilot_trial.feedback.recorded",
            resource_type="pilot_feedback",
            resource_id=feedback.id,
            actor=self.request.user,
            severity=(
                OperationalEvent.Severity.WARNING
                if feedback.sentiment == PilotFeedback.Sentiment.CONCERN
                else OperationalEvent.Severity.INFO
            ),
            metadata={
                "trial_id": feedback.trial_id,
                "reviewer_role": feedback.reviewer_role,
                "category": feedback.category,
                "sentiment": feedback.sentiment,
            },
        )


class ObservabilitySummaryView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(responses=ObservabilitySummarySerializer)
    def get(self, request):
        now = timezone.now()
        database_ready = database_is_available()
        redis_ready = redis_is_available()
        heartbeat = OperationalWorkerHeartbeat.objects.filter(
            worker_name="operational-reminders",
        ).first()
        worker_status = "not_started"
        if heartbeat:
            fresh_after = now - timedelta(minutes=3)
            worker_status = (
                "healthy"
                if heartbeat.last_completed_at
                and heartbeat.last_completed_at >= fresh_after
                and not heartbeat.last_error
                else "attention"
            )
        worker = {
            "status": worker_status,
            "last_started_at": heartbeat.last_started_at if heartbeat else None,
            "last_completed_at": heartbeat.last_completed_at if heartbeat else None,
            "last_error": heartbeat.last_error if heartbeat else "",
            "published_count": heartbeat.published_count if heartbeat else 0,
        }
        payload = {
            "status": "ready" if database_ready and redis_ready else "degraded",
            "generated_at": now,
            "application": "healthy",
            "database": {"status": "connected" if database_ready else "unavailable"},
            "redis": {"status": "connected" if redis_ready else "unavailable"},
            "reminder_worker": worker,
        }
        return Response(ObservabilitySummarySerializer(payload).data)


class SupportCompanionView(APIView):
    permission_classes = (IsOperationalSupport,)

    @extend_schema(
        parameters=[SupportCompanionFilterSerializer],
        responses=SupportCompanionSerializer,
    )
    def get(self, request):
        filter_serializer = SupportCompanionFilterSerializer(
            data=request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)
        operational_date = filter_serializer.validated_data.get(
            "date",
            timezone.localdate(),
        )
        now = timezone.now()
        unresolved_statuses = (
            OperationalEscalation.Status.OPEN,
            OperationalEscalation.Status.ACKNOWLEDGED,
        )
        escalations = list(
            OperationalEscalation.objects.filter(
                owner=request.user,
                assignment__date=operational_date,
                status__in=unresolved_statuses,
            )
            .select_related(
                "asset",
                "assignment",
                "assignment__production_line",
                "assignment__team_leader",
                "hourly_update",
                "quality_incident",
                "owner",
                "raised_by",
                "acknowledged_by",
                "resolved_by",
            )
            .annotate(
                attention_order=Case(
                    When(
                        priority=OperationalEscalation.Priority.CRITICAL,
                        then=0,
                    ),
                    When(response_due_at__lt=now, then=1),
                    default=2,
                    output_field=IntegerField(),
                ),
                priority_order=Case(
                    When(
                        priority=OperationalEscalation.Priority.CRITICAL,
                        then=0,
                    ),
                    When(priority=OperationalEscalation.Priority.HIGH, then=1),
                    When(priority=OperationalEscalation.Priority.MEDIUM, then=2),
                    default=3,
                    output_field=IntegerField(),
                ),
            )
            .order_by(
                "attention_order",
                "priority_order",
                "response_due_at",
                "-raised_at",
            )
        )
        assignment_ids = {item.assignment_id for item in escalations}
        assignments = TeamLeaderAssignment.objects.filter(
            id__in=assignment_ids,
        ).select_related(
            "production_line",
            "team_leader",
            "assigned_by",
        )
        latest_update_id = (
            HourlyLineUpdate.objects.filter(
                assignment_id=OuterRef("assignment_id"),
            )
            .order_by("-recorded_at", "-id")
            .values("id")[:1]
        )
        updates = (
            HourlyLineUpdate.objects.filter(
                assignment_id__in=assignment_ids,
                id=Subquery(latest_update_id),
            )
            .select_related(
                "assignment",
                "assignment__production_line",
                "assignment__team_leader",
                "action_owner",
                "recorded_by",
            )
            .order_by("assignment__production_line__code")
        )
        materials = (
            ProductMaterialReadiness.objects.filter(
                assignment_id__in=assignment_ids,
                status__in=(
                    ProductMaterialReadiness.Status.SHORT,
                    ProductMaterialReadiness.Status.HELD,
                ),
            )
            .select_related(
                "assignment",
                "assignment__production_line",
                "assignment__team_leader",
                "owner",
                "released_by",
                "created_by",
            )
            .order_by("assignment__production_line__code", "sequence_number")
        )
        response_serializer = SupportCompanionSerializer(
            {
                "generated_at": now,
                "assignments": assignments,
                "updates": updates,
                "materials": materials,
                "escalations": escalations,
            },
            context={"request": request},
        )
        return Response(response_serializer.data)


class ActiveUserListView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=UserChoiceSerializer(many=True))
    def get(self, request):
        users = User.objects.filter(
            is_active=True,
            is_superuser=False,
        ).order_by("username")
        return Response(UserChoiceSerializer(users, many=True).data)


class OperationalEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OperationalEvent.objects.all()
    serializer_class = OperationalEventSerializer
    permission_classes = (IsAuthenticated,)
    ordering = ("id",)

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "production_line",
            "actor",
        )
        if not self.request.user.is_staff:
            queryset = queryset.filter(audiences=self.request.user)

        filter_serializer = OperationalEventFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)
        after = filter_serializer.validated_data.get("after")
        if after is not None:
            queryset = queryset.filter(id__gt=after)
        return queryset.distinct().order_by("id")

    @extend_schema(
        responses=OperationalEventCursorSerializer,
    )
    @action(detail=False, methods=("get",), url_path="cursor")
    def cursor(self, request):
        cursor = (
            self.get_queryset().order_by("-id").values_list("id", flat=True).first()
        )
        return Response({"cursor": cursor or 0})


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

    @extend_schema(
        responses=TeamLeaderAssignmentSerializer(many=True),
    )
    @action(
        detail=True,
        methods=("get",),
        url_path="handover-options",
    )
    def handover_options(self, request, pk=None):
        outgoing_assignment = self.get_object()

        later_assignment_query = Q(date__gt=outgoing_assignment.date)
        if outgoing_assignment.shift_type == Shift.ShiftType.DAY:
            later_assignment_query |= Q(
                date=outgoing_assignment.date,
                shift_type=Shift.ShiftType.NIGHT,
            )

        queryset = (
            self.queryset.select_related(
                "production_line",
                "team_leader",
                "assigned_by",
            )
            .filter(
                later_assignment_query,
                production_line=outgoing_assignment.production_line,
                team_leader__is_active=True,
            )
            .exclude(pk=outgoing_assignment.pk)
            .exclude(team_leader=outgoing_assignment.team_leader)
            .order_by("date", "shift_type", "id")
        )

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
        line_update = serializer.save(recorded_by=self.request.user)
        detect_break_opportunity(line_update)

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
            "asset",
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
                | Q(
                    shift_handovers__incoming_assignment__team_leader=(
                        self.request.user
                    )
                )
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
            context={"escalation": escalation},
        )
        input_serializer.is_valid(raise_exception=True)
        escalation.asset = input_serializer.validated_data.get(
            "asset",
            escalation.asset,
        )
        escalation.loss_minutes = input_serializer.validated_data.get(
            "loss_minutes",
            escalation.loss_minutes,
        )
        escalation.estimated_lost_units = input_serializer.validated_data.get(
            "estimated_lost_units",
            escalation.estimated_lost_units,
        )
        escalation.status = OperationalEscalation.Status.RESOLVED
        escalation.resolution_notes = input_serializer.validated_data[
            "resolution_notes"
        ]
        escalation.resolved_at = timezone.now()
        escalation.resolved_by = request.user
        escalation.save(
            update_fields=(
                "asset",
                "loss_minutes",
                "estimated_lost_units",
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


@extend_schema_view(
    list=extend_schema(
        parameters=[ShiftHandoverFilterSerializer],
    ),
)
class ShiftHandoverViewSet(viewsets.ModelViewSet):
    queryset = ShiftHandover.objects.all()
    serializer_class = ShiftHandoverSerializer
    permission_classes = (IsHandoverParticipantOrStaff,)
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
        "operational_summary",
        "notes",
        "outgoing_assignment__production_line__code",
        "outgoing_assignment__production_line__name",
        "outgoing_assignment__team_leader__username",
        "incoming_assignment__team_leader__username",
        "escalations__summary",
        "escalations__owner__username",
    )
    ordering_fields = (
        "handed_over_at",
        "accepted_at",
        "status",
        "outgoing_assignment__date",
        "incoming_assignment__date",
        "outgoing_assignment__production_line__code",
        "created_at",
    )
    ordering = (
        "status",
        "-handed_over_at",
    )

    def get_queryset(self):
        escalation_queryset = OperationalEscalation.objects.select_related(
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
        queryset = self.queryset.select_related(
            "outgoing_assignment",
            "outgoing_assignment__production_line",
            "outgoing_assignment__team_leader",
            "incoming_assignment",
            "incoming_assignment__production_line",
            "incoming_assignment__team_leader",
            "handed_over_by",
            "accepted_by",
        ).prefetch_related(
            Prefetch(
                "escalations",
                queryset=escalation_queryset,
            ),
        )

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                Q(outgoing_assignment__team_leader=self.request.user)
                | Q(incoming_assignment__team_leader=self.request.user)
            )

        filter_serializer = ShiftHandoverFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")
        status_value = filter_serializer.validated_data.get("status")
        awaiting_acceptance = filter_serializer.validated_data.get(
            "awaiting_acceptance"
        )

        if date is not None:
            queryset = queryset.filter(
                outgoing_assignment__date=date,
            )

        if shift_type is not None:
            queryset = queryset.filter(
                outgoing_assignment__shift_type=shift_type,
            )

        if production_line is not None:
            queryset = queryset.filter(
                outgoing_assignment__production_line_id=production_line,
            )

        if status_value is not None:
            queryset = queryset.filter(status=status_value)

        if awaiting_acceptance is not None:
            if awaiting_acceptance:
                queryset = queryset.filter(
                    status=ShiftHandover.Status.PENDING,
                )
                if not self.request.user.is_staff:
                    queryset = queryset.filter(
                        incoming_assignment__team_leader=self.request.user,
                    )
            else:
                queryset = queryset.exclude(
                    status=ShiftHandover.Status.PENDING,
                )

        return queryset.distinct()

    def perform_create(self, serializer):
        serializer.save(handed_over_by=self.request.user)

    @extend_schema(
        request=None,
        responses=ShiftHandoverSerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="accept",
    )
    def accept(self, request, pk=None):
        handover = self.get_object()

        if handover.status != ShiftHandover.Status.PENDING:
            raise ValidationError(
                {"status": "Only a pending handover can be accepted."}
            )

        if (
            not request.user.is_staff
            and handover.incoming_assignment.team_leader_id != request.user.id
        ):
            raise PermissionDenied(
                "Only the incoming Team Leader or management "
                "staff can accept this handover."
            )

        unresolved_escalations = handover.escalations.exclude(
            status=OperationalEscalation.Status.RESOLVED,
        )
        handover.escalations.set(unresolved_escalations)

        handover.status = ShiftHandover.Status.ACCEPTED
        handover.accepted_at = timezone.now()
        handover.accepted_by = request.user
        handover.save(
            update_fields=(
                "status",
                "accepted_at",
                "accepted_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(handover)
        return Response(serializer.data)


@extend_schema_view(
    list=extend_schema(parameters=[DailyPlanBlockFilterSerializer]),
)
class DailyPlanBlockViewSet(viewsets.ModelViewSet):
    queryset = DailyPlanBlock.objects.all()
    serializer_class = DailyPlanBlockSerializer
    permission_classes = (IsStaffOrReadOnly,)
    http_method_names = ("get", "post", "head", "options")
    ordering = ("planned_start_at", "sequence_number")

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "created_by",
        )
        if not self.request.user.is_staff:
            queryset = queryset.filter(assignment__team_leader=self.request.user)

        filter_serializer = DailyPlanBlockFilterSerializer(
            data=self.request.query_params
        )
        filter_serializer.is_valid(raise_exception=True)
        filters_data = filter_serializer.validated_data
        if filters_data.get("date"):
            queryset = queryset.filter(assignment__date=filters_data["date"])
        if filters_data.get("assignment"):
            queryset = queryset.filter(assignment_id=filters_data["assignment"])
        if filters_data.get("production_line"):
            queryset = queryset.filter(
                assignment__production_line_id=filters_data["production_line"]
            )
        if filters_data.get("block_type"):
            queryset = queryset.filter(block_type=filters_data["block_type"])
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


@extend_schema_view(
    list=extend_schema(parameters=[BreakOpportunityFilterSerializer]),
)
class BreakOpportunityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = BreakOpportunity.objects.all()
    serializer_class = BreakOpportunitySerializer
    permission_classes = (IsAssignedTeamLeaderOrStaff,)
    ordering = ("status", "-fault_at")

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "break_block",
            "source_update",
        )
        if not self.request.user.is_staff:
            queryset = queryset.filter(assignment__team_leader=self.request.user)

        filter_serializer = BreakOpportunityFilterSerializer(
            data=self.request.query_params
        )
        filter_serializer.is_valid(raise_exception=True)
        filters_data = filter_serializer.validated_data
        if filters_data.get("date"):
            queryset = queryset.filter(assignment__date=filters_data["date"])
        if filters_data.get("assignment"):
            queryset = queryset.filter(assignment_id=filters_data["assignment"])
        if filters_data.get("status"):
            queryset = queryset.filter(status=filters_data["status"])
        return queryset

    def _require_team_leader(self, opportunity):
        if not self.request.user.is_staff and (
            opportunity.assignment.team_leader_id != self.request.user.id
        ):
            raise PermissionDenied(
                "Only the assigned Team Leader or management staff can update this opportunity."
            )

    def _save_transition(self, opportunity, fields):
        opportunity.full_clean()
        opportunity.save(update_fields=(*fields, "updated_at"))
        return Response(self.get_serializer(opportunity).data)

    @extend_schema(request=None, responses=BreakOpportunitySerializer)
    @action(detail=True, methods=("post",), url_path="confirm")
    def confirm(self, request, pk=None):
        opportunity = self.get_object()
        self._require_team_leader(opportunity)
        if opportunity.status != BreakOpportunity.Status.SUGGESTED:
            raise ValidationError(
                {"status": "Only a suggested opportunity can be confirmed."}
            )
        opportunity.status = BreakOpportunity.Status.CONFIRMED
        opportunity.confirmed_at = timezone.now()
        opportunity.confirmed_by = request.user
        opportunity.expected_return_at = opportunity.confirmed_at + timedelta(
            minutes=40
        )
        return self._save_transition(
            opportunity,
            ("status", "confirmed_at", "confirmed_by", "expected_return_at"),
        )

    @extend_schema(
        request=BreakOpportunityDeclineSerializer,
        responses=BreakOpportunitySerializer,
    )
    @action(detail=True, methods=("post",), url_path="decline")
    def decline(self, request, pk=None):
        opportunity = self.get_object()
        self._require_team_leader(opportunity)
        if opportunity.status != BreakOpportunity.Status.SUGGESTED:
            raise ValidationError(
                {"status": "Only a suggested opportunity can be declined."}
            )
        input_serializer = BreakOpportunityDeclineSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        opportunity.status = BreakOpportunity.Status.DECLINED
        opportunity.declined_at = timezone.now()
        opportunity.declined_by = request.user
        opportunity.decline_reason = input_serializer.validated_data["decline_reason"]
        return self._save_transition(
            opportunity,
            ("status", "declined_at", "declined_by", "decline_reason"),
        )

    @extend_schema(request=None, responses=BreakOpportunitySerializer)
    @action(detail=True, methods=("post",), url_path="return")
    def record_return(self, request, pk=None):
        opportunity = self.get_object()
        self._require_team_leader(opportunity)
        if opportunity.status != BreakOpportunity.Status.CONFIRMED:
            raise ValidationError(
                {"status": "Return can only follow a confirmed break."}
            )
        if timezone.now() < opportunity.expected_return_at:
            raise ValidationError(
                {"status": "The approved 40-minute break has not finished yet."}
            )
        opportunity.status = BreakOpportunity.Status.RETURNED
        opportunity.returned_at = timezone.now()
        return self._save_transition(opportunity, ("status", "returned_at"))

    @extend_schema(request=None, responses=BreakOpportunitySerializer)
    @action(detail=True, methods=("post",), url_path="complete-checks")
    def complete_checks(self, request, pk=None):
        opportunity = self.get_object()
        self._require_team_leader(opportunity)
        if opportunity.status != BreakOpportunity.Status.RETURNED:
            raise ValidationError(
                {"status": "Checks can only follow the recorded return."}
            )
        opportunity.status = BreakOpportunity.Status.CHECKS_COMPLETE
        opportunity.checks_completed_at = timezone.now()
        return self._save_transition(opportunity, ("status", "checks_completed_at"))

    @extend_schema(
        request=BreakOpportunityResumeSerializer,
        responses=BreakOpportunitySerializer,
    )
    @action(detail=True, methods=("post",), url_path="resume")
    def resume(self, request, pk=None):
        opportunity = self.get_object()
        self._require_team_leader(opportunity)
        if opportunity.status != BreakOpportunity.Status.CHECKS_COMPLETE:
            raise ValidationError({"status": "Run resume requires completed checks."})
        input_serializer = BreakOpportunityResumeSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        opportunity.status = BreakOpportunity.Status.RECOVERED
        opportunity.run_resumed_at = timezone.now()
        opportunity.recovery_notes = input_serializer.validated_data["recovery_notes"]
        return self._save_transition(
            opportunity,
            ("status", "run_resumed_at", "recovery_notes"),
        )


@extend_schema_view(
    list=extend_schema(
        parameters=[BreakRecoveryFilterSerializer],
    ),
)
class BreakRecoveryViewSet(viewsets.ModelViewSet):
    queryset = BreakRecovery.objects.all()
    serializer_class = BreakRecoverySerializer
    permission_classes = (IsBreakRecoveryParticipantOrStaff,)
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
        "assignment__production_line__code",
        "assignment__production_line__name",
        "assignment__team_leader__username",
        "cover_user__username",
        "coverage_notes",
        "recovery_notes",
        "cancellation_reason",
    )
    ordering_fields = (
        "planned_start_at",
        "expected_return_at",
        "coverage_accepted_at",
        "started_at",
        "recovered_at",
        "status",
        "assignment__date",
        "assignment__production_line__code",
        "created_at",
    )
    ordering = (
        "status",
        "planned_start_at",
    )

    def get_queryset(self):
        queryset = self.queryset.select_related(
            "assignment",
            "assignment__production_line",
            "assignment__team_leader",
            "cover_user",
            "created_by",
            "coverage_accepted_by",
            "started_by",
            "recovered_by",
            "cancelled_by",
        )

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                Q(assignment__team_leader=self.request.user)
                | Q(cover_user=self.request.user)
            )

        filter_serializer = BreakRecoveryFilterSerializer(
            data=self.request.query_params,
        )
        filter_serializer.is_valid(raise_exception=True)

        date = filter_serializer.validated_data.get("date")
        shift_type = filter_serializer.validated_data.get("shift_type")
        production_line = filter_serializer.validated_data.get("production_line")
        status_value = filter_serializer.validated_data.get("status")
        cover_user = filter_serializer.validated_data.get("cover_user")
        attention_required = filter_serializer.validated_data.get("attention_required")

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

        if cover_user is not None:
            queryset = queryset.filter(cover_user_id=cover_user)

        if attention_required is not None:
            now = timezone.now()
            attention_query = Q(
                status__in=(
                    BreakRecovery.Status.PLANNED,
                    BreakRecovery.Status.COVERAGE_ACCEPTED,
                ),
                planned_start_at__lt=now,
            ) | Q(
                status=BreakRecovery.Status.ACTIVE,
                expected_return_at__lt=now,
            )

            if attention_required:
                queryset = queryset.filter(attention_query)
            else:
                queryset = queryset.exclude(attention_query)

        return queryset.distinct()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @extend_schema(
        request=None,
        responses=BreakRecoverySerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="accept-coverage",
    )
    def accept_coverage(self, request, pk=None):
        break_recovery = self.get_object()

        if break_recovery.status != BreakRecovery.Status.PLANNED:
            raise ValidationError(
                {"status": "Only planned break coverage can be accepted."}
            )

        if break_recovery.cover_user_id != request.user.id:
            raise PermissionDenied(
                "Only the nominated cover user can accept break coverage."
            )

        break_recovery.status = BreakRecovery.Status.COVERAGE_ACCEPTED
        break_recovery.coverage_accepted_at = timezone.now()
        break_recovery.coverage_accepted_by = request.user
        break_recovery.save(
            update_fields=(
                "status",
                "coverage_accepted_at",
                "coverage_accepted_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(break_recovery)
        return Response(serializer.data)

    @extend_schema(
        request=None,
        responses=BreakRecoverySerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="start",
    )
    def start(self, request, pk=None):
        break_recovery = self.get_object()

        if break_recovery.status != BreakRecovery.Status.COVERAGE_ACCEPTED:
            raise ValidationError(
                {"status": "Break coverage must be accepted before break start."}
            )

        if (
            not request.user.is_staff
            and break_recovery.assignment.team_leader_id != request.user.id
        ):
            raise PermissionDenied(
                "Only the assigned Team Leader or management staff can start the break."
            )

        break_recovery.status = BreakRecovery.Status.ACTIVE
        break_recovery.started_at = timezone.now()
        break_recovery.started_by = request.user
        break_recovery.save(
            update_fields=(
                "status",
                "started_at",
                "started_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(break_recovery)
        return Response(serializer.data)

    @extend_schema(
        request=BreakRecoveryCompleteSerializer,
        responses=BreakRecoverySerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="recover",
    )
    def recover(self, request, pk=None):
        break_recovery = self.get_object()

        if break_recovery.status != BreakRecovery.Status.ACTIVE:
            raise ValidationError({"status": "Only an active break can be recovered."})

        if (
            not request.user.is_staff
            and break_recovery.assignment.team_leader_id != request.user.id
        ):
            raise PermissionDenied(
                "Only the assigned Team Leader or management staff can confirm recovery."
            )

        input_serializer = BreakRecoveryCompleteSerializer(
            data=request.data,
        )
        input_serializer.is_valid(raise_exception=True)

        break_recovery.status = BreakRecovery.Status.RECOVERED
        break_recovery.recovery_notes = input_serializer.validated_data[
            "recovery_notes"
        ]
        break_recovery.recovered_at = timezone.now()
        break_recovery.recovered_by = request.user
        break_recovery.save(
            update_fields=(
                "status",
                "recovery_notes",
                "recovered_at",
                "recovered_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(break_recovery)
        return Response(serializer.data)

    @extend_schema(
        request=BreakRecoveryCancelSerializer,
        responses=BreakRecoverySerializer,
    )
    @action(
        detail=True,
        methods=("post",),
        url_path="cancel",
    )
    def cancel(self, request, pk=None):
        break_recovery = self.get_object()

        if break_recovery.status not in {
            BreakRecovery.Status.PLANNED,
            BreakRecovery.Status.COVERAGE_ACCEPTED,
        }:
            raise ValidationError(
                {"status": "Only a planned or accepted break can be cancelled."}
            )

        if (
            not request.user.is_staff
            and break_recovery.assignment.team_leader_id != request.user.id
        ):
            raise PermissionDenied(
                "Only the assigned Team Leader or management staff can cancel the break."
            )

        input_serializer = BreakRecoveryCancelSerializer(
            data=request.data,
        )
        input_serializer.is_valid(raise_exception=True)

        break_recovery.status = BreakRecovery.Status.CANCELLED
        break_recovery.cancellation_reason = input_serializer.validated_data[
            "cancellation_reason"
        ]
        break_recovery.cancelled_at = timezone.now()
        break_recovery.cancelled_by = request.user
        break_recovery.save(
            update_fields=(
                "status",
                "cancellation_reason",
                "cancelled_at",
                "cancelled_by",
                "updated_at",
            ),
        )

        serializer = self.get_serializer(break_recovery)
        return Response(serializer.data)


class ProductionAssetViewSet(viewsets.ModelViewSet):
    queryset = ProductionAsset.objects.select_related(
        "production_line",
    )
    serializer_class = ProductionAssetSerializer
    permission_classes = (IsStaffOrReadOnly,)
    filter_backends = (
        filters.SearchFilter,
        filters.OrderingFilter,
    )
    search_fields = (
        "code",
        "name",
        "manufacturer",
        "model_number",
        "serial_number",
        "production_line__code",
        "production_line__name",
    )
    ordering_fields = (
        "code",
        "name",
        "asset_type",
        "status",
        "created_at",
    )
    ordering = (
        "production_line__code",
        "code",
    )

    def get_queryset(self):
        queryset = self.queryset
        production_line = self.request.query_params.get("production_line")
        status_value = self.request.query_params.get("status")
        asset_type = self.request.query_params.get("asset_type")

        if production_line:
            queryset = queryset.filter(
                production_line_id=production_line,
            )

        if status_value:
            queryset = queryset.filter(status=status_value)

        if asset_type:
            queryset = queryset.filter(asset_type=asset_type)

        return queryset
