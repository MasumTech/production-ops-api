from datetime import datetime, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import (
    DowntimeEvent,
    OperationalEvent,
    ProductionLine,
    Shift,
    TeamLeaderAssignment,
)


@pytest.fixture
def downtime_user(db):
    return get_user_model().objects.create_user(
        username="downtime.manager",
        password=None,
        is_staff=True,
    )


@pytest.fixture
def downtime_shift(downtime_user):
    line = ProductionLine.objects.create(code="LINE-DT", name="Downtime line")
    return Shift.objects.create(
        production_line=line,
        supervisor=downtime_user,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(7),
        end_time=time(18),
        planned_output=1000,
        actual_output=800,
        downtime_minutes=99,
    )


def shift_time(shift, hour, minute=0):
    return timezone.make_aware(datetime.combine(shift.date, time(hour, minute)))


@pytest.mark.django_db
def test_downtime_duration_and_resolved_validation(downtime_shift):
    event = DowntimeEvent(
        shift=downtime_shift,
        started_at=shift_time(downtime_shift, 8, 5),
        ended_at=shift_time(downtime_shift, 8, 17),
        reason_category=DowntimeEvent.ReasonCategory.EQUIPMENT,
        description="Filler sensor reset",
        owner_group=DowntimeEvent.OwnerGroup.ENGINEERING,
        status=DowntimeEvent.Status.RESOLVED,
    )
    event.full_clean()
    event.save()

    assert event.duration_minutes == 12

    event.ended_at = event.started_at - timedelta(minutes=1)
    with pytest.raises(ValidationError, match="later than start"):
        event.full_clean()


