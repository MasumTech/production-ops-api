from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


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
