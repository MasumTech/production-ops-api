from django.contrib import admin

from .models import (
    HourlyLineUpdate,
    ProductionLine,
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
