from datetime import date, datetime, time

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from operations.models import (
    HourlyOutput,
    OperationalEvent,
    ProductionLine,
    Shift,
    TeamLeaderAssignment,
)


@pytest.fixture
def hourly_context(db):
    user_model = get_user_model()
    manager = user_model.objects.create_user(
        username="hourly.manager",
        password="safe-test-password",
        is_staff=True,
    )
    leader = user_model.objects.create_user(
        username="hourly.leader",
        password="safe-test-password",
    )
    other = user_model.objects.create_user(
        username="other.leader",
        password="safe-test-password",
    )
    line = ProductionLine.objects.create(
        code="HOUR-LINE-01",
        name="Hourly output",
        location="A",
    )
    assignment = TeamLeaderAssignment.objects.create(
        production_line=line,
        team_leader=leader,
        date=date(2026, 9, 25),
        shift_type=Shift.ShiftType.DAY,
        assigned_by=manager,
    )
    shift = Shift.objects.create(
        production_line=line,
        supervisor=manager,
        date=assignment.date,
        shift_type=assignment.shift_type,
        start_time=time(6, 45),
        end_time=time(18),
        planned_output=5000,
        actual_output=999,
    )
    return {
        "manager": manager,
        "leader": leader,
        "other": other,
        "assignment": assignment,
        "shift": shift,
    }


def api_hour(hour=10):
    return datetime(
        2026,
        9,
        25,
        hour,
        0,
        tzinfo=timezone.get_current_timezone(),
    )


