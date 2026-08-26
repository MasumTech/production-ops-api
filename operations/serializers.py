from rest_framework import serializers

from .models import (
    ProductionLine,
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
