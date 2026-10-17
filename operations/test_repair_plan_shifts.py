from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from operations.models import ProductionLine, Shift, TeamLeaderAssignment


@pytest.mark.django_db
def test_repair_plan_shifts_is_dry_run_until_apply():
    manager = get_user_model().objects.create_user(
        username="repair.manager",
        is_staff=True,
    )
    leader = get_user_model().objects.create_user(username="repair.leader")
    line = ProductionLine.objects.create(code="REPAIR-01", name="Repair line")
    assignment = TeamLeaderAssignment.objects.create(
        team_leader=leader,
        production_line=line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        assigned_by=manager,
    )
    output = StringIO()

    call_command(
        "repair_plan_shifts",
        date=assignment.date.isoformat(),
        stdout=output,
    )
    assert "Dry run: 1 missing shift" in output.getvalue()
    assert not Shift.objects.filter(production_line=line).exists()

    output = StringIO()
    call_command(
        "repair_plan_shifts",
        date=assignment.date.isoformat(),
        apply=True,
        stdout=output,
    )
    assert "Created 1 missing shift" in output.getvalue()
    shift = Shift.objects.get(production_line=line)
    assert shift.supervisor == manager
    expected_start = "07:00:00" if assignment.date.weekday() >= 5 else "06:45:00"
    assert shift.start_time.isoformat() == expected_start