@pytest.mark.django_db
def test_downtime_api_filters_by_date_and_exposes_line_context(
    downtime_user,
    downtime_shift,
):
    event = DowntimeEvent.objects.create(
        shift=downtime_shift,
        started_at=shift_time(downtime_shift, 9, 10),
        ended_at=shift_time(downtime_shift, 9, 18),
        reason_category=DowntimeEvent.ReasonCategory.MATERIAL,
        description="Carton replenishment",
        owner_group=DowntimeEvent.OwnerGroup.OPERATIONS,
        status=DowntimeEvent.Status.RESOLVED,
    )
    night_shift = Shift.objects.create(
        production_line=downtime_shift.production_line,
        supervisor=downtime_user,
        date=downtime_shift.date,
        shift_type=Shift.ShiftType.NIGHT,
        start_time=time(23),
        end_time=time(7),
        planned_output=900,
        actual_output=700,
    )
    DowntimeEvent.objects.create(
        shift=night_shift,
        started_at=shift_time(downtime_shift, 23),
        ended_at=shift_time(downtime_shift, 23, 5),
        reason_category=DowntimeEvent.ReasonCategory.EQUIPMENT,
        description="Night event",
        owner_group=DowntimeEvent.OwnerGroup.ENGINEERING,
        status=DowntimeEvent.Status.RESOLVED,
    )
    client = APIClient()
    client.force_authenticate(downtime_user)

    response = client.get(
        reverse("downtime-event-list"),
        {"date": downtime_shift.date, "shift_type": Shift.ShiftType.DAY},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["results"] == [
        {
            "id": event.id,
            "shift": downtime_shift.id,
            "production_line": downtime_shift.production_line_id,
            "production_line_code": "LINE-DT",
            "shift_date": str(downtime_shift.date),
            "started_at": response.data["results"][0]["started_at"],
            "ended_at": response.data["results"][0]["ended_at"],
            "duration_minutes": 8,
            "reason_category": "material",
            "description": "Carton replenishment",
            "owner_group": "operations",
            "status": "resolved",
            "resolution_note": "",
            "created_at": response.data["results"][0]["created_at"],
            "updated_at": response.data["results"][0]["updated_at"],
        }
    ]


@pytest.mark.django_db
def test_downtime_api_filters_by_inclusive_date_range(
    downtime_user,
    downtime_shift,
):
    recent_shift = Shift.objects.create(
        production_line=downtime_shift.production_line,
        supervisor=downtime_user,
        date=downtime_shift.date - timedelta(days=5),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(7),
        end_time=time(18),
    )
    old_shift = Shift.objects.create(
        production_line=downtime_shift.production_line,
        supervisor=downtime_user,
        date=downtime_shift.date - timedelta(days=10),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(7),
        end_time=time(18),
    )
    recent_event = DowntimeEvent.objects.create(
        shift=recent_shift,
        started_at=shift_time(recent_shift, 9),
        ended_at=shift_time(recent_shift, 9, 5),
        reason_category=DowntimeEvent.ReasonCategory.MATERIAL,
        description="Recent material wait",
        owner_group=DowntimeEvent.OwnerGroup.OPERATIONS,
        status=DowntimeEvent.Status.RESOLVED,
    )
    old_event = DowntimeEvent.objects.create(
        shift=old_shift,
        started_at=shift_time(old_shift, 9),
        ended_at=shift_time(old_shift, 9, 5),
        reason_category=DowntimeEvent.ReasonCategory.MATERIAL,
        description="Old material wait",
        owner_group=DowntimeEvent.OwnerGroup.OPERATIONS,
        status=DowntimeEvent.Status.RESOLVED,
    )
    client = APIClient()
    client.force_authenticate(downtime_user)

    response = client.get(
        reverse("downtime-event-list"),
        {
            "date_from": downtime_shift.date - timedelta(days=6),
            "date_to": downtime_shift.date,
            "shift_type": Shift.ShiftType.DAY,
        },
    )

    assert response.status_code == status.HTTP_200_OK
    result_ids = {item["id"] for item in response.data["results"]}
    assert recent_event.id in result_ids
    assert old_event.id not in result_ids


@pytest.mark.django_db
def test_dashboard_uses_recorded_downtime_events(downtime_user, downtime_shift):
    DowntimeEvent.objects.create(
        shift=downtime_shift,
        started_at=shift_time(downtime_shift, 10),
        ended_at=shift_time(downtime_shift, 10, 7),
        reason_category=DowntimeEvent.ReasonCategory.QUALITY,
        description="QA sample hold",
        owner_group=DowntimeEvent.OwnerGroup.QA,
        status=DowntimeEvent.Status.RESOLVED,
    )
    client = APIClient()
    client.force_authenticate(downtime_user)

    response = client.get(
        reverse("operations-dashboard"),
        {"date_from": downtime_shift.date, "date_to": downtime_shift.date},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["total_downtime_minutes"] == 7


@pytest.mark.django_db
def test_unassigned_team_leader_cannot_edit_downtime(downtime_shift):
    event = DowntimeEvent.objects.create(
        shift=downtime_shift,
        started_at=shift_time(downtime_shift, 10),
        ended_at=shift_time(downtime_shift, 10, 7),
        reason_category=DowntimeEvent.ReasonCategory.EQUIPMENT,
        description="Original description",
        owner_group=DowntimeEvent.OwnerGroup.ENGINEERING,
        status=DowntimeEvent.Status.RESOLVED,
    )
    team_leader = get_user_model().objects.create_user(
        username="downtime.teamleader",
        password=None,
    )
    client = APIClient()
    client.force_authenticate(team_leader)

    denied = client.patch(
        reverse("downtime-event-detail", args=[event.id]),
        {"description": "Changed without permission"},
    )
    assert denied.status_code == status.HTTP_404_NOT_FOUND

    client.force_authenticate(downtime_shift.supervisor)
    allowed = client.patch(
        reverse("downtime-event-detail", args=[event.id]),
        {
            "description": "Verified conveyor reset",
            "resolution_note": "Manager checked the maintenance log.",
        },
    )
    assert allowed.status_code == status.HTTP_200_OK
    event.refresh_from_db()
    assert event.description == "Verified conveyor reset"
    assert event.resolution_note == "Manager checked the maintenance log."


@pytest.mark.django_db
def test_team_leader_can_create_downtime_only_for_assigned_shift(downtime_shift):
    team_leader = get_user_model().objects.create_user(
        username="assigned.downtime.leader",
        password=None,
    )
    TeamLeaderAssignment.objects.create(
        team_leader=team_leader,
        production_line=downtime_shift.production_line,
        date=downtime_shift.date,
        shift_type=downtime_shift.shift_type,
        assigned_by=downtime_shift.supervisor,
    )
    client = APIClient()
    client.force_authenticate(team_leader)

    response = client.post(
        reverse("downtime-event-list"),
        {
            "shift": downtime_shift.id,
            "started_at": shift_time(downtime_shift, 11, 5).isoformat(),
            "ended_at": shift_time(downtime_shift, 11, 14).isoformat(),
            "reason_category": DowntimeEvent.ReasonCategory.EQUIPMENT,
            "description": "Conveyor sensor stopped the line",
            "owner_group": DowntimeEvent.OwnerGroup.ENGINEERING,
            "status": DowntimeEvent.Status.RESOLVED,
            "resolution_note": "Sensor reset and guarded restart completed.",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["duration_minutes"] == 9
    assert response.data["production_line_code"] == "LINE-DT"

    updated = client.patch(
        reverse("downtime-event-detail", args=(response.data["id"],)),
        {
            "description": "Conveyor sensor replaced and line restarted",
            "resolution_note": "Replacement tested at operating speed.",
        },
        format="json",
    )
    assert updated.status_code == status.HTTP_200_OK
    assert updated.data["description"] == "Conveyor sensor replaced and line restarted"

    unassigned_line = ProductionLine.objects.create(
        code="LINE-DT-OTHER",
        name="Unassigned downtime line",
    )
    unassigned_shift = Shift.objects.create(
        production_line=unassigned_line,
        supervisor=downtime_shift.supervisor,
        date=downtime_shift.date,
        shift_type=downtime_shift.shift_type,
        start_time=time(7),
        end_time=time(18),
        planned_output=900,
        actual_output=600,
    )
    denied = client.post(
        reverse("downtime-event-list"),
        {
            "shift": unassigned_shift.id,
            "started_at": shift_time(unassigned_shift, 12).isoformat(),
            "reason_category": DowntimeEvent.ReasonCategory.OTHER,
            "description": "Must not be accepted",
            "owner_group": DowntimeEvent.OwnerGroup.OPERATIONS,
            "status": DowntimeEvent.Status.OPEN,
        },
        format="json",
    )

    assert denied.status_code == status.HTTP_403_FORBIDDEN
    assert not DowntimeEvent.objects.filter(shift=unassigned_shift).exists()

    deleted = client.delete(
        reverse("downtime-event-detail", args=(response.data["id"],)),
    )
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert not DowntimeEvent.objects.filter(id=response.data["id"]).exists()
    assert list(
        OperationalEvent.objects.filter(
            resource_type="downtimeevent",
            resource_id=response.data["id"],
        ).values_list("event_type", flat=True)
    ) == ["downtime.created", "downtime.changed", "downtime.deleted"]


@pytest.mark.django_db
def test_team_leader_downtime_list_is_limited_to_assigned_shifts(downtime_shift):
    team_leader = get_user_model().objects.create_user(
        username="scoped.downtime.leader",
        password=None,
    )
    TeamLeaderAssignment.objects.create(
        team_leader=team_leader,
        production_line=downtime_shift.production_line,
        date=downtime_shift.date,
        shift_type=downtime_shift.shift_type,
        assigned_by=downtime_shift.supervisor,
    )
    visible = DowntimeEvent.objects.create(
        shift=downtime_shift,
        started_at=shift_time(downtime_shift, 13),
        reason_category=DowntimeEvent.ReasonCategory.MATERIAL,
        description="Visible assigned-line event",
        owner_group=DowntimeEvent.OwnerGroup.OPERATIONS,
    )
    hidden_shift = Shift.objects.create(
        production_line=ProductionLine.objects.create(
            code="LINE-DT-HIDDEN",
            name="Hidden downtime line",
        ),
        supervisor=downtime_shift.supervisor,
        date=downtime_shift.date,
        shift_type=downtime_shift.shift_type,
        start_time=time(7),
        end_time=time(18),
        planned_output=900,
        actual_output=600,
    )
    DowntimeEvent.objects.create(
        shift=hidden_shift,
        started_at=shift_time(hidden_shift, 13),
        reason_category=DowntimeEvent.ReasonCategory.QUALITY,
        description="Hidden unassigned-line event",
        owner_group=DowntimeEvent.OwnerGroup.QA,
    )
    client = APIClient()
    client.force_authenticate(team_leader)

    response = client.get(
        reverse("downtime-event-list"),
        {"date": downtime_shift.date, "shift_type": downtime_shift.shift_type},
    )

    assert response.status_code == status.HTTP_200_OK
    assert [item["id"] for item in response.data["results"]] == [visible.id]
