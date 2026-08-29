from django.utils import timezone
from rest_framework import serializers

from .models import (
    HourlyLineUpdate,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    TeamLeaderAssignment,
)


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
