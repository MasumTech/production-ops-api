from datetime import datetime, time, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from operations.models import ProductionLine, Shift, TeamLeaderAssignment
from operations.operational_editing import operational_edit_failure


@pytest.mark.django_db
def test_previous_night_is_editable_until_shift_end():
    manager = get_user_model().objects.create_user(
        username="night.manager",
        is_staff=True,
    )
    leader = get_user_model().objects.create_user(username="night.leader")
    line = ProductionLine.objects.create(code="NIGHT-01", name="Night line")
    operational_date = timezone.localdate()
    assignment = TeamLeaderAssignment.objects.create(
        team_leader=leader,
        production_line=line,
        date=operational_date,
        shift_type=Shift.ShiftType.NIGHT,
        assigned_by=manager,
    )
    Shift.objects.create(
        production_line=line,
        supervisor=manager,
        date=operational_date,
        shift_type=Shift.ShiftType.NIGHT,
        start_time=time(23),
        end_time=time(7),
    )
    next_date = operational_date + timedelta(days=1)
    during_shift = timezone.make_aware(datetime.combine(next_date, time(3)))
    after_shift = timezone.make_aware(datetime.combine(next_date, time(8)))

    with patch("operations.operational_editing.timezone.now", return_value=during_shift):
        assert operational_edit_failure(assignment) is None
    with patch("operations.operational_editing.timezone.now", return_value=after_shift):
        assert "read-only" in operational_edit_failure(assignment)
