from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from operations.models import (
    BreakRecovery,
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
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


@pytest.fixture
def product_material_readiness(
    team_leader_assignment,
    supervisor,
):
    return ProductMaterialReadiness.objects.create(
        assignment=team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        planned_quantity=1000,
        status=ProductMaterialReadiness.Status.READY,
        created_by=supervisor,
    )


@pytest.mark.django_db
def test_product_material_readiness_string_representation(
    product_material_readiness,
):
    assert str(product_material_readiness) == ("LINE-01 - 1 - PROD-001 - Ready")


@pytest.mark.django_db
def test_duplicate_product_sequence_is_rejected(
    product_material_readiness,
    supervisor,
):
    duplicate = ProductMaterialReadiness(
        assignment=product_material_readiness.assignment,
        sequence_number=product_material_readiness.sequence_number,
        product_code="PROD-002",
        product_name="Demo Product B",
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        duplicate.full_clean()


@pytest.mark.django_db
def test_short_material_requires_quantity_owner_and_expected_time(
    team_leader_assignment,
    supervisor,
):
    readiness = ProductMaterialReadiness(
        assignment=team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        status=ProductMaterialReadiness.Status.SHORT,
        created_by=supervisor,
    )

    with pytest.raises(ValidationError) as exc_info:
        readiness.full_clean()

    assert "shortage_quantity" in exc_info.value.message_dict
    assert "owner" in exc_info.value.message_dict
    assert "expected_available_at" in exc_info.value.message_dict


@pytest.mark.django_db
def test_non_short_material_rejects_shortage_quantity(
    team_leader_assignment,
    supervisor,
):
    readiness = ProductMaterialReadiness(
        assignment=team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        status=ProductMaterialReadiness.Status.READY,
        shortage_quantity=10,
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        readiness.full_clean()


@pytest.mark.django_db
def test_held_material_requires_hold_reason(
    team_leader_assignment,
    supervisor,
):
    readiness = ProductMaterialReadiness(
        assignment=team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="",
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        readiness.full_clean()


@pytest.mark.django_db
def test_material_release_metadata_must_be_recorded_together(
    team_leader_assignment,
    supervisor,
):
    readiness = ProductMaterialReadiness(
        assignment=team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        released_at=timezone.now(),
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        readiness.full_clean()


@pytest.fixture
def operational_escalation(
    team_leader_assignment,
    supervisor,
):
    return OperationalEscalation.objects.create(
        assignment=team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Printer is repeatedly stopping.",
        owner=supervisor,
        raised_by=supervisor,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )


@pytest.mark.django_db
def test_operational_escalation_string_representation(
    operational_escalation,
):
    assert str(operational_escalation) == (
        "LINE-01 - Medium - Printer is repeatedly stopping."
    )


@pytest.mark.django_db
def test_escalation_rejects_invalid_response_deadline(
    team_leader_assignment,
    supervisor,
):
    raised_at = timezone.now()

    escalation = OperationalEscalation(
        assignment=team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        summary="Printer fault.",
        raised_at=raised_at,
        response_due_at=raised_at,
        raised_by=supervisor,
    )

    with pytest.raises(ValidationError):
        escalation.full_clean()


@pytest.mark.django_db
def test_critical_escalation_requires_owner_and_immediate_action(
    team_leader_assignment,
    supervisor,
):
    escalation = OperationalEscalation(
        assignment=team_leader_assignment,
        category=OperationalEscalation.Category.SAFETY,
        priority=OperationalEscalation.Priority.CRITICAL,
        summary="Unsafe guard condition.",
        immediate_action="",
        raised_by=supervisor,
        response_due_at=timezone.now() + timedelta(minutes=10),
    )

    with pytest.raises(ValidationError) as exc_info:
        escalation.full_clean()

    assert "owner" in exc_info.value.message_dict
    assert "immediate_action" in exc_info.value.message_dict


@pytest.mark.django_db
def test_escalation_rejects_multiple_source_records(
    team_leader_assignment,
    hourly_line_update,
    shift,
    supervisor,
):
    incident = QualityIncident.objects.create(
        shift=shift,
        title="Seal failure",
        category=QualityIncident.Category.PACKAGING,
        description="Seal inspection failed.",
        occurred_at=timezone.now(),
    )

    escalation = OperationalEscalation(
        assignment=team_leader_assignment,
        hourly_update=hourly_line_update,
        quality_incident=incident,
        category=OperationalEscalation.Category.QUALITY,
        summary="Quality support required.",
        raised_by=supervisor,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )

    with pytest.raises(ValidationError):
        escalation.full_clean()


@pytest.mark.django_db
def test_escalation_rejects_hourly_update_from_another_assignment(
    team_leader_assignment,
    supervisor,
):
    second_line = ProductionLine.objects.create(
        code="LINE-02",
        name="Secondary Packing Line",
    )
    second_assignment = TeamLeaderAssignment.objects.create(
        team_leader=supervisor,
        production_line=second_line,
        date=team_leader_assignment.date,
        shift_type=team_leader_assignment.shift_type,
    )
    recorded_at = timezone.now()
    update = HourlyLineUpdate.objects.create(
        assignment=second_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=supervisor,
    )

    escalation = OperationalEscalation(
        assignment=team_leader_assignment,
        hourly_update=update,
        category=OperationalEscalation.Category.EQUIPMENT,
        summary="Printer fault.",
        raised_by=supervisor,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )

    with pytest.raises(ValidationError):
        escalation.full_clean()


@pytest.mark.django_db
def test_resolved_escalation_requires_complete_audit_data(
    operational_escalation,
):
    operational_escalation.status = OperationalEscalation.Status.RESOLVED
    operational_escalation.resolution_notes = ""

    with pytest.raises(ValidationError):
        operational_escalation.full_clean()


@pytest.fixture
def incoming_team_leader(db):
    return get_user_model().objects.create_user(
        username="incoming.team.leader",
        email="incoming@example.com",
        password="test-password",
    )


@pytest.fixture
def incoming_team_leader_assignment(
    team_leader_assignment,
    incoming_team_leader,
):
    return TeamLeaderAssignment.objects.create(
        team_leader=incoming_team_leader,
        production_line=team_leader_assignment.production_line,
        date=team_leader_assignment.date,
        shift_type=Shift.ShiftType.NIGHT,
    )


@pytest.fixture
def shift_handover(
    team_leader_assignment,
    incoming_team_leader_assignment,
    operational_escalation,
    supervisor,
):
    handover = ShiftHandover.objects.create(
        outgoing_assignment=team_leader_assignment,
        incoming_assignment=incoming_team_leader_assignment,
        operational_summary="Printer escalation remains under engineering control.",
        handed_over_by=supervisor,
    )
    handover.escalations.add(operational_escalation)
    return handover


@pytest.mark.django_db
def test_shift_handover_string_representation(shift_handover):
    assert str(shift_handover) == (
        f"LINE-01 - {shift_handover.outgoing_assignment.date} Day to "
        f"{shift_handover.incoming_assignment.date} Night"
    )


@pytest.mark.django_db
def test_shift_handover_rejects_same_assignment(
    team_leader_assignment,
    supervisor,
):
    handover = ShiftHandover(
        outgoing_assignment=team_leader_assignment,
        incoming_assignment=team_leader_assignment,
        operational_summary="Open work remains.",
        handed_over_by=supervisor,
    )

    with pytest.raises(ValidationError):
        handover.full_clean()


@pytest.mark.django_db
def test_shift_handover_requires_same_production_line(
    team_leader_assignment,
    supervisor,
):
    second_line = ProductionLine.objects.create(
        code="LINE-02",
        name="Secondary Packing Line",
    )
    incoming_assignment = TeamLeaderAssignment.objects.create(
        team_leader=supervisor,
        production_line=second_line,
        date=team_leader_assignment.date,
        shift_type=Shift.ShiftType.NIGHT,
    )
    handover = ShiftHandover(
        outgoing_assignment=team_leader_assignment,
        incoming_assignment=incoming_assignment,
        operational_summary="Open work remains.",
        handed_over_by=supervisor,
    )

    with pytest.raises(ValidationError):
        handover.full_clean()


@pytest.mark.django_db
def test_shift_handover_requires_later_incoming_assignment(
    team_leader_assignment,
    incoming_team_leader,
    supervisor,
):
    previous_assignment = TeamLeaderAssignment.objects.create(
        team_leader=incoming_team_leader,
        production_line=team_leader_assignment.production_line,
        date=team_leader_assignment.date - timedelta(days=1),
        shift_type=Shift.ShiftType.NIGHT,
    )
    handover = ShiftHandover(
        outgoing_assignment=team_leader_assignment,
        incoming_assignment=previous_assignment,
        operational_summary="Open work remains.",
        handed_over_by=supervisor,
    )

    with pytest.raises(ValidationError):
        handover.full_clean()


@pytest.mark.django_db
def test_shift_handover_acceptance_metadata_must_be_recorded_together(
    shift_handover,
):
    shift_handover.accepted_at = timezone.now()

    with pytest.raises(ValidationError):
        shift_handover.full_clean()


@pytest.fixture
def break_cover_user(db):
    return get_user_model().objects.create_user(
        username="break.cover",
        email="break.cover@example.com",
        password="test-password",
    )


@pytest.fixture
def break_recovery(
    team_leader_assignment,
    break_cover_user,
    supervisor,
):
    planned_start_at = timezone.now() + timedelta(minutes=10)
    return BreakRecovery.objects.create(
        assignment=team_leader_assignment,
        cover_user=break_cover_user,
        planned_start_at=planned_start_at,
        expected_return_at=planned_start_at + timedelta(minutes=30),
        created_by=supervisor,
    )


@pytest.mark.django_db
def test_break_recovery_string_representation(break_recovery):
    assert str(break_recovery) == (
        f"LINE-01 - {break_recovery.assignment.date} - Day - Planned"
    )


@pytest.mark.django_db
def test_break_recovery_rejects_invalid_expected_return(
    team_leader_assignment,
    break_cover_user,
    supervisor,
):
    planned_start_at = timezone.now()
    break_record = BreakRecovery(
        assignment=team_leader_assignment,
        cover_user=break_cover_user,
        planned_start_at=planned_start_at,
        expected_return_at=planned_start_at,
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        break_record.full_clean()


@pytest.mark.django_db
def test_team_leader_cannot_cover_own_break(
    team_leader_assignment,
    supervisor,
):
    planned_start_at = timezone.now() + timedelta(minutes=10)
    break_record = BreakRecovery(
        assignment=team_leader_assignment,
        cover_user=supervisor,
        planned_start_at=planned_start_at,
        expected_return_at=planned_start_at + timedelta(minutes=30),
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        break_record.full_clean()


@pytest.mark.django_db
def test_inactive_user_cannot_provide_break_cover(
    team_leader_assignment,
    supervisor,
):
    inactive_user = get_user_model().objects.create_user(
        username="inactive.break.cover",
        password="test-password",
        is_active=False,
    )
    planned_start_at = timezone.now() + timedelta(minutes=10)
    break_record = BreakRecovery(
        assignment=team_leader_assignment,
        cover_user=inactive_user,
        planned_start_at=planned_start_at,
        expected_return_at=planned_start_at + timedelta(minutes=30),
        created_by=supervisor,
    )

    with pytest.raises(ValidationError):
        break_record.full_clean()


@pytest.mark.django_db
def test_break_coverage_acceptance_metadata_must_be_recorded_together(
    break_recovery,
):
    break_recovery.coverage_accepted_at = timezone.now()

    with pytest.raises(ValidationError):
        break_recovery.full_clean()


@pytest.mark.django_db
def test_active_break_requires_accepted_coverage_and_start_data(
    break_recovery,
):
    break_recovery.status = BreakRecovery.Status.ACTIVE

    with pytest.raises(ValidationError):
        break_recovery.full_clean()


@pytest.mark.django_db
def test_active_late_break_is_overdue_and_needs_attention(
    break_recovery,
    break_cover_user,
    supervisor,
):
    started_at = timezone.now() - timedelta(minutes=45)
    break_recovery.status = BreakRecovery.Status.ACTIVE
    break_recovery.coverage_accepted_at = started_at - timedelta(minutes=5)
    break_recovery.coverage_accepted_by = break_cover_user
    break_recovery.started_at = started_at
    break_recovery.started_by = supervisor
    break_recovery.expected_return_at = timezone.now() - timedelta(minutes=10)

    assert break_recovery.is_overdue is True
    assert break_recovery.needs_attention is True


@pytest.mark.django_db
def test_cancelled_break_requires_reason_and_audit_data(
    break_recovery,
):
    break_recovery.status = BreakRecovery.Status.CANCELLED

    with pytest.raises(ValidationError):
        break_recovery.full_clean()
