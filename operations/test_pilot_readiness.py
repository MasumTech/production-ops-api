from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.access import OPERATIONAL_SUPPORT_GROUP
from operations.events import create_operational_event
from operations.management.commands import publish_operational_reminders
from operations.models import (
    OperationalEvent,
    OperationalEventReadReceipt,
    OperationalWorkerHeartbeat,
)


@pytest.fixture
def manager(db):
    return get_user_model().objects.create_user(
        username="pilot.manager",
        password="pilot-test-password",
        is_staff=True,
    )


@pytest.fixture
def support_user(db):
    user = get_user_model().objects.create_user(
        username="pilot.engineer",
        password="pilot-test-password",
    )
    group = Group.objects.create(name=OPERATIONAL_SUPPORT_GROUP)
    user.groups.add(group)
    return user


@pytest.fixture
def team_leader(db):
    return get_user_model().objects.create_user(
        username="pilot.team.leader",
        password="pilot-test-password",
    )


def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_notification_inbox_is_scoped_to_visible_events(
    support_user,
    team_leader,
):
    visible, _ = create_operational_event(
        event_type="escalation.changed",
        resource_type="operationalescalation",
        resource_id=10,
        recipients=(support_user,),
    )
    hidden, _ = create_operational_event(
        event_type="line_update.changed",
        resource_type="hourlylineupdate",
        resource_id=11,
        recipients=(team_leader,),
    )

    response = authenticated_client(support_user).get(reverse("notification-inbox"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["unread_count"] == 1
    assert [item["id"] for item in response.data["results"]] == [visible.id]
    assert hidden.id not in {item["id"] for item in response.data["results"]}


@pytest.mark.django_db
def test_notification_read_is_repeatable_and_removes_unread_event(support_user):
    event, _ = create_operational_event(
        event_type="escalation.overdue",
        resource_type="operationalescalation",
        resource_id=12,
        recipients=(support_user,),
    )
    client = authenticated_client(support_user)

    first = client.post(reverse("notification-read", args=(event.id,)))
    second = client.post(reverse("notification-read", args=(event.id,)))
    inbox = client.get(reverse("notification-inbox"))

    assert first.status_code == status.HTTP_200_OK
    assert second.status_code == status.HTTP_200_OK
    assert first.data == second.data
    assert inbox.data["unread_count"] == 0
    assert (
        OperationalEventReadReceipt.objects.filter(
            event=event,
            user=support_user,
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_user_cannot_read_another_users_notification(support_user, team_leader):
    event, _ = create_operational_event(
        event_type="handover.changed",
        resource_type="shifthandover",
        resource_id=13,
        recipients=(team_leader,),
    )

    response = authenticated_client(support_user).post(
        reverse("notification-read", args=(event.id,))
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_manager_can_assign_and_revoke_operational_support_role(
    manager,
    team_leader,
):
    client = authenticated_client(manager)

    assigned = client.post(
        reverse("workspace-roles"),
        {"user": team_leader.id, "workspace": "support"},
        format="json",
    )
    team_leader.refresh_from_db()
    audit_event = OperationalEvent.objects.get(
        event_type="workspace_role.changed",
        resource_id=team_leader.id,
    )
    revoked = client.post(
        reverse("workspace-roles"),
        {"user": team_leader.id, "workspace": "team_leader"},
        format="json",
    )

    assert assigned.status_code == status.HTTP_200_OK
    assert assigned.data["workspace"] == "support"
    assert audit_event.actor == manager
    assert audit_event.metadata == {"workspace": "support"}
    assert audit_event.audiences.get() == team_leader
    assert revoked.status_code == status.HTTP_200_OK
    assert revoked.data["workspace"] == "team_leader"


@pytest.mark.django_db
def test_role_and_pilot_endpoints_require_management_staff(
    team_leader,
):
    client = authenticated_client(team_leader)

    assert (
        client.get(reverse("workspace-roles")).status_code == status.HTTP_403_FORBIDDEN
    )
    assert client.get(reverse("pilot-status")).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_staff_role_cannot_be_changed_through_workspace_admin(manager):
    response = authenticated_client(manager).post(
        reverse("workspace-roles"),
        {"user": manager.id, "workspace": "support"},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "user" in response.data


@pytest.mark.django_db
def test_pilot_status_reports_fresh_reminder_worker(
    manager,
    support_user,
):
    now = timezone.now()
    OperationalWorkerHeartbeat.objects.create(
        worker_name="operational-reminders",
        last_started_at=now - timedelta(seconds=2),
        last_completed_at=now,
        published_count=2,
    )
    create_operational_event(
        event_type="escalation.overdue",
        resource_type="operationalescalation",
        resource_id=14,
        recipients=(support_user,),
    )

    response = authenticated_client(manager).get(reverse("pilot-status"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == "ready"
    assert response.data["support_users"] == 1
    assert response.data["events_last_hour"] == 1
    assert response.data["reminder_worker"]["status"] == "healthy"
    assert response.data["reminder_worker"]["published_count"] == 2


@pytest.mark.django_db
def test_reminder_scan_records_successful_heartbeat(monkeypatch):
    monkeypatch.setattr(
        publish_operational_reminders,
        "publish_due_reminders",
        lambda now: 3,
    )

    published = publish_operational_reminders.run_reminder_scan()
    heartbeat = OperationalWorkerHeartbeat.objects.get(
        worker_name="operational-reminders",
    )

    assert published == 3
    assert heartbeat.last_completed_at is not None
    assert heartbeat.last_error == ""
    assert heartbeat.published_count == 3


@pytest.mark.django_db
def test_reminder_scan_records_error_type(monkeypatch):
    def fail(*, now):
        raise RuntimeError("sensitive failure detail")

    monkeypatch.setattr(
        publish_operational_reminders,
        "publish_due_reminders",
        fail,
    )

    with pytest.raises(RuntimeError):
        publish_operational_reminders.run_reminder_scan()

    heartbeat = OperationalWorkerHeartbeat.objects.get(
        worker_name="operational-reminders",
    )
    assert heartbeat.last_completed_at is None
    assert heartbeat.last_error == "RuntimeError"
