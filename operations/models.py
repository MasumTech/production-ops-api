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
