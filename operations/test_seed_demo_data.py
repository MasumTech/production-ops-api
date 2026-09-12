from datetime import date
from io import StringIO
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count
from django.test import override_settings

from operations.models import (
    BreakOpportunity,
    BreakRecovery,
    DailyPlanBlock,
    DowntimeEvent,
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)

DEMO_DATE = "2026-09-02"
DEMO_PASSWORD = f"test-{uuid4().hex}"
FULL_RESET_CONFIRMATION = "DELETE-ALL-LOCAL-DATA"


def run_seed(**options):
    output = StringIO()
    call_command(
        "seed_demo_data",
        stdout=output,
        **options,
    )
    return output.getvalue()


def demo_counts():
    line_filter = {"production_line__code__startswith": "DEMO-"}
    assignment_filter = {"assignment__production_line__code__startswith": "DEMO-"}

    return {
        "users": get_user_model().objects.filter(username__startswith="demo.").count(),
        "lines": ProductionLine.objects.filter(code__startswith="DEMO-").count(),
        "assets": ProductionAsset.objects.filter(**line_filter).count(),
        "assignments": TeamLeaderAssignment.objects.filter(**line_filter).count(),
        "shifts": Shift.objects.filter(**line_filter).count(),
        "downtime_events": DowntimeEvent.objects.filter(
            shift__production_line__code__startswith="DEMO-"
        ).count(),
        "plan_blocks": DailyPlanBlock.objects.filter(**assignment_filter).count(),
        "updates": HourlyLineUpdate.objects.filter(**assignment_filter).count(),
        "materials": ProductMaterialReadiness.objects.filter(
            **assignment_filter
        ).count(),
        "escalations": OperationalEscalation.objects.filter(
            **assignment_filter
        ).count(),
        "breaks": BreakRecovery.objects.filter(**assignment_filter).count(),
        "break_opportunities": BreakOpportunity.objects.filter(
            **assignment_filter
        ).count(),
        "handovers": ShiftHandover.objects.filter(
            outgoing_assignment__production_line__code__startswith="DEMO-"
        ).count(),
        "incidents": QualityIncident.objects.filter(
            shift__production_line__code__startswith="DEMO-"
        ).count(),
    }


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_seed_demo_data_creates_complete_dataset():
    output = run_seed(
        date=DEMO_DATE,
        password=DEMO_PASSWORD,
        reset=True,
    )

    assert demo_counts() == {
        "users": 4,
        "lines": 6,
        "assets": 3,
        "assignments": 9,
        "shifts": 6,
        "downtime_events": 7,
        "plan_blocks": 30,
        "updates": 8,
        "materials": 4,
        "escalations": 5,
        "breaks": 2,
        "break_opportunities": 2,
        "handovers": 1,
        "incidents": 1,
    }

    manager = get_user_model().objects.get(username="demo.manager")
    assert manager.is_staff is True
    assert manager.check_password(DEMO_PASSWORD)
    assert set(get_user_model().objects.values_list("username", flat=True)) == {
        "demo.manager",
        "demo.leader",
        "demo.leader.two",
        "demo.leader.three",
    }

    assert TeamLeaderAssignment.objects.filter(
        production_line__code="DEMO-LINE-01",
        date=date(2026, 9, 2),
        shift_type=Shift.ShiftType.DAY,
    ).exists()
    assert (
        DailyPlanBlock.objects.filter(
            assignment__production_line__code="DEMO-LINE-01",
            block_type=DailyPlanBlock.BlockType.BREAK,
        ).count()
        == 2
    )
    assert BreakOpportunity.objects.filter(
        status=BreakOpportunity.Status.RECOVERED
    ).exists()
    assert BreakOpportunity.objects.filter(
        status=BreakOpportunity.Status.SUGGESTED
    ).exists()
    assert (
        sum(
            event.duration_minutes
            for event in DowntimeEvent.objects.filter(
                shift__production_line__code__startswith="DEMO-"
            )
        )
        == 42
    )
    for shift in Shift.objects.filter(date=date(2026, 9, 2)):
        assert shift.downtime_minutes == sum(
            event.duration_minutes for event in shift.downtime_events.all()
        )
    assert list(
        TeamLeaderAssignment.objects.filter(
            date=date(2026, 9, 2),
            shift_type=Shift.ShiftType.DAY,
        )
        .values("team_leader_id")
        .annotate(line_count=Count("production_line_id"))
        .values_list("line_count", flat=True)
        .order_by("team_leader_id")
    ) == [2, 2, 2]
    current_assignments = TeamLeaderAssignment.objects.filter(
        date=date(2026, 9, 2),
        shift_type=Shift.ShiftType.DAY,
    )
    assert all(
        assignment.daily_plan_blocks.count() == 5
        and assignment.daily_plan_blocks.filter(
            block_type=DailyPlanBlock.BlockType.BREAK,
        ).count()
        == 2
        for assignment in current_assignments
    )
    assert set(
        HourlyLineUpdate.objects.filter(
            assignment__in=current_assignments,
        ).values_list("status", flat=True)
    ) == {
        HourlyLineUpdate.Status.GREEN,
        HourlyLineUpdate.Status.AMBER,
        HourlyLineUpdate.Status.RED,
    }
    assert set(ProductMaterialReadiness.objects.values_list("status", flat=True)) == {
        ProductMaterialReadiness.Status.READY,
        ProductMaterialReadiness.Status.IN_PROCESS,
        ProductMaterialReadiness.Status.SHORT,
        ProductMaterialReadiness.Status.HELD,
    }
    assert set(BreakOpportunity.objects.values_list("status", flat=True)) == {
        BreakOpportunity.Status.SUGGESTED,
        BreakOpportunity.Status.RECOVERED,
    }
    handover = ShiftHandover.objects.get()
    assert handover.status == ShiftHandover.Status.PENDING
    assert handover.escalations.filter(
        status=OperationalEscalation.Status.OPEN,
    ).exists()

    assert "Demo dataset is ready." in output
    assert "Operational date: 2026-09-02" in output
    assert DEMO_PASSWORD not in output


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_seed_demo_data_is_repeatable():
    options = {
        "date": DEMO_DATE,
        "password": DEMO_PASSWORD,
    }

    run_seed(**options)
    first_counts = demo_counts()

    run_seed(**options)
    second_counts = demo_counts()

    assert second_counts == first_counts


