from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ProductionLine(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        MAINTENANCE = "maintenance", "Maintenance"

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    location = models.CharField(max_length=100, blank=True)
    target_units_per_hour = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


class ProductionAsset(TimeStampedModel):
    class AssetType(models.TextChoices):
        PRINTER = "printer", "Printer"
        FILLER = "filler", "Filler"
        PACKER = "packer", "Packer"
        CONVEYOR = "conveyor", "Conveyor"
        LABELER = "labeler", "Labeler"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        MAINTENANCE = "maintenance", "Maintenance"
        RETIRED = "retired", "Retired"

    production_line = models.ForeignKey(
        ProductionLine,
        on_delete=models.PROTECT,
        related_name="assets",
    )
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    asset_type = models.CharField(
        max_length=20,
        choices=AssetType.choices,
    )
    manufacturer = models.CharField(max_length=100, blank=True)
    model_number = models.CharField(max_length=100, blank=True)
    serial_number = models.CharField(max_length=100, blank=True)
    commissioned_on = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("production_line__code", "code")
        constraints = [
            models.UniqueConstraint(
                fields=("production_line", "code"),
                name="unique_asset_code_per_line",
            ),
        ]
        indexes = [
            models.Index(fields=("production_line", "status")),
            models.Index(fields=("asset_type", "status")),
        ]

    def __str__(self):
        return f"{self.production_line.code} - {self.code} - {self.name}"


class Shift(TimeStampedModel):
    class ShiftType(models.TextChoices):
        DAY = "day", "Day"
        NIGHT = "night", "Night"

    production_line = models.ForeignKey(
        ProductionLine,
        on_delete=models.PROTECT,
        related_name="shifts",
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="supervised_shifts",
        null=True,
        blank=True,
    )
    date = models.DateField()
    shift_type = models.CharField(
        max_length=10,
        choices=ShiftType.choices,
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    planned_output = models.PositiveIntegerField(default=0)
    actual_output = models.PositiveIntegerField(default=0)
    downtime_minutes = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "production_line__code"]
        constraints = [
            models.UniqueConstraint(
                fields=["production_line", "date", "shift_type"],
                name="unique_line_date_shift",
            ),
        ]

    def clean(self):
        if self.start_time == self.end_time:
            raise ValidationError(
                {"end_time": "End time must be different from start time."}
            )

    @property
    def performance_percentage(self):
        if self.planned_output == 0:
            return None

        return round(
            (self.actual_output / self.planned_output) * 100,
            2,
        )

    def __str__(self):
        return (
            f"{self.production_line.code} - "
            f"{self.date} - {self.get_shift_type_display()}"
        )


class QualityIncident(TimeStampedModel):
    class Category(models.TextChoices):
        PRODUCT = "product", "Product Quality"
        PACKAGING = "packaging", "Packaging"
        HYGIENE = "hygiene", "Hygiene"
        EQUIPMENT = "equipment", "Equipment"
        SAFETY = "safety", "Safety"
        OTHER = "other", "Other"

    class Severity(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        INVESTIGATING = "investigating", "Investigating"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"

    shift = models.ForeignKey(
        Shift,
        on_delete=models.PROTECT,
        related_name="quality_incidents",
    )
    title = models.CharField(max_length=150)
    category = models.CharField(
        max_length=20,
        choices=Category.choices,
    )
    severity = models.CharField(
        max_length=10,
        choices=Severity.choices,
        default=Severity.MEDIUM,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    description = models.TextField()
    immediate_action = models.TextField(blank=True)
    root_cause = models.TextField(blank=True)
    corrective_action = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reported_quality_incidents",
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["status", "severity"]),
            models.Index(fields=["occurred_at"]),
        ]

    def clean(self):
        if (
            self.resolved_at
            and self.occurred_at
            and self.resolved_at < self.occurred_at
        ):
            raise ValidationError(
                {"resolved_at": ("Resolution time cannot precede occurrence time.")}
            )

    def __str__(self):
        return f"{self.title} ({self.get_severity_display()})"


class TeamLeaderAssignment(TimeStampedModel):
    team_leader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="team_leader_assignments",
    )
    production_line = models.ForeignKey(
        ProductionLine,
        on_delete=models.PROTECT,
        related_name="team_leader_assignments",
    )
    date = models.DateField()
    shift_type = models.CharField(
        max_length=10,
        choices=Shift.ShiftType.choices,
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="created_team_leader_assignments",
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = [
            "-date",
            "shift_type",
            "production_line__code",
        ]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "production_line",
                    "date",
                    "shift_type",
                ],
                name="unique_line_date_shift_assignment",
            ),
        ]
        indexes = [
            models.Index(
                fields=[
                    "team_leader",
                    "date",
                    "shift_type",
                ],
            ),
        ]

    def __str__(self):
        return (
            f"{self.date} - "
            f"{self.get_shift_type_display()} - "
            f"{self.production_line.code} - "
            f"{self.team_leader.username}"
        )


