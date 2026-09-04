from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .access import WorkspaceRole, workspace_role_for_user
from .models import (
    BreakRecovery,
    HourlyLineUpdate,
    OperationalEscalation,
    OperationalEvent,
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)

User = get_user_model()


class UserChoiceSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "display_name",
        )
        read_only_fields = fields

    def get_display_name(self, obj) -> str:
        return obj.get_full_name() or obj.username


class CurrentUserSerializer(UserChoiceSerializer):
    workspace = serializers.SerializerMethodField()

    class Meta(UserChoiceSerializer.Meta):
        fields = (*UserChoiceSerializer.Meta.fields, "is_staff", "workspace")
        read_only_fields = fields

    def get_workspace(self, obj) -> WorkspaceRole:
        return workspace_role_for_user(obj)


class OperationalEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OperationalEvent
        fields = (
            "id",
            "event_type",
            "resource_type",
            "resource_id",
            "assignment",
            "production_line",
            "actor",
            "severity",
            "metadata",
            "occurred_at",
        )
        read_only_fields = fields


class OperationalEventFilterSerializer(serializers.Serializer):
    after = serializers.IntegerField(required=False, min_value=0)


class OperationalEventCursorSerializer(serializers.Serializer):
    cursor = serializers.IntegerField(min_value=0)


class ProductionLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductionLine
        fields = (
            "id",
            "code",
            "name",
            "location",
            "target_units_per_hour",
            "status",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ProductionAssetSerializer(serializers.ModelSerializer):
    production_line_code = serializers.CharField(
        source="production_line.code",
        read_only=True,
    )

    class Meta:
        model = ProductionAsset
        fields = (
            "id",
            "production_line",
            "production_line_code",
            "code",
            "name",
            "asset_type",
            "manufacturer",
            "model_number",
            "serial_number",
            "commissioned_on",
            "status",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "production_line_code",
            "created_at",
            "updated_at",
        )


class ShiftSerializer(serializers.ModelSerializer):
    production_line_code = serializers.CharField(
        source="production_line.code",
        read_only=True,
    )
    supervisor_username = serializers.CharField(
        source="supervisor.username",
        read_only=True,
    )
    performance_percentage = serializers.FloatField(read_only=True)

    class Meta:
        model = Shift
        fields = (
            "id",
            "production_line",
            "production_line_code",
            "supervisor",
            "supervisor_username",
            "date",
            "shift_type",
            "start_time",
            "end_time",
            "planned_output",
            "actual_output",
            "downtime_minutes",
            "performance_percentage",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "performance_percentage",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        start_time = attrs.get(
            "start_time",
            getattr(self.instance, "start_time", None),
        )
        end_time = attrs.get(
            "end_time",
            getattr(self.instance, "end_time", None),
        )

        if start_time and end_time and start_time == end_time:
            raise serializers.ValidationError(
                {"end_time": ("End time must be different from start time.")}
            )

        return attrs


class TeamLeaderAssignmentSerializer(serializers.ModelSerializer):
    production_line_code = serializers.CharField(
        source="production_line.code",
        read_only=True,
    )
    production_line_name = serializers.CharField(
        source="production_line.name",
        read_only=True,
    )
    team_leader_username = serializers.CharField(
        source="team_leader.username",
        read_only=True,
    )
    assigned_by_username = serializers.CharField(
        source="assigned_by.username",
        read_only=True,
    )

    class Meta:
        model = TeamLeaderAssignment
        fields = (
            "id",
            "team_leader",
            "team_leader_username",
            "production_line",
            "production_line_code",
            "production_line_name",
            "date",
            "shift_type",
            "assigned_by",
            "assigned_by_username",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "assigned_by",
            "assigned_by_username",
            "created_at",
            "updated_at",
        )

    def validate_team_leader(self, value):
        if not value.is_active:
            raise serializers.ValidationError(
                "An inactive user cannot be assigned as Team Leader."
            )

        return value

    def validate_production_line(self, value):
        if value.status == ProductionLine.Status.INACTIVE:
            raise serializers.ValidationError(
                "An inactive production line cannot be assigned."
            )

        return value


class TeamLeaderAssignmentFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )


class QualityIncidentSerializer(serializers.ModelSerializer):
    shift_display = serializers.StringRelatedField(
        source="shift",
        read_only=True,
    )
    reported_by_username = serializers.CharField(
        source="reported_by.username",
        read_only=True,
    )

    class Meta:
        model = QualityIncident
        fields = (
            "id",
            "shift",
            "shift_display",
            "title",
            "category",
            "severity",
            "status",
            "description",
            "immediate_action",
            "root_cause",
            "corrective_action",
            "occurred_at",
            "resolved_at",
            "reported_by",
            "reported_by_username",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "reported_by",
            "reported_by_username",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        occurred_at = attrs.get(
            "occurred_at",
            getattr(self.instance, "occurred_at", None),
        )
        resolved_at = attrs.get(
            "resolved_at",
            getattr(self.instance, "resolved_at", None),
        )
        status = attrs.get(
            "status",
            getattr(
                self.instance,
                "status",
                QualityIncident.Status.OPEN,
            ),
        )

        if occurred_at and resolved_at and resolved_at < occurred_at:
            raise serializers.ValidationError(
                {"resolved_at": ("Resolution time cannot precede occurrence time.")}
            )

        resolved_statuses = {
            QualityIncident.Status.RESOLVED,
            QualityIncident.Status.CLOSED,
        }

        if status in resolved_statuses and resolved_at is None:
            raise serializers.ValidationError(
                {
                    "resolved_at": (
                        "Resolution time is required when an incident "
                        "is resolved or closed."
                    )
                }
            )

        return attrs


class OperationsDashboardSummarySerializer(serializers.Serializer):
    total_shifts = serializers.IntegerField()
    total_planned_output = serializers.IntegerField()
    total_actual_output = serializers.IntegerField()
    overall_performance_percentage = serializers.FloatField(
        allow_null=True,
    )
    total_downtime_minutes = serializers.IntegerField()
    open_incidents = serializers.IntegerField()
    critical_incidents = serializers.IntegerField()


class OperationsDashboardFilterSerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")

        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError(
                {"date_to": ("Date to must be on or after date from.")}
            )

        return attrs


class HourlyLineUpdateSerializer(serializers.ModelSerializer):
    production_line = serializers.IntegerField(
        source="assignment.production_line_id",
        read_only=True,
    )
    production_line_code = serializers.CharField(
        source="assignment.production_line.code",
        read_only=True,
    )
    production_line_name = serializers.CharField(
        source="assignment.production_line.name",
        read_only=True,
    )
    assignment_date = serializers.DateField(
        source="assignment.date",
        read_only=True,
    )
    shift_type = serializers.CharField(
        source="assignment.shift_type",
        read_only=True,
    )
    team_leader_username = serializers.CharField(
        source="assignment.team_leader.username",
        read_only=True,
    )
    action_owner_username = serializers.CharField(
        source="action_owner.username",
        read_only=True,
    )
    recorded_by_username = serializers.CharField(
        source="recorded_by.username",
        read_only=True,
    )

    class Meta:
        model = HourlyLineUpdate
        fields = (
            "id",
            "assignment",
            "assignment_date",
            "shift_type",
            "production_line",
            "production_line_code",
            "production_line_name",
            "team_leader_username",
            "status",
            "current_product",
            "issue_summary",
            "action_taken",
            "action_owner",
            "action_owner_username",
            "support_required",
            "requires_follow_up",
            "recorded_at",
            "next_update_due_at",
            "recorded_by",
            "recorded_by_username",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "recorded_at",
            "recorded_by",
            "recorded_by_username",
            "created_at",
            "updated_at",
        )

    def validate_assignment(self, value):
        request = self.context.get("request")

        if (
            request
            and request.user.is_authenticated
            and not request.user.is_staff
            and value.team_leader_id != request.user.id
        ):
            raise serializers.ValidationError(
                "You can only update a line assigned to you."
            )

        return value

    def validate_action_owner(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError("An inactive user cannot own an action.")

        return value

    def validate(self, attrs):
        instance = self.instance

        status_value = attrs.get(
            "status",
            getattr(instance, "status", None),
        )
        issue_summary = attrs.get(
            "issue_summary",
            getattr(instance, "issue_summary", ""),
        )
        requires_follow_up = attrs.get(
            "requires_follow_up",
            getattr(instance, "requires_follow_up", False),
        )
        recorded_at = getattr(
            instance,
            "recorded_at",
            timezone.now(),
        )
        next_update_due_at = attrs.get(
            "next_update_due_at",
            getattr(instance, "next_update_due_at", None),
        )

        errors = {}

        if next_update_due_at and next_update_due_at <= recorded_at:
            errors["next_update_due_at"] = (
                "Next update time must be later than the recorded time."
            )

        if (
            status_value
            in {
                HourlyLineUpdate.Status.AMBER,
                HourlyLineUpdate.Status.RED,
            }
            and not (issue_summary or "").strip()
        ):
            errors["issue_summary"] = (
                "Issue summary is required for Amber or Red status."
            )

        if status_value == HourlyLineUpdate.Status.RED and not requires_follow_up:
            errors["requires_follow_up"] = "Red status must require follow-up."

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class HourlyLineUpdateFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    status = serializers.ChoiceField(
        choices=HourlyLineUpdate.Status.choices,
        required=False,
    )
    requires_follow_up = serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
    )


class ProductMaterialReadinessSerializer(serializers.ModelSerializer):
    assignment_date = serializers.DateField(
        source="assignment.date",
        read_only=True,
    )
    shift_type = serializers.CharField(
        source="assignment.shift_type",
        read_only=True,
    )
    production_line = serializers.IntegerField(
        source="assignment.production_line_id",
        read_only=True,
    )
    production_line_code = serializers.CharField(
        source="assignment.production_line.code",
        read_only=True,
    )
    team_leader_username = serializers.CharField(
        source="assignment.team_leader.username",
        read_only=True,
    )
    owner_username = serializers.CharField(
        source="owner.username",
        read_only=True,
    )
    released_by_username = serializers.CharField(
        source="released_by.username",
        read_only=True,
    )
    created_by_username = serializers.CharField(
        source="created_by.username",
        read_only=True,
    )

    class Meta:
        model = ProductMaterialReadiness
        fields = (
            "id",
            "assignment",
            "assignment_date",
            "shift_type",
            "production_line",
            "production_line_code",
            "team_leader_username",
            "sequence_number",
            "product_code",
            "product_name",
            "planned_quantity",
            "status",
            "shortage_quantity",
            "owner",
            "owner_username",
            "expected_available_at",
            "hold_reason",
            "released_at",
            "released_by",
            "released_by_username",
            "created_by",
            "created_by_username",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "released_at",
            "released_by",
            "released_by_username",
            "created_by",
            "created_by_username",
            "created_at",
            "updated_at",
        )

    def validate_assignment(self, value):
        request = self.context.get("request")

        if (
            request
            and request.user.is_authenticated
            and not request.user.is_staff
            and value.team_leader_id != request.user.id
        ):
            raise serializers.ValidationError(
                "You can only manage readiness for a line assigned to you."
            )

        return value

    def validate_owner(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError(
                "An inactive user cannot own a material action."
            )

        return value

    def validate(self, attrs):
        instance = self.instance
        status_value = attrs.get(
            "status",
            getattr(instance, "status", ProductMaterialReadiness.Status.READY),
        )
        shortage_quantity = attrs.get(
            "shortage_quantity",
            getattr(instance, "shortage_quantity", 0),
        )
        owner = attrs.get(
            "owner",
            getattr(instance, "owner", None),
        )
        expected_available_at = attrs.get(
            "expected_available_at",
            getattr(instance, "expected_available_at", None),
        )
        hold_reason = attrs.get(
            "hold_reason",
            getattr(instance, "hold_reason", ""),
        )

        errors = {}

        if status_value == ProductMaterialReadiness.Status.SHORT:
            if not shortage_quantity:
                errors["shortage_quantity"] = (
                    "Short material must include a shortage quantity."
                )
            if owner is None:
                errors["owner"] = "Short material must have an owner."
            if expected_available_at is None:
                errors["expected_available_at"] = (
                    "Short material must include an expected availability time."
                )
        elif shortage_quantity:
            errors["shortage_quantity"] = (
                "Shortage quantity must be zero unless material status is Short."
            )

        if (
            status_value == ProductMaterialReadiness.Status.HELD
            and not (hold_reason or "").strip()
        ):
            errors["hold_reason"] = "Held material must include a hold reason."

        if (
            instance
            and instance.status == ProductMaterialReadiness.Status.HELD
            and status_value != ProductMaterialReadiness.Status.HELD
        ):
            errors["status"] = "Use the release action to release held material."

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class ProductMaterialReadinessFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    status = serializers.ChoiceField(
        choices=ProductMaterialReadiness.Status.choices,
        required=False,
    )
    owner = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    product_code = serializers.CharField(
        required=False,
        max_length=50,
    )


class OperationalEscalationSerializer(serializers.ModelSerializer):
    assignment_date = serializers.DateField(
        source="assignment.date",
        read_only=True,
    )
    shift_type = serializers.CharField(
        source="assignment.shift_type",
        read_only=True,
    )
    production_line = serializers.IntegerField(
        source="assignment.production_line_id",
        read_only=True,
    )
    production_line_code = serializers.CharField(
        source="assignment.production_line.code",
        read_only=True,
    )
    team_leader_username = serializers.CharField(
        source="assignment.team_leader.username",
        read_only=True,
    )
    owner_username = serializers.CharField(
        source="owner.username",
        read_only=True,
    )
    raised_by_username = serializers.CharField(
        source="raised_by.username",
        read_only=True,
    )
    acknowledged_by_username = serializers.CharField(
        source="acknowledged_by.username",
        read_only=True,
    )
    resolved_by_username = serializers.CharField(
        source="resolved_by.username",
        read_only=True,
    )
    asset_code = serializers.CharField(
        source="asset.code",
        read_only=True,
    )
    asset_name = serializers.CharField(
        source="asset.name",
        read_only=True,
    )
    is_overdue = serializers.BooleanField(read_only=True)
    needs_attention = serializers.BooleanField(read_only=True)

    class Meta:
        model = OperationalEscalation
        fields = (
            "id",
            "assignment",
            "assignment_date",
            "asset",
            "asset_code",
            "asset_name",
            "shift_type",
            "production_line",
            "production_line_code",
            "team_leader_username",
            "hourly_update",
            "quality_incident",
            "loss_minutes",
            "estimated_lost_units",
            "category",
            "priority",
            "status",
            "summary",
            "details",
            "immediate_action",
            "owner",
            "owner_username",
            "raised_at",
            "response_due_at",
            "raised_by",
            "raised_by_username",
            "acknowledged_at",
            "acknowledged_by",
            "acknowledged_by_username",
            "resolution_notes",
            "resolved_at",
            "resolved_by",
            "resolved_by_username",
            "is_overdue",
            "needs_attention",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "raised_at",
            "raised_by",
            "raised_by_username",
            "acknowledged_at",
            "acknowledged_by",
            "acknowledged_by_username",
            "resolution_notes",
            "resolved_at",
            "resolved_by",
            "resolved_by_username",
            "is_overdue",
            "needs_attention",
            "created_at",
            "updated_at",
        )

    def validate_assignment(self, value):
        request = self.context.get("request")

        if (
            request
            and request.user.is_authenticated
            and not request.user.is_staff
            and value.team_leader_id != request.user.id
        ):
            raise serializers.ValidationError(
                "You can only raise an escalation for a line assigned to you."
            )

        return value

    def validate_owner(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError(
                "An inactive user cannot own an escalation."
            )

        return value

    def validate(self, attrs):
        assignment = attrs.get("assignment")
        hourly_update = attrs.get("hourly_update")
        quality_incident = attrs.get("quality_incident")
        priority = attrs.get(
            "priority",
            OperationalEscalation.Priority.MEDIUM,
        )
        owner = attrs.get("owner")
        immediate_action = attrs.get("immediate_action", "")
        response_due_at = attrs.get("response_due_at")
        instance = self.instance
        assignment = attrs.get(
            "assignment",
            getattr(instance, "assignment", None),
        )
        category = attrs.get(
            "category",
            getattr(instance, "category", None),
        )
        asset = attrs.get(
            "asset",
            getattr(instance, "asset", None),
        )
        errors = {}

        if response_due_at and response_due_at <= timezone.now():
            errors["response_due_at"] = (
                "Response deadline must be later than the raised time."
            )

        if hourly_update and quality_incident:
            errors["hourly_update"] = (
                "Link either an hourly update or a quality incident, not both."
            )

        if (
            assignment
            and hourly_update
            and hourly_update.assignment_id != assignment.id
        ):
            errors["hourly_update"] = (
                "The hourly update must belong to the selected assignment."
            )

        if assignment and quality_incident:
            incident_shift = quality_incident.shift

            if (
                incident_shift.production_line_id != assignment.production_line_id
                or incident_shift.date != assignment.date
                or incident_shift.shift_type != assignment.shift_type
            ):
                errors["quality_incident"] = (
                    "The quality incident must belong to the selected line and shift."
                )

        if (
            priority
            in {
                OperationalEscalation.Priority.HIGH,
                OperationalEscalation.Priority.CRITICAL,
            }
            and owner is None
        ):
            errors["owner"] = "High or Critical escalation must have an owner."

        if (
            priority == OperationalEscalation.Priority.CRITICAL
            and not (immediate_action or "").strip()
        ):
            errors["immediate_action"] = (
                "Critical escalation must record an immediate action."
            )
        if asset and category != OperationalEscalation.Category.EQUIPMENT:
            errors["asset"] = "An asset can only be linked to an equipment escalation."

        if (
            asset
            and assignment
            and asset.production_line_id != assignment.production_line_id
        ):
            errors["asset"] = (
                "The selected asset must belong to the assignment production line."
            )

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class OperationalEscalationFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    category = serializers.ChoiceField(
        choices=OperationalEscalation.Category.choices,
        required=False,
    )
    priority = serializers.ChoiceField(
        choices=OperationalEscalation.Priority.choices,
        required=False,
    )
    status = serializers.ChoiceField(
        choices=OperationalEscalation.Status.choices,
        required=False,
    )
    owner = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    overdue = serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
    )
    unassigned = serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
    )


class OperationalEscalationResolveSerializer(serializers.Serializer):
    resolution_notes = serializers.CharField(
        allow_blank=False,
        trim_whitespace=True,
    )
    asset = serializers.PrimaryKeyRelatedField(
        queryset=ProductionAsset.objects.all(),
        required=False,
        allow_null=True,
    )
    loss_minutes = serializers.IntegerField(
        required=False,
        min_value=0,
    )
    estimated_lost_units = serializers.IntegerField(
        required=False,
        min_value=0,
    )

    def validate_asset(self, value):
        escalation = self.context["escalation"]

        if value is None:
            return value

        if escalation.category != OperationalEscalation.Category.EQUIPMENT:
            raise serializers.ValidationError(
                "An asset can only be linked to an equipment escalation."
            )

        if value.production_line_id != escalation.assignment.production_line_id:
            raise serializers.ValidationError(
                "The selected asset must belong to the escalation line."
            )

        return value


class ShiftHandoverSerializer(serializers.ModelSerializer):
    production_line = serializers.IntegerField(
        source="outgoing_assignment.production_line_id",
        read_only=True,
    )
    production_line_code = serializers.CharField(
        source="outgoing_assignment.production_line.code",
        read_only=True,
    )
    outgoing_date = serializers.DateField(
        source="outgoing_assignment.date",
        read_only=True,
    )
    outgoing_shift_type = serializers.CharField(
        source="outgoing_assignment.shift_type",
        read_only=True,
    )
    outgoing_team_leader_username = serializers.CharField(
        source="outgoing_assignment.team_leader.username",
        read_only=True,
    )
    incoming_date = serializers.DateField(
        source="incoming_assignment.date",
        read_only=True,
    )
    incoming_shift_type = serializers.CharField(
        source="incoming_assignment.shift_type",
        read_only=True,
    )
    incoming_team_leader_username = serializers.CharField(
        source="incoming_assignment.team_leader.username",
        read_only=True,
    )
    escalation_ids = serializers.PrimaryKeyRelatedField(
        source="escalations",
        queryset=OperationalEscalation.objects.all(),
        many=True,
        write_only=True,
        allow_empty=False,
    )
    escalations = OperationalEscalationSerializer(
        many=True,
        read_only=True,
    )
    handed_over_by_username = serializers.CharField(
        source="handed_over_by.username",
        read_only=True,
    )
    accepted_by_username = serializers.CharField(
        source="accepted_by.username",
        read_only=True,
    )

    class Meta:
        model = ShiftHandover
        fields = (
            "id",
            "outgoing_assignment",
            "incoming_assignment",
            "production_line",
            "production_line_code",
            "outgoing_date",
            "outgoing_shift_type",
            "outgoing_team_leader_username",
            "incoming_date",
            "incoming_shift_type",
            "incoming_team_leader_username",
            "escalation_ids",
            "escalations",
            "status",
            "operational_summary",
            "notes",
            "handed_over_at",
            "handed_over_by",
            "handed_over_by_username",
            "accepted_at",
            "accepted_by",
            "accepted_by_username",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "handed_over_at",
            "handed_over_by",
            "handed_over_by_username",
            "accepted_at",
            "accepted_by",
            "accepted_by_username",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        outgoing = attrs.get("outgoing_assignment")
        incoming = attrs.get("incoming_assignment")
        escalations = attrs.get("escalations", ())
        request = self.context.get("request")
        errors = {}

        if outgoing and incoming:
            if outgoing.id == incoming.id:
                errors["incoming_assignment"] = (
                    "Incoming assignment must differ from outgoing assignment."
                )
            elif outgoing.production_line_id != incoming.production_line_id:
                errors["incoming_assignment"] = (
                    "Incoming assignment must belong to the same production line."
                )
            elif ShiftHandover.assignment_order(
                incoming
            ) <= ShiftHandover.assignment_order(outgoing):
                errors["incoming_assignment"] = (
                    "Incoming assignment must occur after outgoing assignment."
                )

        if incoming and not incoming.team_leader.is_active:
            errors["incoming_assignment"] = "Incoming Team Leader must be active."

        if (
            request
            and request.user.is_authenticated
            and not request.user.is_staff
            and outgoing
            and outgoing.team_leader_id != request.user.id
        ):
            errors["outgoing_assignment"] = (
                "You can only hand over an assignment currently assigned to you."
            )

        escalation_errors = []

        for escalation in escalations:
            if outgoing and escalation.assignment_id != outgoing.id:
                escalation_errors.append(
                    f"Escalation {escalation.id} does not belong "
                    "to the outgoing assignment."
                )
            elif escalation.status == OperationalEscalation.Status.RESOLVED:
                escalation_errors.append(
                    f"Escalation {escalation.id} is already resolved."
                )

        if escalation_errors:
            errors["escalation_ids"] = escalation_errors

        if errors:
            raise serializers.ValidationError(errors)

        return attrs

    def create(self, validated_data):
        escalations = validated_data.pop("escalations")
        handover = ShiftHandover.objects.create(**validated_data)
        handover.escalations.set(escalations)
        return handover


class ShiftHandoverFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    status = serializers.ChoiceField(
        choices=ShiftHandover.Status.choices,
        required=False,
    )
    awaiting_acceptance = serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
    )


class BreakRecoverySerializer(serializers.ModelSerializer):
    production_line = serializers.IntegerField(
        source="assignment.production_line_id",
        read_only=True,
    )
    production_line_code = serializers.CharField(
        source="assignment.production_line.code",
        read_only=True,
    )
    assignment_date = serializers.DateField(
        source="assignment.date",
        read_only=True,
    )
    shift_type = serializers.CharField(
        source="assignment.shift_type",
        read_only=True,
    )
    team_leader_username = serializers.CharField(
        source="assignment.team_leader.username",
        read_only=True,
    )
    cover_user_username = serializers.CharField(
        source="cover_user.username",
        read_only=True,
    )
    created_by_username = serializers.CharField(
        source="created_by.username",
        read_only=True,
    )
    coverage_accepted_by_username = serializers.CharField(
        source="coverage_accepted_by.username",
        read_only=True,
    )
    started_by_username = serializers.CharField(
        source="started_by.username",
        read_only=True,
    )
    recovered_by_username = serializers.CharField(
        source="recovered_by.username",
        read_only=True,
    )
    cancelled_by_username = serializers.CharField(
        source="cancelled_by.username",
        read_only=True,
    )
    is_overdue = serializers.BooleanField(read_only=True)
    needs_attention = serializers.BooleanField(read_only=True)

    class Meta:
        model = BreakRecovery
        fields = (
            "id",
            "assignment",
            "assignment_date",
            "shift_type",
            "production_line",
            "production_line_code",
            "team_leader_username",
            "cover_user",
            "cover_user_username",
            "status",
            "planned_start_at",
            "expected_return_at",
            "coverage_notes",
            "created_by",
            "created_by_username",
            "coverage_accepted_at",
            "coverage_accepted_by",
            "coverage_accepted_by_username",
            "started_at",
            "started_by",
            "started_by_username",
            "recovered_at",
            "recovered_by",
            "recovered_by_username",
            "recovery_notes",
            "cancelled_at",
            "cancelled_by",
            "cancelled_by_username",
            "cancellation_reason",
            "is_overdue",
            "needs_attention",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "created_by",
            "created_by_username",
            "coverage_accepted_at",
            "coverage_accepted_by",
            "coverage_accepted_by_username",
            "started_at",
            "started_by",
            "started_by_username",
            "recovered_at",
            "recovered_by",
            "recovered_by_username",
            "recovery_notes",
            "cancelled_at",
            "cancelled_by",
            "cancelled_by_username",
            "cancellation_reason",
            "is_overdue",
            "needs_attention",
            "created_at",
            "updated_at",
        )

    def validate_assignment(self, value):
        request = self.context.get("request")

        if (
            request
            and request.user.is_authenticated
            and not request.user.is_staff
            and value.team_leader_id != request.user.id
        ):
            raise serializers.ValidationError(
                "You can only plan a break for an assignment owned by you."
            )

        return value

    def validate_cover_user(self, value):
        if not value.is_active:
            raise serializers.ValidationError("Break cover must be an active user.")

        return value

    def validate(self, attrs):
        assignment = attrs.get("assignment")
        cover_user = attrs.get("cover_user")
        planned_start_at = attrs.get("planned_start_at")
        expected_return_at = attrs.get("expected_return_at")
        errors = {}

        if assignment and cover_user and assignment.team_leader_id == cover_user.id:
            errors["cover_user"] = (
                "The assigned Team Leader cannot provide their own break cover."
            )

        if (
            planned_start_at
            and expected_return_at
            and expected_return_at <= planned_start_at
        ):
            errors["expected_return_at"] = (
                "Expected return time must be later than the planned start time."
            )

        if expected_return_at and expected_return_at <= timezone.now():
            errors["expected_return_at"] = "Expected return time must be in the future."

        if (
            assignment
            and BreakRecovery.objects.filter(
                assignment=assignment,
                status__in=(
                    BreakRecovery.Status.PLANNED,
                    BreakRecovery.Status.COVERAGE_ACCEPTED,
                    BreakRecovery.Status.ACTIVE,
                ),
            ).exists()
        ):
            errors["assignment"] = "This assignment already has an open break record."

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class BreakRecoveryFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    shift_type = serializers.ChoiceField(
        choices=Shift.ShiftType.choices,
        required=False,
    )
    production_line = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    status = serializers.ChoiceField(
        choices=BreakRecovery.Status.choices,
        required=False,
    )
    cover_user = serializers.IntegerField(
        required=False,
        min_value=1,
    )
    attention_required = serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
    )


class BreakRecoveryCompleteSerializer(serializers.Serializer):
    recovery_notes = serializers.CharField(
        allow_blank=False,
        trim_whitespace=True,
    )


class BreakRecoveryCancelSerializer(serializers.Serializer):
    cancellation_reason = serializers.CharField(
        allow_blank=False,
        trim_whitespace=True,
    )


class SupportCompanionFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)


class SupportCompanionSerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    assignments = TeamLeaderAssignmentSerializer(many=True)
    updates = HourlyLineUpdateSerializer(many=True)
    materials = ProductMaterialReadinessSerializer(many=True)
    escalations = OperationalEscalationSerializer(many=True)
