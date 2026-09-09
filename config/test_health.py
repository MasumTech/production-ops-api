import pytest
from django.conf import settings
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


def test_liveness_check_has_no_dependency_probe(client, monkeypatch):
    database_probe = lambda: pytest.fail("liveness must not query the database")
    redis_probe = lambda: pytest.fail("liveness must not query Redis")
    monkeypatch.setattr("config.health.database_is_available", database_probe)
    monkeypatch.setattr("config.health.redis_is_available", redis_probe)

    response = client.get(reverse("liveness-check"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"status": "healthy"}


@pytest.mark.parametrize(
    ("database_ready", "redis_ready", "expected_status", "payload"),
    [
        (
            True,
            True,
            status.HTTP_200_OK,
            {
                "status": "ready",
                "database": "connected",
                "redis": "connected",
            },
        ),
        (
            False,
            True,
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {
                "status": "not_ready",
                "database": "unavailable",
                "redis": "connected",
            },
        ),
        (
            True,
            False,
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {
                "status": "not_ready",
                "database": "connected",
                "redis": "unavailable",
            },
        ),
    ],
)
def test_readiness_check_reports_dependency_state(
    client,
    monkeypatch,
    database_ready,
    redis_ready,
    expected_status,
    payload,
):
    monkeypatch.setattr(
        "config.health.database_is_available",
        lambda: database_ready,
    )
    monkeypatch.setattr(
        "config.health.redis_is_available",
        lambda: redis_ready,
    )

    response = client.get(reverse("readiness-check"))

    assert response.status_code == expected_status
    assert response.json() == payload


def test_redis_probe_is_unavailable_without_a_configured_url(monkeypatch):
    monkeypatch.setattr(settings, "REDIS_URL", "")

    from config.health import redis_is_available

    assert redis_is_available() is False


def test_redis_probe_closes_connection(monkeypatch):
    class FakeRedis:
        closed = False

        def ping(self):
            return True

        def close(self):
            self.closed = True

    fake_redis = FakeRedis()
    monkeypatch.setattr(settings, "REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setattr(
        "config.health.Redis.from_url",
        lambda *args, **kwargs: fake_redis,
    )

    from config.health import redis_is_available

    assert redis_is_available() is True
    assert fake_redis.closed is True