@pytest.mark.django_db
def test_assigned_team_leader_can_create_update_and_delete_hourly_output(
    hourly_context,
):
    client = APIClient()
    client.force_authenticate(user=hourly_context["leader"])

    response = client.post(
        "/api/hourly-outputs/",
        {
            "assignment": hourly_context["assignment"].id,
            "hour_start_at": api_hour().isoformat(),
            "actual_units": 420,
            "rejected_units": 7,
            "rework_units": 3,
            "notes": "Stable run after start-up checks.",
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.data["actual_units"] == 420
    assert response.data["rejected_units"] == 7
    assert response.data["rework_units"] == 3
    assert response.data["recorded_by_username"] == "hourly.leader"
    hourly_context["shift"].refresh_from_db()
    assert hourly_context["shift"].actual_output == 420
    assert OperationalEvent.objects.filter(
        event_type="hourly_output.created",
        resource_id=response.data["id"],
    ).exists()

    updated = client.patch(
        f"/api/hourly-outputs/{response.data['id']}/",
        {"actual_units": 450, "notes": "Final counter reading."},
        format="json",
    )
    assert updated.status_code == 200
    assert updated.data["actual_units"] == 450
    assert updated.data["last_edited_by_username"] == "hourly.leader"
    hourly_context["shift"].refresh_from_db()
    assert hourly_context["shift"].actual_output == 450

    deleted = client.delete(f"/api/hourly-outputs/{response.data['id']}/")
    assert deleted.status_code == 204
    hourly_context["shift"].refresh_from_db()
    assert hourly_context["shift"].actual_output == 0
    assert OperationalEvent.objects.filter(
        event_type="hourly_output.deleted",
        resource_id=response.data["id"],
    ).exists()


@pytest.mark.django_db
def test_hourly_output_is_private_to_assigned_team_leader(hourly_context):
    output = HourlyOutput.objects.create(
        assignment=hourly_context["assignment"],
        hour_start_at=api_hour(),
        actual_units=420,
        recorded_by=hourly_context["leader"],
        last_edited_by=hourly_context["leader"],
    )
    client = APIClient()
    client.force_authenticate(user=hourly_context["other"])

    assert client.get("/api/hourly-outputs/?date=2026-09-25").data["results"] == []
    assert (
        client.post(
            "/api/hourly-outputs/",
            {
                "assignment": hourly_context["assignment"].id,
                "hour_start_at": api_hour(11).isoformat(),
                "actual_units": 300,
            },
            format="json",
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/hourly-outputs/{output.id}/",
            {"actual_units": 999},
            format="json",
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_manager_correction_requires_reason_and_reconciles_shift(hourly_context):
    output = HourlyOutput.objects.create(
        assignment=hourly_context["assignment"],
        hour_start_at=api_hour(),
        actual_units=420,
        recorded_by=hourly_context["leader"],
        last_edited_by=hourly_context["leader"],
    )
    HourlyOutput.objects.create(
        assignment=hourly_context["assignment"],
        hour_start_at=api_hour(11),
        actual_units=300,
        recorded_by=hourly_context["leader"],
        last_edited_by=hourly_context["leader"],
    )
    client = APIClient()
    client.force_authenticate(user=hourly_context["manager"])

    missing_reason = client.patch(
        f"/api/hourly-outputs/{output.id}/",
        {"actual_units": 460},
        format="json",
    )
    assert missing_reason.status_code == 400
    assert "correction_reason" in missing_reason.data

    corrected = client.patch(
        f"/api/hourly-outputs/{output.id}/",
        {
            "actual_units": 460,
            "correction_reason": "Verified against the end-of-hour counter.",
        },
        format="json",
    )
    assert corrected.status_code == 200
    assert corrected.data["last_edited_by_username"] == "hourly.manager"
    hourly_context["shift"].refresh_from_db()
    assert hourly_context["shift"].actual_output == 760
    assert OperationalEvent.objects.filter(
        event_type="hourly_output.corrected",
        resource_id=output.id,
        actor=hourly_context["manager"],
    ).exists()

    missing_delete_reason = client.delete(f"/api/hourly-outputs/{output.id}/")
    assert missing_delete_reason.status_code == 400
    deleted = client.delete(
        f"/api/hourly-outputs/{output.id}/",
        {"correction_reason": "Duplicate counter entry."},
        format="json",
    )
    assert deleted.status_code == 204
    hourly_context["shift"].refresh_from_db()
    assert hourly_context["shift"].actual_output == 300


@pytest.mark.django_db
def test_hourly_output_validates_clock_hour_shift_window_and_duplicates(
    hourly_context,
):
    client = APIClient()
    client.force_authenticate(user=hourly_context["leader"])
    payload = {
        "assignment": hourly_context["assignment"].id,
        "hour_start_at": api_hour(10).isoformat(),
        "actual_units": 420,
    }
    assert (
        client.post("/api/hourly-outputs/", payload, format="json").status_code == 201
    )
    assert (
        client.post("/api/hourly-outputs/", payload, format="json").status_code == 400
    )

    payload["hour_start_at"] = api_hour(18).isoformat()
    assert (
        client.post("/api/hourly-outputs/", payload, format="json").status_code == 400
    )

    output = HourlyOutput(
        assignment=hourly_context["assignment"],
        hour_start_at=datetime.combine(
            date(2026, 9, 25),
            time(10, 5),
            tzinfo=timezone.get_current_timezone(),
        ),
        actual_units=10,
        recorded_by=hourly_context["leader"],
    )
    with pytest.raises(ValidationError):
        output.full_clean()


@pytest.mark.django_db
def test_night_shift_accepts_clock_hours_after_midnight(hourly_context):
    assignment = TeamLeaderAssignment.objects.create(
        production_line=hourly_context["assignment"].production_line,
        team_leader=hourly_context["leader"],
        date=date(2026, 9, 26),
        shift_type=Shift.ShiftType.NIGHT,
        assigned_by=hourly_context["manager"],
    )
    Shift.objects.create(
        production_line=assignment.production_line,
        supervisor=hourly_context["manager"],
        date=assignment.date,
        shift_type=assignment.shift_type,
        start_time=time(23),
        end_time=time(7),
        planned_output=4000,
    )
    client = APIClient()
    client.force_authenticate(user=hourly_context["leader"])
    hour = datetime(
        2026,
        9,
        27,
        1,
        0,
        tzinfo=timezone.get_current_timezone(),
    )

    response = client.post(
        "/api/hourly-outputs/",
        {
            "assignment": assignment.id,
            "hour_start_at": hour.isoformat(),
            "actual_units": 275,
        },
        format="json",
    )

    assert response.status_code == 201
