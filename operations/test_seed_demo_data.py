from datetime import date
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from operations.models import (
    BreakRecovery,
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
DEMO_PASSWORD = "StrongDemoPass123!"


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
        "updates": HourlyLineUpdate.objects.filter(**assignment_filter).count(),
        "materials": ProductMaterialReadiness.objects.filter(
            **assignment_filter
        ).count(),
        "escalations": OperationalEscalation.objects.filter(
            **assignment_filter
        ).count(),
        "breaks": BreakRecovery.objects.filter(**assignment_filter).count(),
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
        "lines": 3,
        "assets": 3,
        "assignments": 6,
        "shifts": 3,
        "updates": 2,
        "materials": 3,
        "escalations": 5,
        "breaks": 2,
        "handovers": 1,
        "incidents": 1,
    }

    manager = get_user_model().objects.get(username="demo.manager")
    assert manager.is_staff is True
    assert manager.check_password(DEMO_PASSWORD)

    assert TeamLeaderAssignment.objects.filter(
        production_line__code="DEMO-LINE-01",
        date=date(2026, 9, 2),
        shift_type=Shift.ShiftType.DAY,
    ).exists()

    assert "Demo dataset is ready." in output
    assert "Operational date: 2026-09-02" in output


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
            "The demo password must contain at least 8 characters.",
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
