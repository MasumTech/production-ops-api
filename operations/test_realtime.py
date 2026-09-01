from datetime import timedelta
from uuid import uuid4

import pytest
from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from config.asgi import application
from operations.events import publish_due_reminders
from operations.models import (
    HourlyLineUpdate,
    OperationalEvent,
    ProductionLine,
    TeamLeaderAssignment,
)


@pytest.fixture
def realtime_user(db):
    return get_user_model().objects.create_user(
        username="realtime.team.leader",
        password="realtime-test-password",
    )


@pytest.fixture
def realtime_assignment(realtime_user):
    line = ProductionLine.objects.create(
        code="LIVE-01",
        name="Live Event Line",
    )
    return TeamLeaderAssignment.objects.create(
        team_leader=realtime_user,
        production_line=line,
        date=timezone.localdate(),
        shift_type="day",
    )


@pytest.mark.django_db
def test_assignment_change_creates_scoped_operational_event(realtime_assignment):
    event = OperationalEvent.objects.get(
        event_type="assignment.created",
        resource_id=realtime_assignment.id,
    )

    assert event.assignment == realtime_assignment
    assert event.production_line == realtime_assignment.production_line
    assert event.audiences.get() == realtime_assignment.team_leader
    assert str(event).startswith(f"{event.id} - assignment.created")


@pytest.mark.django_db
def test_event_api_only_returns_events_visible_to_team_leader(
    realtime_user,
    realtime_assignment,
):
    other_user = get_user_model().objects.create_user(username="other.live.user")
    other_line = ProductionLine.objects.create(code="LIVE-02", name="Other Line")
    TeamLeaderAssignment.objects.create(
        team_leader=other_user,
        production_line=other_line,
        date=timezone.localdate(),
        shift_type="day",
    )
    client = APIClient()
    client.force_authenticate(user=realtime_user)

    response = client.get("/api/operational-events/")
    cursor = client.get("/api/operational-events/cursor/")

    assert response.status_code == status.HTTP_200_OK
    assert {item["assignment"] for item in response.data["results"]} == {
        realtime_assignment.id
    }
    assert cursor.status_code == status.HTTP_200_OK
    assert cursor.data["cursor"] == response.data["results"][-1]["id"]


@pytest.mark.django_db
def test_idempotency_key_replays_post_without_duplicate(
    realtime_user, realtime_assignment
):
    client = APIClient()
    token = str(AccessToken.for_user(realtime_user))
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    key = str(uuid4())
    payload = {
        "assignment": realtime_assignment.id,
        "status": "green",
        "current_product": "SKU-LIVE",
        "issue_summary": "",
        "action_taken": "",
        "action_owner": None,
        "support_required": "",
        "requires_follow_up": False,
        "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
    }

    first = client.post(
        "/api/hourly-line-updates/",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    second = client.post(
        "/api/hourly-line-updates/",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_201_CREATED
    assert second["Idempotency-Replayed"] == "true"
    assert second.json() == first.json()
    assert HourlyLineUpdate.objects.filter(assignment=realtime_assignment).count() == 1


@pytest.mark.django_db
def test_idempotency_key_rejects_different_payload(realtime_user, realtime_assignment):
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(realtime_user)}"
    )
    key = str(uuid4())
    due_at = (timezone.now() + timedelta(hours=1)).isoformat()
    payload = {
        "assignment": realtime_assignment.id,
        "status": "green",
        "next_update_due_at": due_at,
    }
    first = client.post(
        "/api/hourly-line-updates/",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    changed = client.post(
        "/api/hourly-line-updates/",
        {**payload, "current_product": "A different request"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )

    assert first.status_code == status.HTTP_201_CREATED
    assert changed.status_code == status.HTTP_409_CONFLICT
    assert HourlyLineUpdate.objects.filter(assignment=realtime_assignment).count() == 1


@pytest.mark.django_db
def test_overdue_reminder_is_published_once(realtime_user, realtime_assignment):
    update = HourlyLineUpdate.objects.create(
        assignment=realtime_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=timezone.now() - timedelta(hours=2),
        next_update_due_at=timezone.now() - timedelta(hours=1),
        recorded_by=realtime_user,
    )

    assert publish_due_reminders() == 1
    assert publish_due_reminders() == 0
    reminder = OperationalEvent.objects.get(
        event_type="line_update.overdue",
        resource_id=update.id,
    )
    assert reminder.severity == OperationalEvent.Severity.WARNING


@pytest.mark.django_db(transaction=True)
def test_authenticated_socket_replays_visible_events(
    realtime_user, realtime_assignment
):
    token = str(AccessToken.for_user(realtime_user))

    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            "/ws/operations/?after=0",
            subprotocols=["operations.v1", f"jwt.{token}"],
        )
        connected, protocol = await communicator.connect()
        assert connected is True
        assert protocol == "operations.v1"

        messages = []
        while True:
            message = await communicator.receive_json_from(timeout=2)
            messages.append(message)
            if message["type"] == "ready":
                break
        await communicator.disconnect()
        return messages

    messages = async_to_sync(scenario)()

    event_messages = [item["event"] for item in messages if item["type"] == "event"]
    assert any(
        item["event_type"] == "assignment.created"
        and item["resource_id"] == realtime_assignment.id
        for item in event_messages
    )


@pytest.mark.django_db(transaction=True)
def test_socket_rejects_missing_jwt():
    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            "/ws/operations/?after=0",
            subprotocols=["operations.v1"],
        )
        connected, code = await communicator.connect()
        return connected, code

    connected, code = async_to_sync(scenario)()
    assert connected is False
    assert code == 4401
