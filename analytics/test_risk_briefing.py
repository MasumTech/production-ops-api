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
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    Shift,
    TeamLeaderAssignment,
)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def risk_context(db):
    user_model = get_user_model()
    staff_user = user_model.objects.create_user(
        username="risk.manager",
        password="test-password",
        is_staff=True,
    )
    team_leader = user_model.objects.create_user(
        username="risk.team.leader",
        password="test-password",
    )
    engineer = user_model.objects.create_user(
        username="risk.engineer",
        password="test-password",
    )
    briefing_date = timezone.localdate()
    now = timezone.now()

    production_line = ProductionLine.objects.create(
        code="RISK-LINE-01",
        name="Risk Briefing Line",
        target_units_per_hour=500,
    )
    asset = ProductionAsset.objects.create(
        production_line=production_line,
        code="FILL-RISK-01",
        name="Risk Filler",
        asset_type=ProductionAsset.AssetType.FILLER,
    )
    assignment = TeamLeaderAssignment.objects.create(
        team_leader=team_leader,
        production_line=production_line,
        date=briefing_date,
        shift_type=Shift.ShiftType.DAY,
        assigned_by=staff_user,
    )
    Shift.objects.create(
        production_line=production_line,
        supervisor=staff_user,
        date=briefing_date,
        shift_type=Shift.ShiftType.DAY,
        start_time=time(6, 0),
        end_time=time(18, 0),
        planned_output=1000,
        actual_output=600,
        downtime_minutes=75,
    )
    update = HourlyLineUpdate.objects.create(
        assignment=assignment,
        status=HourlyLineUpdate.Status.RED,
        issue_summary="Filler stopped repeatedly.",
        requires_follow_up=True,
        recorded_at=now - timedelta(minutes=70),
        next_update_due_at=now - timedelta(minutes=10),
        recorded_by=team_leader,
        action_owner=engineer,
    )
    ProductMaterialReadiness.objects.create(
        assignment=assignment,
        sequence_number=1,
        product_code="HELD-01",
        product_name="Held Product",
        planned_quantity=1000,
        status=ProductMaterialReadiness.Status.HELD,
        hold_reason="Quality release pending.",
        created_by=team_leader,
    )
    ProductMaterialReadiness.objects.create(
        assignment=assignment,
        sequence_number=2,
        product_code="SHORT-02",
        product_name="Short Material Product",
        planned_quantity=800,
        status=ProductMaterialReadiness.Status.SHORT,
        shortage_quantity=100,
        owner=engineer,
        expected_available_at=now + timedelta(hours=1),
        created_by=team_leader,
    )
    OperationalEscalation.objects.create(
        assignment=assignment,
        hourly_update=update,
        category=OperationalEscalation.Category.EQUIPMENT,
        priority=OperationalEscalation.Priority.CRITICAL,
        status=OperationalEscalation.Status.OPEN,
        summary="Filler pressure repeatedly dropping",
        immediate_action="Line isolated and engineering contacted.",
        owner=engineer,
        raised_by=team_leader,
        raised_at=now - timedelta(minutes=90),
        response_due_at=now - timedelta(minutes=30),
        asset=asset,
        loss_minutes=70,
        estimated_lost_units=500,
    )

    for days_ago in (4, 10):
        historical_assignment = TeamLeaderAssignment.objects.create(
            team_leader=team_leader,
            production_line=production_line,
            date=briefing_date - timedelta(days=days_ago),
            shift_type=Shift.ShiftType.DAY,
            assigned_by=staff_user,
        )
        OperationalEscalation.objects.create(
            assignment=historical_assignment,
            category=OperationalEscalation.Category.EQUIPMENT,
            priority=OperationalEscalation.Priority.MEDIUM,
            status=OperationalEscalation.Status.OPEN,
            summary=f"Historical filler fault {days_ago}",
            owner=engineer,
            raised_by=team_leader,
            raised_at=now - timedelta(days=days_ago),
            response_due_at=now - timedelta(days=days_ago) + timedelta(hours=1),
            asset=asset,
            loss_minutes=20,
            estimated_lost_units=100,
        )

    return {
        "staff_user": staff_user,
        "team_leader": team_leader,
        "production_line": production_line,
        "briefing_date": briefing_date,
    }


