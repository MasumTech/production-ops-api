import pytest
from django.urls import reverse
from rest_framework import status


@pytest.mark.django_db
def test_health_check_reports_connected_database(client):
    response = client.get(reverse("health-check"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "status": "healthy",
        "database": "connected",
    }


def test_health_check_reports_unavailable_database(
    client,
    monkeypatch,
):
    monkeypatch.setattr(
        "config.health.database_is_available",
        lambda: False,
    )

    response = client.get(reverse("health-check"))

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json() == {
        "status": "unhealthy",
        "database": "unavailable",
    }