class HourlyLineUpdate(TimeStampedModel):
    class Status(models.TextChoices):
        GREEN = "green", "Green"
        AMBER = "amber", "Amber"
        RED = "red", "Red"

    assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="hourly_updates",
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
    )
    current_product = models.CharField(
        max_length=150,
        blank=True,
    )
    issue_summary = models.CharField(
        max_length=255,
        blank=True,
    )
    action_taken = models.TextField(blank=True)
    action_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="owned_line_update_actions",
        null=True,
        blank=True,
    )
    support_required = models.TextField(blank=True)
    requires_follow_up = models.BooleanField(default=False)
    recorded_at = models.DateTimeField(default=timezone.now)
    next_update_due_at = models.DateTimeField()
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="recorded_line_updates",
    )

    class Meta:
        ordering = ["-recorded_at"]
        indexes = [
            models.Index(
                fields=["assignment", "recorded_at"],
            ),
            models.Index(
                fields=["status", "recorded_at"],
            ),
        ]

    def clean(self):
        errors = {}

        if (
            self.next_update_due_at
            and self.recorded_at
            and self.next_update_due_at <= self.recorded_at
        ):
            errors["next_update_due_at"] = (
                "Next update time must be later than the recorded time."
            )

        if (
            self.status
            in {
                self.Status.AMBER,
                self.Status.RED,
            }
            and not self.issue_summary.strip()
        ):
            errors["issue_summary"] = (
                "Issue summary is required for Amber or Red status."
            )

        if self.status == self.Status.RED and not self.requires_follow_up:
            errors["requires_follow_up"] = "Red status must require follow-up."

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return (
            f"{self.assignment.production_line.code} - "
            f"{self.get_status_display()} - "
            f"{self.recorded_at:%Y-%m-%d %H:%M}"
        )


class ProductMaterialReadiness(TimeStampedModel):
    class Status(models.TextChoices):
        READY = "ready", "Ready"
        IN_PROCESS = "in_process", "In Process"
        SHORT = "short", "Short"
        HELD = "held", "Held"

    assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="product_material_readiness",
    )
    sequence_number = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
    )
    product_code = models.CharField(max_length=50)
    product_name = models.CharField(max_length=150)
    planned_quantity = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.READY,
    )
    shortage_quantity = models.PositiveIntegerField(default=0)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="owned_material_readiness_items",
        null=True,
        blank=True,
    )
    expected_available_at = models.DateTimeField(null=True, blank=True)
    hold_reason = models.TextField(blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="released_material_readiness_items",
        null=True,
        blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_material_readiness_items",
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = [
            "-assignment__date",
            "assignment__shift_type",
            "assignment__production_line__code",
            "sequence_number",
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["assignment", "sequence_number"],
                name="unique_assignment_product_sequence",
            ),
        ]
        indexes = [
            models.Index(
                fields=["assignment", "sequence_number"],
            ),
            models.Index(
                fields=["status", "expected_available_at"],
            ),
            models.Index(
                fields=["owner", "status"],
            ),
        ]

    def clean(self):
        errors = {}

        if self.status == self.Status.SHORT:
            if not self.shortage_quantity:
                errors["shortage_quantity"] = (
                    "Short material must include a shortage quantity."
                )
            if self.owner_id is None:
                errors["owner"] = "Short material must have an owner."
            if self.expected_available_at is None:
                errors["expected_available_at"] = (
                    "Short material must include an expected availability time."
                )
        elif self.shortage_quantity:
            errors["shortage_quantity"] = (
                "Shortage quantity must be zero unless material status is Short."
            )

        if self.status == self.Status.HELD and not self.hold_reason.strip():
            errors["hold_reason"] = "Held material must include a hold reason."

        if bool(self.released_at) != bool(self.released_by_id):
            errors["released_at"] = (
                "Release time and releasing user must be recorded together."
            )

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return (
            f"{self.assignment.production_line.code} - "
            f"{self.sequence_number} - "
            f"{self.product_code} - "
            f"{self.get_status_display()}"
        )


