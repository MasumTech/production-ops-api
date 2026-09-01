from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import (
    OperationalEscalation,
    ProductionAsset,
    ProductionLine,
    Shift,
    TeamLeaderAssignment,
)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def analytics_context(db):
    user_model = get_user_model()

    staff_user = user_model.objects.create_user(
        username="analytics.manager",
        password="test-password",
        is_staff=True,
    )
    team_leader = user_model.objects.create_user(
        username="analytics.team.leader",
        password="test-password",
    )

    production_line = ProductionLine.objects.create(
        code="LINE-AN-01",
        name="Analytics Packing Line",
        target_units_per_hour=500,
    )
    second_line = ProductionLine.objects.create(
        code="LINE-AN-02",
        name="Secondary Packing Line",
        target_units_per_hour=400,
    )

    assignment = TeamLeaderAssignment.objects.create(
        team_leader=team_leader,
        production_line=production_line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
        assigned_by=staff_user,
    )

    asset = ProductionAsset.objects.create(
        production_line=production_line,
        code="PRN-01",
        name="Primary Label Printer",
        asset_type=ProductionAsset.AssetType.PRINTER,
    )
    other_line_asset = ProductionAsset.objects.create(
        production_line=second_line,
        code="PKR-02",
        name="Secondary Packer",
        asset_type=ProductionAsset.AssetType.PACKER,
    )

    return {
        "staff_user": staff_user,
        "team_leader": team_leader,
        "production_line": production_line,
        "second_line": second_line,
        "assignment": assignment,
        "asset": asset,
        "other_line_asset": other_line_asset,
    }


def create_escalation(
    context,
    *,
    category=OperationalEscalation.Category.EQUIPMENT,
    asset=None,
    loss_minutes=0,
    estimated_lost_units=0,
    status_value=OperationalEscalation.Status.OPEN,
    owner=None,
    summary="Recorded operational loss",
):
    now = timezone.now()

    return OperationalEscalation.objects.create(
        assignment=context["assignment"],
        category=category,
        priority=OperationalEscalation.Priority.MEDIUM,
        status=status_value,
        summary=summary,
        asset=asset,
        loss_minutes=loss_minutes,
        estimated_lost_units=estimated_lost_units,
        owner=owner,
        raised_by=context["team_leader"],
        raised_at=now,
        response_due_at=now + timedelta(hours=2),
        acknowledged_at=(
            now if status_value == OperationalEscalation.Status.ACKNOWLEDGED else None
        ),
        acknowledged_by=(
            owner if status_value == OperationalEscalation.Status.ACKNOWLEDGED else None
        ),
    )


@pytest.mark.django_db
def test_loss_analytics_requires_management_staff(
    api_client,
    analytics_context,
):
    api_client.force_authenticate(
        user=analytics_context["team_leader"],
    )

    response = api_client.get(reverse("loss-analytics"))

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_loss_analytics_aggregates_recorded_asset_evidence(
    api_client,
    analytics_context,
):
    asset = analytics_context["asset"]

    create_escalation(
        analytics_context,
        asset=asset,
        loss_minutes=10,
        estimated_lost_units=30,
    )
    create_escalation(
        analytics_context,
        asset=asset,
        loss_minutes=20,
        estimated_lost_units=40,
    )
    create_escalation(
        analytics_context,
        asset=asset,
        loss_minutes=15,
        estimated_lost_units=50,
    )
    create_escalation(
        analytics_context,
        category=OperationalEscalation.Category.MATERIAL,
        loss_minutes=25,
        estimated_lost_units=100,
        summary="Material delivery delay",
    )

    api_client.force_authenticate(
        user=analytics_context["staff_user"],
    )

    response = api_client.get(reverse("loss-analytics"))

    assert response.status_code == status.HTTP_200_OK

    summary = response.data["summary"]

    assert summary["total_events"] == 4
    assert summary["total_loss_minutes"] == 70
    assert summary["total_estimated_lost_units"] == 220
    assert summary["recurring_asset_count"] == 1
    assert summary["unassigned_asset_events"] == 0

    assert len(response.data["assets"]) == 1

    asset_row = response.data["assets"][0]

    assert asset_row["asset_id"] == asset.id
    assert asset_row["asset_code"] == "PRN-01"
    assert asset_row["occurrences"] == 3
    assert asset_row["affected_shifts"] == 1
    assert asset_row["open_events"] == 3
    assert asset_row["total_loss_minutes"] == 45
    assert asset_row["total_estimated_lost_units"] == 120
    assert asset_row["recurring"] is True

    categories = {row["category"]: row for row in response.data["line_losses"]}

    assert categories["equipment"]["occurrences"] == 3
    assert categories["equipment"]["total_loss_minutes"] == 45
    assert categories["material"]["occurrences"] == 1
    assert categories["material"]["total_loss_minutes"] == 25


@pytest.mark.django_db
def test_loss_analytics_counts_unmapped_equipment_events(
    api_client,
    analytics_context,
):
    create_escalation(
        analytics_context,
        asset=None,
        loss_minutes=12,
        estimated_lost_units=20,
    )

    api_client.force_authenticate(
        user=analytics_context["staff_user"],
    )

    response = api_client.get(reverse("loss-analytics"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["summary"]["unassigned_asset_events"] == 1
    assert response.data["assets"] == []


@pytest.mark.django_db
def test_loss_analytics_rejects_excessive_date_range(
    api_client,
    analytics_context,
):
    today = timezone.localdate()

    api_client.force_authenticate(
        user=analytics_context["staff_user"],
    )

    response = api_client.get(
        reverse("loss-analytics"),
        {
            "date_from": today - timedelta(days=366),
            "date_to": today,
        },
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_escalation_rejects_asset_from_another_line(
    api_client,
    analytics_context,
):
    api_client.force_authenticate(
        user=analytics_context["team_leader"],
    )

    response = api_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": analytics_context["assignment"].id,
            "asset": analytics_context["other_line_asset"].id,
            "category": OperationalEscalation.Category.EQUIPMENT,
            "priority": OperationalEscalation.Priority.MEDIUM,
            "summary": "Packer stopped",
            "response_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "asset" in response.data


@pytest.mark.django_db
def test_non_equipment_escalation_rejects_asset(
    api_client,
    analytics_context,
):
    api_client.force_authenticate(
        user=analytics_context["team_leader"],
    )

    response = api_client.post(
        reverse("operational-escalation-list"),
        {
            "assignment": analytics_context["assignment"].id,
            "asset": analytics_context["asset"].id,
            "category": OperationalEscalation.Category.MATERIAL,
            "priority": OperationalEscalation.Priority.MEDIUM,
            "summary": "Material unavailable",
            "response_due_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "asset" in response.data


@pytest.mark.django_db
def test_resolution_records_confirmed_loss_evidence(
    api_client,
    analytics_context,
):
    escalation = create_escalation(
        analytics_context,
        status_value=OperationalEscalation.Status.ACKNOWLEDGED,
        owner=analytics_context["team_leader"],
    )

    api_client.force_authenticate(
        user=analytics_context["team_leader"],
    )

    response = api_client.post(
        reverse(
            "operational-escalation-resolve",
            args=[escalation.id],
        ),
        {
            "resolution_notes": "Printer reset and line restarted.",
            "asset": analytics_context["asset"].id,
            "loss_minutes": 35,
            "estimated_lost_units": 180,
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK

    escalation.refresh_from_db()

    assert escalation.status == OperationalEscalation.Status.RESOLVED
    assert escalation.asset == analytics_context["asset"]
    assert escalation.loss_minutes == 35
    assert escalation.estimated_lost_units == 180
