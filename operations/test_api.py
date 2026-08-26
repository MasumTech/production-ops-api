from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import (
    ProductionLine,
    QualityIncident,
    Shift,
    TeamLeaderAssignment,
)

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
    assert response.data["count"] == 1
    assert len(response.data["results"]) == 1
    assert response.data["results"][0]["code"] == "LINE-01"


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


@pytest.mark.django_db
def test_dashboard_requires_authentication(api_client):
    response = api_client.get(reverse("operations-dashboard"))

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_dashboard_returns_operations_summary(
    authenticated_client,
    shift,
    api_user,
):
    QualityIncident.objects.create(
        shift=shift,
        title="Critical packaging failure",
        category=QualityIncident.Category.PACKAGING,
        severity=QualityIncident.Severity.CRITICAL,
        status=QualityIncident.Status.OPEN,
        description="Packaging seals failed during production.",
        occurred_at=timezone.now(),
        reported_by=api_user,
    )

    response = authenticated_client.get(
        reverse("operations-dashboard"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data == {
        "total_shifts": 1,
        "total_planned_output": 5000,
        "total_actual_output": 4500,
        "overall_performance_percentage": 90.0,
        "total_downtime_minutes": 30,
        "open_incidents": 1,
        "critical_incidents": 1,
    }


@pytest.mark.django_db
def test_dashboard_handles_empty_database(authenticated_client):
    response = authenticated_client.get(
        reverse("operations-dashboard"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data == {
        "total_shifts": 0,
        "total_planned_output": 0,
        "total_actual_output": 0,
        "overall_performance_percentage": None,
        "total_downtime_minutes": 0,
        "open_incidents": 0,
        "critical_incidents": 0,
    }


@pytest.mark.django_db
def test_production_lines_are_paginated(authenticated_client):
    production_lines = [
        ProductionLine(
            code=f"LINE-{number:02d}",
            name=f"Production Line {number}",
        )
        for number in range(1, 22)
    ]
    ProductionLine.objects.bulk_create(production_lines)

    first_page = authenticated_client.get(
        reverse("production-line-list"),
    )

    assert first_page.status_code == status.HTTP_200_OK
    assert first_page.data["count"] == 21
    assert len(first_page.data["results"]) == 20
    assert first_page.data["next"] is not None
    assert first_page.data["previous"] is None

    second_page = authenticated_client.get(
        reverse("production-line-list"),
        {"page": 2},
    )

    assert second_page.status_code == status.HTTP_200_OK
    assert second_page.data["count"] == 21
    assert len(second_page.data["results"]) == 1
    assert second_page.data["next"] is None
    assert second_page.data["previous"] is not None


@pytest.mark.django_db
def test_dashboard_filters_summary_by_date_range(
    authenticated_client,
    shift,
    api_user,
):
    old_shift = Shift.objects.create(
        production_line=shift.production_line,
        supervisor=api_user,
        date=shift.date - timedelta(days=30),
        shift_type=Shift.ShiftType.DAY,
        start_time=time(6, 0),
        end_time=time(18, 0),
        planned_output=1000,
        actual_output=500,
        downtime_minutes=60,
    )

    QualityIncident.objects.create(
        shift=shift,
        title="Current critical incident",
        category=QualityIncident.Category.PRODUCT,
        severity=QualityIncident.Severity.CRITICAL,
        status=QualityIncident.Status.OPEN,
        description="Current production incident.",
        occurred_at=timezone.now(),
        reported_by=api_user,
    )
    QualityIncident.objects.create(
        shift=old_shift,
        title="Old critical incident",
        category=QualityIncident.Category.PRODUCT,
        severity=QualityIncident.Severity.CRITICAL,
        status=QualityIncident.Status.OPEN,
        description="Old production incident.",
        occurred_at=timezone.now() - timedelta(days=30),
        reported_by=api_user,
    )

    response = authenticated_client.get(
        reverse("operations-dashboard"),
        {
            "date_from": shift.date.isoformat(),
            "date_to": shift.date.isoformat(),
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data == {
        "total_shifts": 1,
        "total_planned_output": 5000,
        "total_actual_output": 4500,
        "overall_performance_percentage": 90.0,
        "total_downtime_minutes": 30,
        "open_incidents": 1,
        "critical_incidents": 1,
    }


@pytest.mark.django_db
def test_dashboard_rejects_invalid_date_range(
    authenticated_client,
):
    today = timezone.localdate()

    response = authenticated_client.get(
        reverse("operations-dashboard"),
        {
            "date_from": today.isoformat(),
            "date_to": (today - timedelta(days=1)).isoformat(),
        },
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "date_to" in response.data


@pytest.fixture
def staff_user(db):
    return get_user_model().objects.create_user(
        username="operations.manager",
        email="manager@example.com",
        password=TEST_PASSWORD,
        is_staff=True,
    )


@pytest.fixture
def staff_client(api_client, staff_user):
    api_client.force_authenticate(user=staff_user)
    return api_client


@pytest.fixture
def other_user(db):
    return get_user_model().objects.create_user(
        username="other.team.leader",
        email="other@example.com",
        password=TEST_PASSWORD,
    )


@pytest.fixture
def second_production_line(db):
    return ProductionLine.objects.create(
        code="LINE-02",
        name="Secondary Packing Line",
        location="Factory Floor B",
        target_units_per_hour=400,
    )


@pytest.mark.django_db
def test_team_leader_assignments_require_authentication(api_client):
    response = api_client.get(
        reverse("team-leader-assignment-list"),
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_staff_can_create_team_leader_assignment(
    staff_client,
    staff_user,
    api_user,
    production_line,
):
    response = staff_client.post(
        reverse("team-leader-assignment-list"),
        {
            "team_leader": api_user.id,
            "production_line": production_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
            "notes": "Responsible for the line during this shift.",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["team_leader"] == api_user.id
    assert response.data["assigned_by"] == staff_user.id
    assert response.data["production_line_code"] == "LINE-01"


@pytest.mark.django_db
def test_regular_user_cannot_create_team_leader_assignment(
    authenticated_client,
    api_user,
    production_line,
):
    response = authenticated_client.post(
        reverse("team-leader-assignment-list"),
        {
            "team_leader": api_user.id,
            "production_line": production_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_team_leader_only_sees_own_assignments(
    authenticated_client,
    api_user,
    other_user,
    production_line,
    second_production_line,
):
    TeamLeaderAssignment.objects.create(
        team_leader=api_user,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )
    TeamLeaderAssignment.objects.create(
        team_leader=other_user,
        production_line=second_production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )

    response = authenticated_client.get(
        reverse("team-leader-assignment-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["team_leader"] == api_user.id
    assert response.data["results"][0]["production_line_code"] == "LINE-01"


@pytest.mark.django_db
def test_staff_user_can_see_all_assignments(
    staff_client,
    api_user,
    other_user,
    production_line,
    second_production_line,
):
    TeamLeaderAssignment.objects.create(
        team_leader=api_user,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )
    TeamLeaderAssignment.objects.create(
        team_leader=other_user,
        production_line=second_production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )

    response = staff_client.get(
        reverse("team-leader-assignment-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_my_lines_returns_only_current_users_assignments(
    staff_client,
    staff_user,
    api_user,
    production_line,
    second_production_line,
):
    TeamLeaderAssignment.objects.create(
        team_leader=staff_user,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )
    TeamLeaderAssignment.objects.create(
        team_leader=api_user,
        production_line=second_production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )

    response = staff_client.get(
        reverse("team-leader-assignment-my-lines"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["team_leader"] == staff_user.id
    assert response.data["results"][0]["production_line_code"] == "LINE-01"


@pytest.mark.django_db
def test_assignment_filter_rejects_invalid_date(authenticated_client):
    response = authenticated_client.get(
        reverse("team-leader-assignment-list"),
        {"date": "invalid-date"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "date" in response.data


@pytest.mark.django_db
def test_inactive_user_cannot_be_assigned(
    staff_client,
    production_line,
):
    inactive_user = get_user_model().objects.create_user(
        username="inactive.team.leader",
        password=TEST_PASSWORD,
        is_active=False,
    )

    response = staff_client.post(
        reverse("team-leader-assignment-list"),
        {
            "team_leader": inactive_user.id,
            "production_line": production_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "team_leader" in response.data


@pytest.mark.django_db
def test_inactive_line_cannot_be_assigned(
    staff_client,
    api_user,
):
    inactive_line = ProductionLine.objects.create(
        code="LINE-INACTIVE",
        name="Inactive Line",
        status=ProductionLine.Status.INACTIVE,
    )

    response = staff_client.post(
        reverse("team-leader-assignment-list"),
        {
            "team_leader": api_user.id,
            "production_line": inactive_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "production_line" in response.data


@pytest.mark.django_db
def test_duplicate_line_assignment_is_rejected(
    staff_client,
    api_user,
    other_user,
    production_line,
):
    TeamLeaderAssignment.objects.create(
        team_leader=api_user,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )

    response = staff_client.post(
        reverse("team-leader-assignment-list"),
        {
            "team_leader": other_user.id,
            "production_line": production_line.id,
            "date": timezone.localdate().isoformat(),
            "shift_type": Shift.ShiftType.DAY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
