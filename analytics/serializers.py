from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from operations.models import ProductionAsset, ProductionLine


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
