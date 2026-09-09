import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import OperationalWorkerHeartbeat


def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def staff_user(db):
    return get_user_model().objects.create_user(
        username="observability.manager",
        password="observability-password",
        is_staff=True,
    )


@pytest.fixture
def regular_user(db):
    return get_user_model().objects.create_user(
        username="observability.viewer",
        password="observability-password",
    )


@pytest.mark.django_db
def test_observability_summary_is_staff_only(staff_user, regular_user):
    url = reverse("observability-summary")

    response = authenticated_client(staff_user).get(url)

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == "ready"
    assert response.data["application"] == "healthy"
    assert response.data["database"]["status"] == "connected"
    assert response.data["redis"]["status"] == "connected"
    assert response.data["reminder_worker"]["status"] == "not_started"
    assert (
        authenticated_client(regular_user).get(url).status_code
        == status.HTTP_403_FORBIDDEN
    )


@pytest.mark.django_db
def test_observability_summary_reports_worker_heartbeat(staff_user):
    heartbeat = OperationalWorkerHeartbeat.objects.create(
        worker_name="operational-reminders",
        last_started_at=timezone.now(),
        last_completed_at=timezone.now(),
        published_count=3,
    )

    response = authenticated_client(staff_user).get(reverse("observability-summary"))

    assert response.status_code == status.HTTP_200_OK
    assert (
        response.data["reminder_worker"]["published_count"]
        == heartbeat.published_count
    )
    assert response.data["reminder_worker"]["status"] == "healthy"


@pytest.mark.django_db
def test_observability_summary_degrades_when_database_is_unavailable(
    staff_user,
    monkeypatch,
):
    monkeypatch.setattr("operations.views.database_is_available", lambda: False)

    response = authenticated_client(staff_user).get(reverse("observability-summary"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == "degraded"
    assert response.data["database"]["status"] == "unavailable"
