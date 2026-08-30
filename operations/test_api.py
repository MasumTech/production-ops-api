from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import (
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionLine,
    ProductMaterialReadiness,
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


@pytest.fixture
def api_team_leader_assignment(
    api_user,
    production_line,
):
    return TeamLeaderAssignment.objects.create(
        team_leader=api_user,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )


@pytest.fixture
def other_team_leader_assignment(
    other_user,
    second_production_line,
):
    return TeamLeaderAssignment.objects.create(
        team_leader=other_user,
        production_line=second_production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
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


@pytest.mark.django_db
def test_hourly_updates_require_authentication(api_client):
    response = api_client.get(
        reverse("hourly-line-update-list"),
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_assigned_team_leader_can_create_hourly_update(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.GREEN,
            "current_product": "Demo Product A",
            "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["recorded_by"] == api_user.id
    assert response.data["production_line_code"] == "LINE-01"
    assert response.data["status"] == HourlyLineUpdate.Status.GREEN


@pytest.mark.django_db
def test_team_leader_cannot_update_another_users_line(
    authenticated_client,
    other_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": other_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.GREEN,
            "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "assignment" in response.data


@pytest.mark.django_db
def test_staff_can_create_update_for_any_assignment(
    staff_client,
    staff_user,
    other_team_leader_assignment,
):
    response = staff_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": other_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.GREEN,
            "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["recorded_by"] == staff_user.id
    assert response.data["production_line_code"] == "LINE-02"


@pytest.mark.django_db
def test_team_leader_only_sees_updates_for_own_lines(
    authenticated_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    recorded_at = timezone.now()

    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=other_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=other_user,
    )

    response = authenticated_client.get(
        reverse("hourly-line-update-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["production_line_code"] == "LINE-01"


@pytest.mark.django_db
def test_staff_can_see_all_hourly_updates(
    staff_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    recorded_at = timezone.now()

    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=other_team_leader_assignment,
        status=HourlyLineUpdate.Status.AMBER,
        issue_summary="Materials running low.",
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=other_user,
    )

    response = staff_client.get(
        reverse("hourly-line-update-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_amber_update_requires_issue_summary(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.AMBER,
            "issue_summary": "",
            "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "issue_summary" in response.data


@pytest.mark.django_db
def test_red_update_requires_follow_up(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.RED,
            "issue_summary": "Line stopped due to equipment fault.",
            "requires_follow_up": False,
            "next_update_due_at": (timezone.now() + timedelta(minutes=30)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "requires_follow_up" in response.data


@pytest.mark.django_db
def test_hourly_update_rejects_past_next_update_time(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.GREEN,
            "next_update_due_at": (timezone.now() - timedelta(minutes=5)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "next_update_due_at" in response.data


@pytest.mark.django_db
def test_inactive_user_cannot_own_hourly_update_action(
    authenticated_client,
    api_team_leader_assignment,
):
    inactive_user = get_user_model().objects.create_user(
        username="inactive.action.owner",
        password=TEST_PASSWORD,
        is_active=False,
    )

    response = authenticated_client.post(
        reverse("hourly-line-update-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "status": HourlyLineUpdate.Status.GREEN,
            "action_owner": inactive_user.id,
            "next_update_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "action_owner" in response.data


@pytest.mark.django_db
def test_latest_status_returns_current_users_newest_update(
    authenticated_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    recorded_at = timezone.now()

    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at - timedelta(hours=1),
        next_update_due_at=recorded_at,
        recorded_by=api_user,
    )
    newest_update = HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.AMBER,
        issue_summary="Output is below the hourly target.",
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=other_team_leader_assignment,
        status=HourlyLineUpdate.Status.RED,
        issue_summary="Other line stopped.",
        requires_follow_up=True,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=other_user,
    )

    response = authenticated_client.get(
        reverse("hourly-line-update-latest-status"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == newest_update.id
    assert response.data["results"][0]["status"] == (HourlyLineUpdate.Status.AMBER)


@pytest.mark.django_db
def test_staff_latest_status_returns_one_update_per_assignment(
    staff_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    recorded_at = timezone.now()

    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at - timedelta(hours=1),
        next_update_due_at=recorded_at,
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.AMBER,
        issue_summary="Performance is below target.",
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=other_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(hours=1),
        recorded_by=other_user,
    )

    response = staff_client.get(
        reverse("hourly-line-update-latest-status"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_hourly_update_filter_rejects_invalid_date(
    authenticated_client,
):
    response = authenticated_client.get(
        reverse("hourly-line-update-list"),
        {"date": "invalid-date"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "date" in response.data


@pytest.mark.django_db
def test_hourly_updates_can_be_filtered_by_status(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    recorded_at = timezone.now()

    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.GREEN,
        recorded_at=recorded_at - timedelta(hours=1),
        next_update_due_at=recorded_at,
        recorded_by=api_user,
    )
    HourlyLineUpdate.objects.create(
        assignment=api_team_leader_assignment,
        status=HourlyLineUpdate.Status.RED,
        issue_summary="Critical equipment failure.",
        requires_follow_up=True,
        recorded_at=recorded_at,
        next_update_due_at=recorded_at + timedelta(minutes=30),
        recorded_by=api_user,
    )

    response = authenticated_client.get(
        reverse("hourly-line-update-list"),
        {"status": HourlyLineUpdate.Status.RED},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["status"] == (HourlyLineUpdate.Status.RED)


@pytest.fixture
def api_product_material_readiness(
    api_team_leader_assignment,
    api_user,
):
    return ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        planned_quantity=1000,
        status=ProductMaterialReadiness.Status.READY,
        created_by=api_user,
    )


@pytest.mark.django_db
def test_product_material_readiness_requires_authentication(api_client):
    response = api_client.get(
        reverse("product-material-readiness-list"),
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_assigned_team_leader_can_create_readiness_item(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "sequence_number": 1,
            "product_code": "PROD-001",
            "product_name": "Demo Product A",
            "planned_quantity": 1000,
            "status": ProductMaterialReadiness.Status.READY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["created_by"] == api_user.id
    assert response.data["production_line_code"] == "LINE-01"
    assert response.data["sequence_number"] == 1


@pytest.mark.django_db
def test_team_leader_cannot_create_readiness_for_another_line(
    authenticated_client,
    other_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": other_team_leader_assignment.id,
            "sequence_number": 1,
            "product_code": "PROD-002",
            "product_name": "Demo Product B",
            "status": ProductMaterialReadiness.Status.READY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "assignment" in response.data


@pytest.mark.django_db
def test_team_leader_only_sees_readiness_for_own_lines(
    authenticated_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        created_by=api_user,
    )
    ProductMaterialReadiness.objects.create(
        assignment=other_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-002",
        product_name="Demo Product B",
        created_by=other_user,
    )

    response = authenticated_client.get(
        reverse("product-material-readiness-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["product_code"] == "PROD-001"


@pytest.mark.django_db
def test_staff_can_see_all_readiness_items(
    staff_client,
    api_user,
    other_user,
    api_team_leader_assignment,
    other_team_leader_assignment,
):
    ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Demo Product A",
        created_by=api_user,
    )
    ProductMaterialReadiness.objects.create(
        assignment=other_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-002",
        product_name="Demo Product B",
        created_by=other_user,
    )

    response = staff_client.get(
        reverse("product-material-readiness-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_short_readiness_requires_material_recovery_details(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "sequence_number": 1,
            "product_code": "PROD-001",
            "product_name": "Demo Product A",
            "status": ProductMaterialReadiness.Status.SHORT,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "shortage_quantity" in response.data
    assert "owner" in response.data
    assert "expected_available_at" in response.data


@pytest.mark.django_db
def test_held_readiness_requires_hold_reason(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "sequence_number": 1,
            "product_code": "PROD-001",
            "product_name": "Demo Product A",
            "status": ProductMaterialReadiness.Status.HELD,
            "hold_reason": "",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "hold_reason" in response.data


@pytest.mark.django_db
def test_readiness_can_be_filtered_by_status(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Ready Product",
        status=ProductMaterialReadiness.Status.READY,
        created_by=api_user,
    )
    ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=2,
        product_code="PROD-002",
        product_name="Held Product",
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="Quality release is pending.",
        created_by=api_user,
    )

    response = authenticated_client.get(
        reverse("product-material-readiness-list"),
        {"status": ProductMaterialReadiness.Status.HELD},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["product_code"] == "PROD-002"


@pytest.mark.django_db
def test_readiness_filter_rejects_invalid_status(authenticated_client):
    response = authenticated_client.get(
        reverse("product-material-readiness-list"),
        {"status": "invalid-status"},
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "status" in response.data


@pytest.mark.django_db
def test_team_leader_cannot_release_held_material(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    readiness = ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Held Product",
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="Quality release is pending.",
        created_by=api_user,
    )

    response = authenticated_client.post(
        reverse(
            "product-material-readiness-release",
            args=(readiness.id,),
        ),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_staff_can_release_held_material(
    staff_client,
    staff_user,
    api_user,
    api_team_leader_assignment,
):
    readiness = ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Held Product",
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="Quality release is pending.",
        created_by=api_user,
    )

    response = staff_client.post(
        reverse(
            "product-material-readiness-release",
            args=(readiness.id,),
        ),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == ProductMaterialReadiness.Status.READY
    assert response.data["released_by"] == staff_user.id
    assert response.data["released_at"] is not None


@pytest.mark.django_db
def test_held_material_cannot_be_released_with_normal_patch(
    staff_client,
    api_user,
    api_team_leader_assignment,
):
    readiness = ProductMaterialReadiness.objects.create(
        assignment=api_team_leader_assignment,
        sequence_number=1,
        product_code="PROD-001",
        product_name="Held Product",
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="Quality release is pending.",
        created_by=api_user,
    )

    response = staff_client.patch(
        reverse(
            "product-material-readiness-detail",
            args=(readiness.id,),
        ),
        {"status": ProductMaterialReadiness.Status.READY},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "status" in response.data


@pytest.mark.django_db
def test_inactive_user_cannot_own_material_action(
    authenticated_client,
    api_team_leader_assignment,
):
    inactive_user = get_user_model().objects.create_user(
        username="inactive.material.owner",
        password=TEST_PASSWORD,
        is_active=False,
    )

    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "sequence_number": 1,
            "product_code": "PROD-001",
            "product_name": "Demo Product A",
            "status": ProductMaterialReadiness.Status.SHORT,
            "shortage_quantity": 100,
            "owner": inactive_user.id,
            "expected_available_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "owner" in response.data


@pytest.mark.django_db
def test_duplicate_readiness_sequence_is_rejected(
    authenticated_client,
    api_product_material_readiness,
):
    response = authenticated_client.post(
        reverse("product-material-readiness-list"),
        {
            "assignment": api_product_material_readiness.assignment_id,
            "sequence_number": api_product_material_readiness.sequence_number,
            "product_code": "PROD-002",
            "product_name": "Demo Product B",
            "status": ProductMaterialReadiness.Status.READY,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.fixture
def api_operational_escalation(
    api_user,
    api_team_leader_assignment,
):
    return OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Printer is repeatedly stopping.",
        owner=api_user,
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )


@pytest.mark.django_db
def test_operational_escalations_require_authentication(
    api_client,
):
    response = api_client.get(
        reverse("operational-escalation-list"),
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_team_leader_can_raise_escalation_for_own_line(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "category": (OperationalEscalation.Category.EQUIPMENT),
            "priority": (OperationalEscalation.Priority.MEDIUM),
            "summary": "Printer is repeatedly stopping.",
            "response_due_at": (timezone.now() + timedelta(minutes=30)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["raised_by"] == api_user.id
    assert response.data["status"] == (OperationalEscalation.Status.OPEN)


@pytest.mark.django_db
def test_team_leader_cannot_raise_escalation_for_another_line(
    authenticated_client,
    other_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": other_team_leader_assignment.id,
            "category": (OperationalEscalation.Category.STAFFING),
            "priority": (OperationalEscalation.Priority.MEDIUM),
            "summary": "Additional cover is required.",
            "response_due_at": (timezone.now() + timedelta(minutes=30)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "assignment" in response.data


@pytest.mark.django_db
def test_high_escalation_requires_owner(
    authenticated_client,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "category": OperationalEscalation.Category.MATERIAL,
            "priority": OperationalEscalation.Priority.HIGH,
            "summary": "Packaging material is unavailable.",
            "response_due_at": (timezone.now() + timedelta(minutes=20)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "owner" in response.data


@pytest.mark.django_db
def test_critical_escalation_requires_immediate_action(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    response = authenticated_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": api_team_leader_assignment.id,
            "category": OperationalEscalation.Category.SAFETY,
            "priority": OperationalEscalation.Priority.CRITICAL,
            "summary": "Unsafe equipment condition.",
            "owner": api_user.id,
            "response_due_at": (timezone.now() + timedelta(minutes=10)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "immediate_action" in response.data


@pytest.mark.django_db
def test_assigned_owner_can_see_escalation(
    api_client,
    other_user,
    api_user,
    api_team_leader_assignment,
):
    escalation = OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Engineering response is required.",
        owner=other_user,
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )
    api_client.force_authenticate(user=other_user)

    response = api_client.get(
        reverse("operational-escalation-list"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == escalation.id


@pytest.mark.django_db
def test_assigned_owner_can_acknowledge_escalation(
    api_client,
    other_user,
    api_user,
    api_team_leader_assignment,
):
    escalation = OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Engineering response is required.",
        owner=other_user,
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )
    api_client.force_authenticate(user=other_user)

    response = api_client.post(
        reverse(
            "operational-escalation-acknowledge",
            args=(escalation.id,),
        ),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == (OperationalEscalation.Status.ACKNOWLEDGED)
    assert response.data["acknowledged_by"] == other_user.id


@pytest.mark.django_db
def test_non_owner_cannot_acknowledge_escalation(
    authenticated_client,
    other_user,
    api_user,
    api_team_leader_assignment,
):
    escalation = OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Engineering response is required.",
        owner=other_user,
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(minutes=30),
    )

    response = authenticated_client.post(
        reverse(
            "operational-escalation-acknowledge",
            args=(escalation.id,),
        ),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_open_escalation_cannot_be_resolved(
    authenticated_client,
    api_operational_escalation,
):
    response = authenticated_client.post(
        reverse(
            "operational-escalation-resolve",
            args=(api_operational_escalation.id,),
        ),
        {"resolution_notes": ("Printer reset and verified.")},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "status" in response.data


@pytest.mark.django_db
def test_owner_can_resolve_acknowledged_escalation(
    authenticated_client,
    api_user,
    api_operational_escalation,
):
    authenticated_client.post(
        reverse(
            "operational-escalation-acknowledge",
            args=(api_operational_escalation.id,),
        ),
    )

    response = authenticated_client.post(
        reverse(
            "operational-escalation-resolve",
            args=(api_operational_escalation.id,),
        ),
        {"resolution_notes": ("Printer reset and output verified.")},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["status"] == (OperationalEscalation.Status.RESOLVED)
    assert response.data["resolved_by"] == api_user.id
    assert response.data["resolution_notes"] == ("Printer reset and output verified.")


@pytest.mark.django_db
def test_attention_required_returns_overdue_or_unassigned(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    overdue = OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Overdue engineering response.",
        owner=api_user,
        raised_by=api_user,
        raised_at=timezone.now() - timedelta(hours=2),
        response_due_at=timezone.now() - timedelta(hours=1),
    )
    unassigned = OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.STAFFING,
        priority=OperationalEscalation.Priority.LOW,
        summary="Cover request has no owner.",
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(hours=1),
    )
    OperationalEscalation.objects.create(
        assignment=api_team_leader_assignment,
        category=OperationalEscalation.Category.MATERIAL,
        priority=OperationalEscalation.Priority.MEDIUM,
        summary="Material owner is responding.",
        owner=api_user,
        raised_by=api_user,
        response_due_at=timezone.now() + timedelta(hours=1),
    )

    response = authenticated_client.get(
        reverse("operational-escalation-attention-required"),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2
    assert {item["id"] for item in response.data["results"]} == {
        overdue.id,
        unassigned.id,
    }


@pytest.mark.django_db
def test_escalations_can_be_filtered_by_priority(
    authenticated_client,
    api_user,
    api_team_leader_assignment,
):
    for priority in (
        OperationalEscalation.Priority.LOW,
        OperationalEscalation.Priority.MEDIUM,
    ):
        OperationalEscalation.objects.create(
            assignment=api_team_leader_assignment,
            category=OperationalEscalation.Category.OTHER,
            priority=priority,
            summary=f"{priority} priority escalation.",
            owner=api_user,
            raised_by=api_user,
            response_due_at=(timezone.now() + timedelta(hours=1)),
        )

    response = authenticated_client.get(
        reverse("operational-escalation-list"),
        {"priority": (OperationalEscalation.Priority.LOW)},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    assert response.data["results"][0]["priority"] == (
        OperationalEscalation.Priority.LOW
    )


@pytest.mark.django_db
def test_escalation_records_cannot_be_directly_patched(
    authenticated_client,
    api_operational_escalation,
):
    response = authenticated_client.patch(
        reverse(
            "operational-escalation-detail",
            args=(api_operational_escalation.id,),
        ),
        {"status": (OperationalEscalation.Status.RESOLVED)},
        format="json",
    )

    assert response.status_code == (status.HTTP_405_METHOD_NOT_ALLOWED)
