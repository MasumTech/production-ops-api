from django.contrib import admin

from .models import (
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    TeamLeaderAssignment,
)


@admin.register(ProductionLine)
class ProductionLineAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "location",
        "status",
        "target_units_per_hour",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("code", "name", "location")
    ordering = ("code",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = (
        "production_line",
        "date",
        "shift_type",
        "supervisor",
        "planned_output",
        "actual_output",
        "performance",
        "downtime_minutes",
    )
    list_filter = ("shift_type", "date", "production_line")
    search_fields = (
        "production_line__code",
        "production_line__name",
        "supervisor__username",
        "supervisor__email",
    )
    autocomplete_fields = ("production_line", "supervisor")
    date_hierarchy = "date"
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("production_line", "supervisor")

    @admin.display(description="Performance")
    def performance(self, obj):
        percentage = obj.performance_percentage

        if percentage is None:
            return "N/A"

        return f"{percentage}%"


@admin.register(QualityIncident)
class QualityIncidentAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "shift",
        "category",
        "severity",
        "status",
        "occurred_at",
        "reported_by",
    )
    list_filter = ("category", "severity", "status", "occurred_at")
    search_fields = (
        "title",
        "description",
        "root_cause",
        "shift__production_line__code",
        "reported_by__username",
    )
    autocomplete_fields = ("shift", "reported_by")
    date_hierarchy = "occurred_at"
    readonly_fields = ("created_at", "updated_at")
    list_select_related = (
        "shift",
        "shift__production_line",
        "reported_by",
    )


@admin.register(TeamLeaderAssignment)
class TeamLeaderAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "shift_type",
        "production_line",
        "team_leader",
        "assigned_by",
        "created_at",
    )
    list_filter = (
        "date",
        "shift_type",
        "production_line",
    )
    search_fields = (
        "production_line__code",
        "production_line__name",
        "team_leader__username",
        "team_leader__email",
    )
    autocomplete_fields = (
        "production_line",
        "team_leader",
        "assigned_by",
    )
    date_hierarchy = "date"
    ordering = (
        "-date",
        "shift_type",
        "production_line__code",
    )
    readonly_fields = (
        "created_at",
        "updated_at",
    )
    list_select_related = (
        "production_line",
        "team_leader",
        "assigned_by",
    )


@admin.register(HourlyLineUpdate)
class HourlyLineUpdateAdmin(admin.ModelAdmin):
    list_display = (
        "recorded_at",
        "production_line",
        "status",
        "current_product",
        "recorded_by",
        "action_owner",
        "next_update_due_at",
        "requires_follow_up",
    )
    list_filter = (
        "status",
        "requires_follow_up",
        "recorded_at",
    )
    search_fields = (
        "assignment__production_line__code",
        "assignment__production_line__name",
        "current_product",
        "issue_summary",
        "recorded_by__username",
        "action_owner__username",
    )
    autocomplete_fields = (
        "assignment",
        "recorded_by",
        "action_owner",
    )
    date_hierarchy = "recorded_at"
    ordering = ("-recorded_at",)
    readonly_fields = (
        "created_at",
        "updated_at",
    )
    list_select_related = (
        "assignment",
        "assignment__production_line",
        "recorded_by",
        "action_owner",
    )

    @admin.display(
        ordering="assignment__production_line__code",
        description="Production line",
    )
    def production_line(self, obj):
        return obj.assignment.production_line.code


@admin.register(ProductMaterialReadiness)
class ProductMaterialReadinessAdmin(admin.ModelAdmin):
    list_display = (
        "assignment_date",
        "production_line",
        "sequence_number",
        "product_code",
        "product_name",
        "status",
        "shortage_quantity",
        "owner",
        "expected_available_at",
        "released_by",
    )
    list_filter = (
        "status",
        "assignment__date",
        "assignment__shift_type",
        "assignment__production_line",
    )
    search_fields = (
        "product_code",
        "product_name",
        "assignment__production_line__code",
        "assignment__team_leader__username",
        "owner__username",
    )
    autocomplete_fields = (
        "assignment",
        "owner",
        "released_by",
        "created_by",
    )
    ordering = (
        "-assignment__date",
        "assignment__shift_type",
        "assignment__production_line__code",
        "sequence_number",
    )
    readonly_fields = (
        "released_at",
        "released_by",
        "created_at",
        "updated_at",
    )
    list_select_related = (
        "assignment",
        "assignment__production_line",
        "assignment__team_leader",
        "owner",
        "released_by",
        "created_by",
    )

    @admin.display(
        ordering="assignment__date",
        description="Assignment date",
    )
    def assignment_date(self, obj):
        return obj.assignment.date

    @admin.display(
        ordering="assignment__production_line__code",
        description="Production line",
    )
    def production_line(self, obj):
        return obj.assignment.production_line.code


@admin.register(OperationalEscalation)
class OperationalEscalationAdmin(admin.ModelAdmin):
    list_display = (
        "raised_at",
        "production_line",
        "category",
        "priority",
        "status",
        "owner",
        "response_due_at",
        "is_overdue",
    )
    list_filter = (
        "category",
        "priority",
        "status",
        "assignment__date",
        "assignment__shift_type",
    )
    search_fields = (
        "summary",
        "details",
        "assignment__production_line__code",
        "assignment__team_leader__username",
        "owner__username",
    )
    autocomplete_fields = (
        "assignment",
        "hourly_update",
        "quality_incident",
        "owner",
        "raised_by",
        "acknowledged_by",
        "resolved_by",
    )
    readonly_fields = (
        "raised_at",
        "acknowledged_at",
        "acknowledged_by",
        "resolved_at",
        "resolved_by",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "raised_at"
    ordering = (
        "status",
        "response_due_at",
    )
    list_select_related = (
        "assignment",
        "assignment__production_line",
        "owner",
        "raised_by",
    )

    @admin.display(
        ordering="assignment__production_line__code",
        description="Production line",
    )
    def production_line(self, obj):
        return obj.assignment.production_line.code