class OperationalEscalation(TimeStampedModel):
    class Category(models.TextChoices):
        EQUIPMENT = "equipment", "Equipment"
        MATERIAL = "material", "Material"
        QUALITY = "quality", "Quality"
        STAFFING = "staffing", "Staffing"
        SAFETY = "safety", "Safety"
        OTHER = "other", "Other"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        RESOLVED = "resolved", "Resolved"

    assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="operational_escalations",
    )
    hourly_update = models.ForeignKey(
        HourlyLineUpdate,
        on_delete=models.PROTECT,
        related_name="operational_escalations",
        null=True,
        blank=True,
    )
    quality_incident = models.ForeignKey(
        QualityIncident,
        on_delete=models.PROTECT,
        related_name="operational_escalations",
        null=True,
        blank=True,
    )
    category = models.CharField(
        max_length=20,
        choices=Category.choices,
    )
    priority = models.CharField(
        max_length=10,
        choices=Priority.choices,
        default=Priority.MEDIUM,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    summary = models.CharField(max_length=255)
    details = models.TextField(blank=True)
    immediate_action = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="owned_operational_escalations",
        null=True,
        blank=True,
    )
    raised_at = models.DateTimeField(default=timezone.now)
    response_due_at = models.DateTimeField()
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="raised_operational_escalations",
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="acknowledged_operational_escalations",
        null=True,
        blank=True,
    )
    resolution_notes = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="resolved_operational_escalations",
        null=True,
        blank=True,
    )
    asset = models.ForeignKey(
        ProductionAsset,
        on_delete=models.PROTECT,
        related_name="operational_escalations",
        null=True,
        blank=True,
    )
    loss_minutes = models.PositiveIntegerField(default=0)
    estimated_lost_units = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = [
            "status",
            "response_due_at",
            "-raised_at",
        ]
        indexes = [
            models.Index(
                fields=["status", "priority", "response_due_at"],
            ),
            models.Index(
                fields=["assignment", "status"],
            ),
            models.Index(
                fields=["owner", "status"],
            ),
        ]

    @property
    def is_overdue(self):
        return (
            self.status != self.Status.RESOLVED
            and self.response_due_at < timezone.now()
        )

    @property
    def needs_attention(self):
        return self.status != self.Status.RESOLVED and (
            self.owner_id is None
            or self.is_overdue
            or self.priority == self.Priority.CRITICAL
        )

    def clean(self):
        errors = {}

        if (
            self.response_due_at
            and self.raised_at
            and self.response_due_at <= self.raised_at
        ):
            errors["response_due_at"] = (
                "Response deadline must be later than the raised time."
            )

        if self.owner_id and not self.owner.is_active:
            errors["owner"] = "An inactive user cannot own an escalation."

        if self.hourly_update_id and self.quality_incident_id:
            errors["hourly_update"] = (
                "Link either an hourly update or a quality incident, not both."
            )

        if (
            self.hourly_update_id
            and self.assignment_id
            and self.hourly_update.assignment_id != self.assignment_id
        ):
            errors["hourly_update"] = (
                "The hourly update must belong to the selected assignment."
            )

        if self.quality_incident_id and self.assignment_id:
            incident_shift = self.quality_incident.shift
            assignment = self.assignment

            if (
                incident_shift.production_line_id != assignment.production_line_id
                or incident_shift.date != assignment.date
                or incident_shift.shift_type != assignment.shift_type
            ):
                errors["quality_incident"] = (
                    "The quality incident must belong to the selected line and shift."
                )

        if (
            self.priority
            in {
                self.Priority.HIGH,
                self.Priority.CRITICAL,
            }
            and self.owner_id is None
        ):
            errors["owner"] = "High or Critical escalation must have an owner."

        if (
            self.priority == self.Priority.CRITICAL
            and not self.immediate_action.strip()
        ):
            errors["immediate_action"] = (
                "Critical escalation must record an immediate action."
            )

        if bool(self.acknowledged_at) != bool(self.acknowledged_by_id):
            errors["acknowledged_at"] = (
                "Acknowledgement time and user must be recorded together."
            )

        if bool(self.resolved_at) != bool(self.resolved_by_id):
            errors["resolved_at"] = (
                "Resolution time and user must be recorded together."
            )

        if self.status == self.Status.OPEN and self.acknowledged_at:
            errors["status"] = "Open escalation cannot contain acknowledgement data."

        if self.status == self.Status.ACKNOWLEDGED:
            if not self.acknowledged_at:
                errors["status"] = (
                    "Acknowledged escalation must contain acknowledgement data."
                )

            if self.resolved_at:
                errors["status"] = (
                    "Acknowledged escalation cannot contain resolution data."
                )

        if self.status == self.Status.RESOLVED:
            if not self.acknowledged_at:
                errors["status"] = (
                    "Escalation must be acknowledged before it is resolved."
                )

            if not self.resolved_at:
                errors["status"] = "Resolved escalation must contain resolution data."

            if not self.resolution_notes.strip():
                errors["resolution_notes"] = (
                    "Resolved escalation must include resolution notes."
                )

        if self.asset_id:
            if self.category != self.Category.EQUIPMENT:
                errors["asset"] = (
                    "An asset can only be linked to an equipment escalation."
                )

            if (
                self.assignment_id
                and self.asset.production_line_id != self.assignment.production_line_id
            ):
                errors["asset"] = (
                    "The selected asset must belong to the assignment production line."
                )

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return (
            f"{self.assignment.production_line.code} - "
            f"{self.get_priority_display()} - "
            f"{self.summary}"
        )


