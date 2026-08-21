from datetime import time

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import ProductionLine, QualityIncident, Shift

TEST_PASSWORD = "secure-test-password"


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def api_user(db):
    return get_user_model().objects.create_user(
        username="api.user",
        email="api.user@example.com",
        password=TEST_PASSWORD,
    )


@pytest.fixture
def authenticated_client(api_client, api_user):
    api_client.force_authenticate(user=api_user)
    return api_client


@pytest.fixture
def production_line(db):
    return ProductionLine.objects.create(
        code="LINE-01",
        name="Main Packing Line",
        location="Factory Floor A",
        target_units_per_hour=500,
    )


@pytest.fixture
def shift(production_line, api_user):
    return Shift.objects.create(
        production_line=production_line,
        supervisor=api_user,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(6, 0),
        end_time=time(18, 0),
        planned_output=5000,
        actual_output=4500,
        downtime_minutes=30,
    )


@pytest.mark.django_db
def test_production_lines_require_authentication(api_client):
    response = api_client.get(reverse("production-line-list"))

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_user_can_obtain_jwt_tokens(api_client, api_user):
    response = api_client.post(
        reverse("token-obtain-pair"),
        {
            "username": api_user.username,
            "password": TEST_PASSWORD,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    assert "access" in response.data
    assert "refresh" in response.data


@pytest.mark.django_db
def test_authenticated_user_can_create_production_line(
    authenticated_client,
):
    response = authenticated_client.post(
        reverse("production-line-list"),
        {
            "code": "LINE-02",
            "name": "Secondary Packing Line",
            "location": "Factory Floor B",
            "target_units_per_hour": 400,
            "status": ProductionLine.Status.ACTIVE,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["code"] == "LINE-02"
    assert ProductionLine.objects.filter(code="LINE-02").exists()


@pytest.mark.django_db
def test_production_lines_can_be_filtered_by_status(
    authenticated_client,
):
    ProductionLine.objects.create(
        code="LINE-01",
        name="Active Line",
        status=ProductionLine.Status.ACTIVE,
    )
    ProductionLine.objects.create(
        code="LINE-02",
        name="Maintenance Line",
        status=ProductionLine.Status.MAINTENANCE,
    )

    response = authenticated_client.get(
        reverse("production-line-list"),
        {"status": ProductionLine.Status.ACTIVE},
    )

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data) == 1
    assert response.data[0]["code"] == "LINE-01"


@pytest.mark.django_db
def test_creating_shift_assigns_current_user_as_supervisor(
    authenticated_client,
    api_user,
    production_line,
):
    response = authenticated_client.post(
        reverse("shift-list"),
        {
            "production_line": production_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
            "start_time": "06:00:00",
            "end_time": "18:00:00",
            "planned_output": 5000,
            "actual_output": 4500,
            "downtime_minutes": 30,
            "notes": "Production completed normally.",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["supervisor"] == api_user.id
    assert response.data["performance_percentage"] == 90.0


@pytest.mark.django_db
def test_duplicate_shift_is_rejected(
    authenticated_client,
    shift,
):
    response = authenticated_client.post(
        reverse("shift-list"),
        {
            "production_line": shift.production_line_id,
            "date": shift.date.isoformat(),
            "shift_type": shift.shift_type,
            "start_time": "06:00:00",
            "end_time": "18:00:00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_creating_incident_assigns_current_user_as_reporter(
    authenticated_client,
    api_user,
    shift,
):
    response = authenticated_client.post(
        reverse("quality-incident-list"),
        {
            "shift": shift.id,
            "title": "Packaging seal failure",
            "category": QualityIncident.Category.PACKAGING,
            "severity": QualityIncident.Severity.HIGH,
            "status": QualityIncident.Status.OPEN,
            "description": ("Packaging seals failed during quality inspection."),
            "occurred_at": timezone.now().isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["reported_by"] == api_user.id
    assert response.data["reported_by_username"] == api_user.username


@pytest.mark.django_db
def test_resolved_incident_requires_resolution_time(
    authenticated_client,
    shift,
):
    response = authenticated_client.post(
        reverse("quality-incident-list"),
        {
            "shift": shift.id,
            "title": "Resolved packaging issue",
            "category": QualityIncident.Category.PACKAGING,
            "severity": QualityIncident.Severity.MEDIUM,
            "status": QualityIncident.Status.RESOLVED,
            "description": "Packaging issue has been resolved.",
            "occurred_at": timezone.now().isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "resolved_at" in response.data
