from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from operations.models import ProductionLine, QualityIncident, Shift


@pytest.fixture
def supervisor(db):
    return get_user_model().objects.create_user(
        username="shift.supervisor",
        email="supervisor@example.com",
        password="test-password",
    )


@pytest.fixture
def production_line(db):
    return ProductionLine.objects.create(
        code="LINE-01",
        name="Main Packing Line",
        location="Factory Floor A",
        target_units_per_hour=500,
    )


@pytest.fixture
def shift(production_line, supervisor):
    return Shift.objects.create(
        production_line=production_line,
        supervisor=supervisor,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(6, 0),
        end_time=time(18, 0),
        planned_output=5000,
        actual_output=4500,
        downtime_minutes=30,
    )


@pytest.mark.django_db
def test_production_line_string_representation(production_line):
    assert str(production_line) == "LINE-01 - Main Packing Line"


@pytest.mark.django_db
def test_shift_calculates_performance_percentage(shift):
    assert shift.performance_percentage == 90.0


@pytest.mark.django_db
def test_shift_returns_none_when_planned_output_is_zero(
    production_line,
    supervisor,
):
    shift = Shift(
        production_line=production_line,
        supervisor=supervisor,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.NIGHT,
        start_time=time(18, 0),
        end_time=time(6, 0),
        planned_output=0,
        actual_output=0,
    )

    assert shift.performance_percentage is None


@pytest.mark.django_db
def test_shift_rejects_identical_start_and_end_times(
    production_line,
    supervisor,
):
    shift = Shift(
        production_line=production_line,
        supervisor=supervisor,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(6, 0),
        end_time=time(6, 0),
    )

    with pytest.raises(ValidationError):
        shift.full_clean()


@pytest.mark.django_db
def test_duplicate_shift_is_rejected(shift):
    duplicate_shift = Shift(
        production_line=shift.production_line,
        supervisor=shift.supervisor,
        date=shift.date,
        shift_type=shift.shift_type,
        start_time=time(6, 0),
        end_time=time(18, 0),
    )

    with pytest.raises(ValidationError):
        duplicate_shift.full_clean()


@pytest.mark.django_db
def test_incident_rejects_resolution_before_occurrence(shift):
    occurred_at = timezone.now()

    incident = QualityIncident(
        shift=shift,
        title="Packaging seal failure",
        category=QualityIncident.Category.PACKAGING,
        severity=QualityIncident.Severity.HIGH,
        description="Packaging seals failed during inspection.",
        occurred_at=occurred_at,
        resolved_at=occurred_at - timedelta(minutes=10),
    )

    with pytest.raises(ValidationError):
        incident.full_clean()


@pytest.mark.django_db
def test_quality_incident_string_representation(shift):
    incident = QualityIncident.objects.create(
        shift=shift,
        title="Packaging seal failure",
        category=QualityIncident.Category.PACKAGING,
        severity=QualityIncident.Severity.HIGH,
        description="Packaging seals failed during inspection.",
        occurred_at=timezone.now(),
    )

    assert str(incident) == "Packaging seal failure (High)"