class ShiftHandover(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending Acceptance"
        ACCEPTED = "accepted", "Accepted"

    outgoing_assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="outgoing_shift_handovers",
    )
    incoming_assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="incoming_shift_handovers",
    )
    escalations = models.ManyToManyField(
        OperationalEscalation,
        related_name="shift_handovers",
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    operational_summary = models.TextField()
    notes = models.TextField(blank=True)
    handed_over_at = models.DateTimeField(default=timezone.now)
    handed_over_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_shift_handovers",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accepted_shift_handovers",
        null=True,
        blank=True,
    )

    class Meta:
        ordering = [
            "status",
            "-handed_over_at",
        ]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "outgoing_assignment",
                    "incoming_assignment",
                ],
                name="unique_assignment_shift_handover",
            ),
        ]
        indexes = [
            models.Index(
                fields=["status", "handed_over_at"],
            ),
            models.Index(
                fields=["incoming_assignment", "status"],
            ),
        ]

    @staticmethod
    def assignment_order(assignment):
        shift_order = {
            Shift.ShiftType.DAY: 0,
            Shift.ShiftType.NIGHT: 1,
        }
        return (
            assignment.date,
            shift_order[assignment.shift_type],
        )

    def clean(self):
        errors = {}

        if self.outgoing_assignment_id and self.incoming_assignment_id:
            outgoing = self.outgoing_assignment
            incoming = self.incoming_assignment

            if outgoing.id == incoming.id:
                errors["incoming_assignment"] = (
                    "Incoming assignment must differ from outgoing assignment."
                )

            if outgoing.production_line_id != incoming.production_line_id:
                errors["incoming_assignment"] = (
                    "Incoming assignment must belong to the same production line."
                )

            if self.assignment_order(incoming) <= self.assignment_order(outgoing):
                errors["incoming_assignment"] = (
                    "Incoming assignment must occur after outgoing assignment."
                )

        if bool(self.accepted_at) != bool(self.accepted_by_id):
            errors["accepted_at"] = (
                "Acceptance time and accepting user must be recorded together."
            )

        if self.status == self.Status.PENDING and self.accepted_at:
            errors["status"] = "Pending handover cannot contain acceptance data."

        if self.status == self.Status.ACCEPTED and not self.accepted_at:
            errors["status"] = "Accepted handover must contain acceptance data."

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return (
            f"{self.outgoing_assignment.production_line.code} - "
            f"{self.outgoing_assignment.date} "
            f"{self.outgoing_assignment.get_shift_type_display()} to "
            f"{self.incoming_assignment.date} "
            f"{self.incoming_assignment.get_shift_type_display()}"
        )


