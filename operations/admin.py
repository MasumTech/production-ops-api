from django.contrib import admin

from .models import (
    BreakOpportunity,
    BreakRecovery,
    DailyPlanBlock,
    DowntimeEvent,
    HourlyLineUpdate,
    OperationalEscalation,
    OperationalEventReadReceipt,
    OperationalWorkerHeartbeat,
    PilotApproval,
    PilotFeedback,
    PilotObservation,
    PilotTrial,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)


@admin.register(DowntimeEvent)
class DowntimeEventAdmin(admin.ModelAdmin):
    list_display = (
        "started_at",
        "production_line",
        "duration_minutes",
        "reason_category",
        "description",
        "owner_group",
        "status",
    )
    list_filter = (
        "status",
        "reason_category",
        "owner_group",
        "shift__date",
        "shift__production_line",
    )
    search_fields = (
        "shift__production_line__code",
        "description",
        "resolution_note",
    )
    autocomplete_fields = ("shift",)
    readonly_fields = ("duration_minutes", "created_at", "updated_at")

    @admin.display(ordering="shift__production_line__code", description="Line")
    def production_line(self, obj):
        return obj.shift.production_line


@admin.register(DailyPlanBlock)
class DailyPlanBlockAdmin(admin.ModelAdmin):
    list_display = (
        "planned_start_at",
        "production_line",
        "block_type",
        "product_name",
        "target_units_per_hour",
        "break_number",
    )
    list_filter = ("block_type", "assignment__date", "assignment__production_line")
    search_fields = (
        "assignment__production_line__code",
        "product_code",
        "product_name",
    )
    autocomplete_fields = ("assignment", "created_by")
    readonly_fields = ("created_at", "updated_at")

    @admin.display(ordering="assignment__production_line__code", description="Line")
    def production_line(self, obj):
        return obj.assignment.production_line


@admin.register(BreakOpportunity)
class BreakOpportunityAdmin(admin.ModelAdmin):
    list_display = (
        "fault_at",
        "production_line",
        "break_block",
        "status",
        "run_resumed_at",
    )
    list_filter = ("status", "assignment__date", "assignment__production_line")
    search_fields = (
        "assignment__production_line__code",
        "source_update__issue_summary",
    )
    autocomplete_fields = (
        "assignment",
        "break_block",
        "source_update",
        "confirmed_by",
        "declined_by",
    )
    readonly_fields = (
        "confirmed_at",
        "confirmed_by",
        "returned_at",
        "checks_completed_at",
        "run_resumed_at",
        "declined_at",
        "declined_by",
        "created_at",
        "updated_at",
    )

    @admin.display(ordering="assignment__production_line__code", description="Line")
    def production_line(self, obj):
        return obj.assignment.production_line


@admin.register(PilotTrial)
class PilotTrialAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "start_date",
        "end_date",
        "status",
        "created_by",
        "decided_at",
    )
    list_filter = ("status", "start_date", "end_date")
    search_fields = ("name", "objective", "decision_note")
    filter_horizontal = ("selected_lines",)
    autocomplete_fields = ("created_by", "started_by", "decided_by")
    readonly_fields = (
        "started_at",
        "started_by",
        "decided_at",
        "decided_by",
        "created_at",
        "updated_at",
    )


@admin.register(PilotObservation)
class PilotObservationAdmin(admin.ModelAdmin):
    list_display = (
        "observed_on",
        "trial",
        "production_line",
        "shift_type",
        "line_status",
        "update_duration_seconds",
        "missed_actions",
        "used_paper_fallback",
    )
    list_filter = (
        "line_status",
        "shift_type",
        "status_was_accurate",
        "used_paper_fallback",
        "observed_on",
    )
    search_fields = ("trial__name", "production_line__code", "notes")
    autocomplete_fields = ("trial", "production_line", "observed_by")
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("trial", "production_line", "observed_by")


@admin.register(PilotApproval)
class PilotApprovalAdmin(admin.ModelAdmin):
    list_display = (
        "trial",
        "reviewer_role",
        "decision",
        "decided_by",
        "decided_at",
    )
    list_filter = ("reviewer_role", "decision")
    search_fields = ("trial__name", "note", "decided_by__username")
    autocomplete_fields = ("trial", "decided_by")
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("trial", "decided_by")


