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