class BreakRecovery(TimeStampedModel):
    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        COVERAGE_ACCEPTED = "coverage_accepted", "Coverage Accepted"
        ACTIVE = "active", "Active"
        RECOVERED = "recovered", "Recovered"
        CANCELLED = "cancelled", "Cancelled"

    assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.PROTECT,
        related_name="break_recoveries",
    )
    cover_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="covered_break_recoveries",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PLANNED,
    )
    planned_start_at = models.DateTimeField()
    expected_return_at = models.DateTimeField()
    coverage_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_break_recoveries",
    )
    coverage_accepted_at = models.DateTimeField(null=True, blank=True)
    coverage_accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accepted_break_coverages",
        null=True,
        blank=True,
    )
    started_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="started_break_recoveries",
        null=True,
        blank=True,
    )
    recovered_at = models.DateTimeField(null=True, blank=True)
    recovered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="completed_break_recoveries",
        null=True,
        blank=True,
    )
    recovery_notes = models.TextField(blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cancelled_break_recoveries",
        null=True,
        blank=True,
    )
    cancellation_reason = models.TextField(blank=True)

    class Meta:
        ordering = [
            "status",
            "planned_start_at",
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["assignment"],
                condition=models.Q(
                    status__in=(
                        "planned",
                        "coverage_accepted",
                        "active",
                    ),
                ),
                name="unique_open_break_recovery_assignment",
            ),
        ]
        indexes = [
            models.Index(
                fields=["status", "expected_return_at"],
            ),
            models.Index(
                fields=["cover_user", "status"],
            ),
        ]

    @property
    def is_overdue(self):
        return (
            self.status == self.Status.ACTIVE
            and self.expected_return_at < timezone.now()
        )

    @property
    def needs_attention(self):
        now = timezone.now()
        return self.is_overdue or (
            self.status
            in {
                self.Status.PLANNED,
                self.Status.COVERAGE_ACCEPTED,
            }
            and self.planned_start_at < now
        )

    def clean(self):
        errors = {}

        if (
            self.planned_start_at
            and self.expected_return_at
            and self.expected_return_at <= self.planned_start_at
        ):
            errors["expected_return_at"] = (
                "Expected return time must be later than the planned start time."
            )

        if (
            self.assignment_id
            and self.cover_user_id
            and self.assignment.team_leader_id == self.cover_user_id
        ):
            errors["cover_user"] = (
                "The assigned Team Leader cannot provide their own break cover."
            )

        if self.cover_user_id and not self.cover_user.is_active:
            errors["cover_user"] = "Break cover must be an active user."

        if bool(self.coverage_accepted_at) != bool(self.coverage_accepted_by_id):
            errors["coverage_accepted_at"] = (
                "Coverage acceptance time and user must be recorded together."
            )

        if (
            self.coverage_accepted_by_id
            and self.cover_user_id
            and self.coverage_accepted_by_id != self.cover_user_id
        ):
            errors["coverage_accepted_by"] = (
                "Coverage must be accepted by the nominated cover user."
            )

        if bool(self.started_at) != bool(self.started_by_id):
            errors["started_at"] = (
                "Break start time and starting user must be recorded together."
            )

        if bool(self.recovered_at) != bool(self.recovered_by_id):
            errors["recovered_at"] = (
                "Recovery time and recovering user must be recorded together."
            )

        if (
            self.started_at
            and self.recovered_at
            and self.recovered_at < self.started_at
        ):
            errors["recovered_at"] = (
                "Recovery time cannot precede the break start time."
            )

        if bool(self.cancelled_at) != bool(self.cancelled_by_id):
            errors["cancelled_at"] = (
                "Cancellation time and cancelling user must be recorded together."
            )

        if self.status == self.Status.PLANNED and (
            self.coverage_accepted_at or self.started_at or self.recovered_at
        ):
            errors["status"] = "Planned break cannot contain lifecycle completion data."

        if self.status == self.Status.COVERAGE_ACCEPTED:
            if not self.coverage_accepted_at:
                errors["status"] = "Accepted coverage must contain acceptance data."
            elif self.started_at or self.recovered_at:
                errors["status"] = (
                    "Accepted coverage cannot contain start or recovery data."
                )

        if self.status == self.Status.ACTIVE:
            if not self.coverage_accepted_at or not self.started_at:
                errors["status"] = (
                    "Active break requires accepted coverage and start data."
                )
            elif self.recovered_at:
                errors["status"] = "Active break cannot contain recovery data."

        if self.status == self.Status.RECOVERED:
            if not (
                self.coverage_accepted_at and self.started_at and self.recovered_at
            ):
                errors["status"] = (
                    "Recovered break requires acceptance, start, and recovery data."
                )
            elif not self.recovery_notes.strip():
                errors["recovery_notes"] = (
                    "Recovered break must include recovery notes."
                )

        if self.status == self.Status.CANCELLED:
            if not self.cancelled_at:
                errors["status"] = "Cancelled break requires cancellation audit data."
            elif self.started_at or self.recovered_at:
                errors["status"] = "A started or recovered break cannot be cancelled."
            elif not self.cancellation_reason.strip():
                errors["cancellation_reason"] = "Cancelled break must include a reason."

        if self.status != self.Status.CANCELLED and self.cancelled_at:
            errors["status"] = "Only a cancelled break can contain cancellation data."

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return (
            f"{self.assignment.production_line.code} - "
            f"{self.assignment.date} - "
            f"{self.assignment.get_shift_type_display()} - "
            f"{self.get_status_display()}"
        )