@admin.register(PilotFeedback)
class PilotFeedbackAdmin(admin.ModelAdmin):
    list_display = (
        "trial",
        "reviewer_role",
        "category",
        "sentiment",
        "created_by",
        "created_at",
    )
    list_filter = ("reviewer_role", "category", "sentiment")
    search_fields = ("trial__name", "notes", "created_by__username")
    autocomplete_fields = ("trial", "created_by")
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("trial", "created_by")


@admin.register(OperationalWorkerHeartbeat)
class OperationalWorkerHeartbeatAdmin(admin.ModelAdmin):
    list_display = (
        "worker_name",
        "last_started_at",
        "last_completed_at",
        "published_count",
        "last_error",
    )
    readonly_fields = (
        "worker_name",
        "last_started_at",
        "last_completed_at",
        "published_count",
        "last_error",
        "created_at",
        "updated_at",
    )


@admin.register(OperationalEventReadReceipt)
class OperationalEventReadReceiptAdmin(admin.ModelAdmin):
    list_display = ("event", "user", "read_at")
    search_fields = ("user__username", "event__event_type")
    readonly_fields = ("event", "user", "read_at")
    list_select_related = ("event", "user")


@admin.register(BreakRecovery)
class BreakRecoveryAdmin(admin.ModelAdmin):
    list_display = (
        "planned_start_at",
        "production_line",
        "team_leader",
        "cover_user",
        "status",
        "expected_return_at",
        "is_overdue",
        "recovered_at",
        "cancelled_at",
    )
    list_filter = (
        "status",
        "assignment__date",
        "assignment__shift_type",
        "assignment__production_line",
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
    autocomplete_fields = (
        "assignment",
        "cover_user",
        "created_by",
        "coverage_accepted_by",
        "started_by",
        "recovered_by",
        "cancelled_by",
    )
    readonly_fields = (
        "coverage_accepted_at",
        "coverage_accepted_by",
        "started_at",
        "started_by",
        "recovered_at",
        "recovered_by",
        "cancelled_at",
        "cancelled_by",
        "created_at",
        "updated_at",
    )
    ordering = (
        "status",
        "planned_start_at",
    )
    date_hierarchy = "planned_start_at"
    list_select_related = (
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

    @admin.display(
        ordering="assignment__production_line__code",
        description="Production line",
    )
    def production_line(self, obj):
        return obj.assignment.production_line.code

    @admin.display(
        ordering="assignment__team_leader__username",
        description="Team Leader",
    )
    def team_leader(self, obj):
        return obj.assignment.team_leader.username


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


@admin.register(ShiftHandover)
class ShiftHandoverAdmin(admin.ModelAdmin):
    list_display = (
        "handed_over_at",
        "production_line",
        "outgoing_team_leader",
        "incoming_team_leader",
        "status",
        "handed_over_by",
        "accepted_by",
        "accepted_at",
    )
    list_filter = (
        "status",
        "outgoing_assignment__date",
        "outgoing_assignment__shift_type",
        "outgoing_assignment__production_line",
    )
    search_fields = (
        "operational_summary",
        "notes",
        "outgoing_assignment__production_line__code",
        "outgoing_assignment__team_leader__username",
        "incoming_assignment__team_leader__username",
    )
    autocomplete_fields = (
        "outgoing_assignment",
        "incoming_assignment",
        "handed_over_by",
        "accepted_by",
    )
    filter_horizontal = ("escalations",)
    readonly_fields = (
        "handed_over_at",
        "accepted_at",
        "accepted_by",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "handed_over_at"
    ordering = (
        "status",
        "-handed_over_at",
    )
    list_select_related = (
        "outgoing_assignment",
        "outgoing_assignment__production_line",
        "outgoing_assignment__team_leader",
        "incoming_assignment",
        "incoming_assignment__team_leader",
        "handed_over_by",
        "accepted_by",
    )

    @admin.display(
        ordering="outgoing_assignment__production_line__code",
        description="Production line",
    )
    def production_line(self, obj):
        return obj.outgoing_assignment.production_line.code

    @admin.display(
        ordering="outgoing_assignment__team_leader__username",
        description="Outgoing Team Leader",
    )
    def outgoing_team_leader(self, obj):
        return obj.outgoing_assignment.team_leader.username

    @admin.display(
        ordering="incoming_assignment__team_leader__username",
        description="Incoming Team Leader",
    )
    def incoming_team_leader(self, obj):
        return obj.incoming_assignment.team_leader.username
