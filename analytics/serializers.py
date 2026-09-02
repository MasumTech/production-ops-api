from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from operations.models import (
    OperationalEscalation,
    ProductionAsset,
    ProductionLine,
)


class LossAnalyticsFilterSerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    production_line = serializers.PrimaryKeyRelatedField(
        queryset=ProductionLine.objects.all(),
        required=False,
    )
    asset = serializers.PrimaryKeyRelatedField(
        queryset=ProductionAsset.objects.all(),
        required=False,
    )
    recurring_threshold = serializers.IntegerField(
        required=False,
        min_value=2,
        max_value=20,
        default=3,
    )

    def validate(self, attrs):
        date_to = attrs.get("date_to", timezone.localdate())
        date_from = attrs.get(
            "date_from",
            date_to - timedelta(days=29),
        )
        production_line = attrs.get("production_line")
        asset = attrs.get("asset")

        if date_from > date_to:
            raise serializers.ValidationError(
                {"date_from": "Start date must not be after end date."}
            )

        if (date_to - date_from).days > 365:
            raise serializers.ValidationError(
                {"date_from": "Analytics range cannot exceed 366 days."}
            )

        if production_line and asset and asset.production_line_id != production_line.id:
            raise serializers.ValidationError(
                {"asset": "Asset must belong to the selected line."}
            )

        attrs["date_from"] = date_from
        attrs["date_to"] = date_to
        return attrs


class AssetLossRowSerializer(serializers.Serializer):
    asset_id = serializers.IntegerField()
    asset_code = serializers.CharField()
    asset_name = serializers.CharField()
    production_line_code = serializers.CharField()
    occurrences = serializers.IntegerField()
    affected_shifts = serializers.IntegerField()
    open_events = serializers.IntegerField()
    total_loss_minutes = serializers.IntegerField()
    total_estimated_lost_units = serializers.IntegerField()
    latest_event_at = serializers.DateTimeField()
    recurring = serializers.BooleanField()


class LineLossRowSerializer(serializers.Serializer):
    production_line_id = serializers.IntegerField()
    production_line_code = serializers.CharField()
    category = serializers.CharField()
    occurrences = serializers.IntegerField()
    affected_shifts = serializers.IntegerField()
    total_loss_minutes = serializers.IntegerField()
    total_estimated_lost_units = serializers.IntegerField()


class LossSummarySerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    total_events = serializers.IntegerField()
    total_loss_minutes = serializers.IntegerField()
    total_estimated_lost_units = serializers.IntegerField()
    unassigned_asset_events = serializers.IntegerField()
    recurring_asset_count = serializers.IntegerField()


class LossAnalyticsReportSerializer(serializers.Serializer):
    summary = LossSummarySerializer()
    assets = AssetLossRowSerializer(many=True)
    line_losses = LineLossRowSerializer(many=True)


RISK_LEVEL_CHOICES = OperationalEscalation.Priority.choices


class DailyRiskBriefingFilterSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    production_line = serializers.PrimaryKeyRelatedField(
        queryset=ProductionLine.objects.filter(
            status=ProductionLine.Status.ACTIVE,
        ),
        required=False,
    )

    def validate(self, attrs):
        attrs["date"] = attrs.get("date", timezone.localdate())
        return attrs


class RiskFactorSerializer(serializers.Serializer):
    code = serializers.CharField()
    source = serializers.CharField()
    severity = serializers.ChoiceField(choices=RISK_LEVEL_CHOICES)
    score = serializers.IntegerField(min_value=0, max_value=100)
    reason = serializers.CharField()
    evidence = serializers.JSONField()


class MissingDataWarningSerializer(serializers.Serializer):
    code = serializers.CharField()
    source = serializers.CharField()
    message = serializers.CharField()


class RiskMetricsSerializer(serializers.Serializer):
    assignment_count = serializers.IntegerField()
    shift_count = serializers.IntegerField()
    planned_output = serializers.IntegerField()
    actual_output = serializers.IntegerField()
    performance_percentage = serializers.FloatField(allow_null=True)
    downtime_minutes = serializers.IntegerField()
    latest_status = serializers.CharField(allow_null=True)
    latest_update_at = serializers.DateTimeField(allow_null=True)
    open_escalations = serializers.IntegerField()
    overdue_escalations = serializers.IntegerField()
    critical_escalations = serializers.IntegerField()
    unassigned_escalations = serializers.IntegerField()
    short_material_items = serializers.IntegerField()
    held_material_items = serializers.IntegerField()
    active_assets = serializers.IntegerField()
    recurring_asset_faults = serializers.IntegerField()
    confirmed_loss_minutes = serializers.IntegerField()
    estimated_lost_units = serializers.IntegerField()


class LineRiskBriefingSerializer(serializers.Serializer):
    production_line_id = serializers.IntegerField()
    production_line_code = serializers.CharField()
    production_line_name = serializers.CharField()
    risk_level = serializers.ChoiceField(choices=RISK_LEVEL_CHOICES)
    risk_score = serializers.IntegerField(min_value=0, max_value=100)
    confidence_percent = serializers.IntegerField(min_value=0, max_value=100)
    risk_factors = RiskFactorSerializer(many=True)
    missing_data_warnings = MissingDataWarningSerializer(many=True)
    metrics = RiskMetricsSerializer()


class RiskCountSerializer(serializers.Serializer):
    low = serializers.IntegerField()
    medium = serializers.IntegerField()
    high = serializers.IntegerField()
    critical = serializers.IntegerField()


class DailyRiskSummarySerializer(serializers.Serializer):
    date = serializers.DateField()
    generated_at = serializers.DateTimeField()
    rules_version = serializers.CharField()
    overall_risk_level = serializers.ChoiceField(choices=RISK_LEVEL_CHOICES)
    highest_risk_score = serializers.IntegerField(min_value=0, max_value=100)
    average_confidence_percent = serializers.IntegerField(min_value=0, max_value=100)
    lines_assessed = serializers.IntegerField()
    risk_counts = RiskCountSerializer()


class DailyRiskBriefingSerializer(serializers.Serializer):
    summary = DailyRiskSummarySerializer()
    lines = LineRiskBriefingSerializer(many=True)