@pytest.mark.django_db
@override_settings(DEBUG=True)
def test_reset_removes_only_demo_records():
    live_line = ProductionLine.objects.create(
        code="LIVE-LINE-01",
        name="Existing Production Line",
    )
    ProductionLine.objects.create(
        code="DEMO-OBSOLETE",
        name="Old Demo Line",
    )

    run_seed(
        date=DEMO_DATE,
        password=DEMO_PASSWORD,
        reset=True,
    )

    assert ProductionLine.objects.filter(pk=live_line.pk).exists()
    assert not ProductionLine.objects.filter(code="DEMO-OBSOLETE").exists()
    assert ProductionLine.objects.filter(code="DEMO-LINE-01").exists()


@pytest.mark.django_db(transaction=True)
@override_settings(DEBUG=True)
def test_full_reset_flushes_every_record_then_creates_persona_dataset():
    get_user_model().objects.create_user(
        username="old.local.user",
        password="not-used-after-reset",
    )
    ProductionLine.objects.create(
        code="OLD-LOCAL-LINE",
        name="Old Local Line",
    )

    output = run_seed(
        date=DEMO_DATE,
        password=DEMO_PASSWORD,
        full_reset=True,
        confirm_full_reset=FULL_RESET_CONFIRMATION,
    )

    assert not get_user_model().objects.filter(username="old.local.user").exists()
    assert not ProductionLine.objects.filter(code="OLD-LOCAL-LINE").exists()
    assert get_user_model().objects.count() == 4
    assert ProductionLine.objects.count() == 6
    assert "Demo dataset is ready." in output


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("options", "expected_message"),
    [
        (
            {"date": "02-09-2026", "password": DEMO_PASSWORD},
            "--date must use YYYY-MM-DD format.",
        ),
        (
            {"date": DEMO_DATE, "password": "short"},
            "Provide --password or DEMO_SEED_PASSWORD",
        ),
        (
            {
                "date": DEMO_DATE,
                "password": DEMO_PASSWORD,
                "full_reset": True,
            },
            "Full reset deletes every local database record",
        ),
        (
            {
                "date": DEMO_DATE,
                "password": DEMO_PASSWORD,
                "reset": True,
                "full_reset": True,
                "confirm_full_reset": FULL_RESET_CONFIRMATION,
            },
            "Use either --reset or --full-reset",
        ),
    ],
)
@override_settings(DEBUG=True)
def test_seed_demo_data_rejects_invalid_options(
    options,
    expected_message,
):
    with pytest.raises(CommandError, match=expected_message):
        run_seed(**options)


@pytest.mark.django_db
@override_settings(DEBUG=False)
def test_seed_demo_data_is_blocked_outside_debug_mode():
    with pytest.raises(
        CommandError,
        match="Demo seeding is disabled while DJANGO_DEBUG is false.",
    ):
        run_seed(
            date=DEMO_DATE,
            password=DEMO_PASSWORD,
        )