class OperationalEvent(models.Model):
    class Severity(models.TextChoices):
        INFO = "info", "Information"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    id = models.BigAutoField(primary_key=True)
    event_type = models.CharField(max_length=80)
    resource_type = models.CharField(max_length=80)
    resource_id = models.PositiveBigIntegerField()
    assignment = models.ForeignKey(
        TeamLeaderAssignment,
        on_delete=models.SET_NULL,
        related_name="operational_events",
        null=True,
        blank=True,
    )
    production_line = models.ForeignKey(
        ProductionLine,
        on_delete=models.SET_NULL,
        related_name="operational_events",
        null=True,
        blank=True,
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="published_operational_events",
        null=True,
        blank=True,
    )
    severity = models.CharField(
        max_length=20,
        choices=Severity.choices,
        default=Severity.INFO,
    )
    metadata = models.JSONField(default=dict, blank=True)
    dedupe_key = models.CharField(
        max_length=255,
        unique=True,
        null=True,
        blank=True,
    )
    occurred_at = models.DateTimeField(auto_now_add=True)
    audiences = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="OperationalEventAudience",
        related_name="visible_operational_events",
    )

    class Meta:
        ordering = ("id",)
        indexes = [
            models.Index(fields=("event_type", "occurred_at")),
            models.Index(fields=("assignment", "id")),
            models.Index(fields=("production_line", "id")),
        ]

    def __str__(self):
        return (
            f"{self.id} - {self.event_type} - {self.resource_type}:{self.resource_id}"
        )


class OperationalEventAudience(models.Model):
    event = models.ForeignKey(
        OperationalEvent,
        on_delete=models.CASCADE,
        related_name="audience_links",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_event_audience_links",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("event", "user"),
                name="unique_operational_event_audience",
            ),
        ]


class OperationalEventReadReceipt(models.Model):
    event = models.ForeignKey(
        OperationalEvent,
        on_delete=models.CASCADE,
        related_name="read_receipts",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_event_read_receipts",
    )
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("event", "user"),
                name="unique_operational_event_read_receipt",
            ),
        ]
        indexes = [models.Index(fields=("user", "read_at"))]


class OperationalWorkerHeartbeat(TimeStampedModel):
    worker_name = models.CharField(max_length=80, unique=True)
    last_started_at = models.DateTimeField()
    last_completed_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=160, blank=True)
    published_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("worker_name",)

    def __str__(self):
        return f"{self.worker_name} - {self.last_completed_at or self.last_started_at}"


class IdempotentRequest(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="idempotent_requests",
    )
    key = models.UUIDField()
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=500)
    request_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "key"),
                name="unique_user_idempotency_key",
            ),
        ]
        indexes = [models.Index(fields=("created_at",))]
