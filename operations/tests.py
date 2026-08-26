from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from operations.models import (
    HourlyLineUpdate,
    ProductionLine,
    QualityIncident,
    Shift,
    TeamLeaderAssignment,
)


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


@pytest.fixture
def team_leader_assignment(production_line, supervisor):
    return TeamLeaderAssignment.objects.create(
        team_leader=supervisor,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )


@pytest.mark.django_db
def test_team_leader_assignment_string_representation(
    team_leader_assignment,
):
    assert str(team_leader_assignment) == (
        f"{team_leader_assignment.date} - Day - LINE-01 - shift.supervisor"
    )


@pytest.mark.django_db
def test_line_cannot_have_duplicate_assignment_for_same_shift(
    team_leader_assignment,
    supervisor,
):
    duplicate_assignment = TeamLeaderAssignment(
        team_leader=supervisor,
        production_line=team_leader_assignment.production_line,
        date=team_leader_assignment.date,
        shift_type=team_leader_assignment.shift_type,
    )

    with pytest.raises(ValidationError):
        duplicate_assignment.full_clean()


@pytest.mark.django_db
def test_team_leader_can_be_assigned_to_multiple_lines(
    team_leader_assignment,
    supervisor,
):
    second_line = ProductionLine.objects.create(
        code="LINE-02",
        name="Secondary Packing Line",
        location="Factory Floor B",
        target_units_per_hour=400,
    )

    TeamLeaderAssignment.objects.create(
        team_leader=supervisor,
        production_line=second_line,
        date=team_leader_assignment.date,
        shift_type=team_leader_assignment.shift_type,
    )

    assert (
        TeamLeaderAssignment.objects.filter(
            team_leader=supervisor,
            date=team_leader_assignment.date,
            shift_type=team_leader_assignment.shift_type,
        ).count()
        == 2
    )


@pytest.fixture
def hourly_line_update(team_leader_assignment, supervisor):
    recorded_at = timezone.now()

    return HourlyLineUpdate.objects.create(
        assignment=team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        current_product="Demo Product A",
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=supervisor,
    )


@pytest.mark.django_db
def test_hourly_line_update_string_representation(
    hourly_line_update,
):
    assert str(hourly_line_update) == (
        f"LINE-01 - Green - {hourly_line_update.recorded_at:%Y-%m-%d %H:%M}"
    )


@pytest.mark.django_db
def test_hourly_update_rejects_invalid_next_update_time(
    team_leader_assignment,
    supervisor,
):
    recorded_at = timezone.now()

    update = HourlyLineUpdate(
        assignment=team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at,
        recorded_by=supervisor,
    )

    with pytest.raises(ValidationError):
        update.full_clean()


@pytest.mark.django_db
def test_amber_update_requires_issue_summary(
    team_leader_assignment,
    supervisor,
):
    recorded_at = timezone.now()

    update = HourlyLineUpdate(
        assignment=team_leader_assignment,
        status=HourlyLineUpdate.Status.AMBER,
        issue_summary="",
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=supervisor,
    )

    with pytest.raises(ValidationError):
        update.full_clean()


@pytest.mark.django_db
def test_red_update_requires_follow_up(
    team_leader_assignment,
    supervisor,
):
    recorded_at = timezone.now()

    update = HourlyLineUpdate(
        assignment=team_leader_assignment,
        status=HourlyLineUpdate.Status.RED,
        issue_summary="Printer fault stopped production.",
        requires_follow_up=False,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=supervisor,
    )

    with pytest.raises(ValidationError):
        update.full_clean()