@pytest.mark.django_db
def test_daily_risk_briefing_requires_management_staff(
    api_client,
    risk_context,
):
    api_client.force_authenticate(user=risk_context["team_leader"])

    response = api_client.get(reverse("daily-risk-briefing"))

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_daily_risk_briefing_defaults_to_today(
    api_client,
    risk_context,
):
    api_client.force_authenticate(user=risk_context["staff_user"])

    response = api_client.get(reverse("daily-risk-briefing"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["summary"]["date"] == timezone.localdate().isoformat()


@pytest.mark.django_db
def test_daily_risk_briefing_returns_explainable_critical_evidence(
    api_client,
    risk_context,
):
    api_client.force_authenticate(user=risk_context["staff_user"])

    response = api_client.get(
        reverse("daily-risk-briefing"),
        {"date": risk_context["briefing_date"]},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["summary"]["overall_risk_level"] == "critical"
    assert response.data["summary"]["highest_risk_score"] == 100
    assert response.data["summary"]["rules_version"] == "1.0"
    assert response.data["summary"]["lines_assessed"] == 1

    line = response.data["lines"][0]
    factor_codes = {factor["code"] for factor in line["risk_factors"]}

    assert line["production_line_code"] == "RISK-LINE-01"
    assert line["risk_level"] == "critical"
    assert line["risk_score"] == 100
    assert line["confidence_percent"] == 100
    assert line["missing_data_warnings"] == []
    assert {
        "output_critical_gap",
        "high_downtime",
        "red_line_status",
        "late_line_update",
        "held_material",
        "material_shortage",
        "critical_escalation",
        "overdue_escalation",
        "recurring_asset_fault",
        "high_confirmed_loss",
    }.issubset(factor_codes)

    metrics = line["metrics"]
    assert metrics["performance_percentage"] == 60.0
    assert metrics["downtime_minutes"] == 75
    assert metrics["latest_status"] == "red"
    assert metrics["critical_escalations"] == 1
    assert metrics["overdue_escalations"] == 1
    assert metrics["held_material_items"] == 1
    assert metrics["short_material_items"] == 1
    assert metrics["recurring_asset_faults"] == 1
    assert metrics["confirmed_loss_minutes"] == 70

    for factor in line["risk_factors"]:
        assert factor["source"]
        assert factor["reason"]
        assert isinstance(factor["evidence"], dict)


@pytest.mark.django_db
def test_daily_risk_briefing_discloses_missing_data(
    api_client,
    risk_context,
):
    empty_line = ProductionLine.objects.create(
        code="RISK-LINE-EMPTY",
        name="Empty Evidence Line",
    )
    api_client.force_authenticate(user=risk_context["staff_user"])

    response = api_client.get(
        reverse("daily-risk-briefing"),
        {
            "date": risk_context["briefing_date"],
            "production_line": empty_line.id,
        },
    )

    assert response.status_code == status.HTTP_200_OK
    line = response.data["lines"][0]
    warning_codes = {warning["code"] for warning in line["missing_data_warnings"]}

    assert line["risk_level"] == "high"
    assert line["risk_score"] == 50
    assert line["confidence_percent"] == 0
    assert warning_codes == {
        "missing_assignment",
        "missing_shift",
        "missing_line_status",
        "missing_material_readiness",
        "missing_escalation_evidence",
        "missing_asset_registry",
    }


@pytest.mark.django_db
def test_daily_risk_briefing_rejects_invalid_filters(
    api_client,
    risk_context,
):
    inactive_line = ProductionLine.objects.create(
        code="RISK-LINE-INACTIVE",
        name="Inactive Line",
        status=ProductionLine.Status.INACTIVE,
    )
    api_client.force_authenticate(user=risk_context["staff_user"])

    invalid_date_response = api_client.get(
        reverse("daily-risk-briefing"),
        {"date": "02-09-2026"},
    )
    inactive_line_response = api_client.get(
        reverse("daily-risk-briefing"),
        {"production_line": inactive_line.id},
    )

    assert invalid_date_response.status_code == status.HTTP_400_BAD_REQUEST
    assert "date" in invalid_date_response.data
    assert inactive_line_response.status_code == status.HTTP_400_BAD_REQUEST
    assert "production_line" in inactive_line_response.data


@pytest.mark.django_db
def test_daily_risk_briefing_is_deterministic(
    api_client,
    risk_context,
):
    api_client.force_authenticate(user=risk_context["staff_user"])
    query = {"date": risk_context["briefing_date"]}

    first_response = api_client.get(reverse("daily-risk-briefing"), query)
    second_response = api_client.get(reverse("daily-risk-briefing"), query)

    assert first_response.status_code == status.HTTP_200_OK
    assert second_response.status_code == status.HTTP_200_OK
    assert first_response.data["lines"] == second_response.data["lines"]
    assert (
        first_response.data["summary"]["highest_risk_score"]
        == second_response.data["summary"]["highest_risk_score"]
    )
    assert (
        first_response.data["summary"]["risk_counts"]
        == second_response.data["summary"]["risk_counts"]
    )


@pytest.mark.django_db
def test_daily_risk_briefing_filters_by_active_line(
    api_client,
    risk_context,
):
    ProductionLine.objects.create(
        code="RISK-LINE-OTHER",
        name="Other Active Line",
    )
    api_client.force_authenticate(user=risk_context["staff_user"])

    response = api_client.get(
        reverse("daily-risk-briefing"),
        {
            "date": risk_context["briefing_date"],
            "production_line": risk_context["production_line"].id,
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["summary"]["lines_assessed"] == 1
    assert [line["production_line_code"] for line in response.data["lines"]] == [
        "RISK-LINE-01"
    ]


@pytest.mark.django_db
def test_daily_risk_briefing_query_count_is_bounded(
    api_client,
    risk_context,
    django_assert_max_num_queries,
):
    for index in range(3):
        ProductionLine.objects.create(
            code=f"RISK-BOUND-{index}",
            name=f"Bounded Query Line {index}",
        )
    api_client.force_authenticate(user=risk_context["staff_user"])

    with django_assert_max_num_queries(8):
        response = api_client.get(
            reverse("daily-risk-briefing"),
            {"date": risk_context["briefing_date"]},
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["summary"]["lines_assessed"] == 4
