from datetime import datetime, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import DowntimeEvent, ProductionLine, Shift


@pytest.fixture
def downtime_user(db):
    return get_user_model().objects.create_user(
        username="downtime.manager",
        password=None,
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
    client = APIClient()
    client.force_authenticate(downtime_user)

    response = client.get(reverse("downtime-event-list"), {"date": downtime_shift.date})

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
