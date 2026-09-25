from datetime import date, datetime, time

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from operations.models import HourlyOutput, ProductionLine, TeamLeaderAssignment


@pytest.mark.django_db
def test_hourly_output_is_private_to_assigned_team_leader():
    user_model = get_user_model()
    leader = user_model.objects.create_user(username="hourly.leader", password="safe-test-password")
    other = user_model.objects.create_user(username="other.leader", password="safe-test-password")
    line = ProductionLine.objects.create(code="HOUR-LINE-01", name="Hourly output", location="A")
    assignment = TeamLeaderAssignment.objects.create(
        production_line=line,
        team_leader=leader,
        date=date(2026, 9, 25),
        shift_type="day",
    )
    hour = datetime(2026, 9, 25, 10, 0, tzinfo=timezone.get_current_timezone())
    output = HourlyOutput.objects.create(
        assignment=assignment,
        hour_start_at=hour,
        actual_units=420,
        recorded_by=leader,
    )
    client = APIClient()
    client.force_authenticate(user=other)
    assert client.get("/api/hourly-outputs/?date=2026-09-25").data["results"] == []

    client.force_authenticate(user=leader)
    result = client.get("/api/hourly-outputs/?date=2026-09-25")
    assert result.status_code == 200
    assert result.data["results"][0]["actual_units"] == 420
    assert client.patch(f"/api/hourly-outputs/{output.id}/", {"actual_units": 999}).status_code == 405

    output.hour_start_at = datetime.combine(
        date(2026, 9, 25), time(10, 5), tzinfo=timezone.get_current_timezone()
    )
    with pytest.raises(ValidationError):
        output.full_clean()
