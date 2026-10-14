from datetime import time, timedelta

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import (
    DailyPlanBlock,
    DowntimeEvent,
    HourlyOutput,
    Shift,
    TeamLeaderAssignment,
)


def default_shift_times(assignment):
    if assignment.shift_type == Shift.ShiftType.NIGHT:
        return time(23), time(7)
    start = time(7) if assignment.date.weekday() >= 5 else time(6, 45)
    return start, time(18)


def assignment_shift(assignment):
    return Shift.objects.filter(
        production_line=assignment.production_line,
        date=assignment.date,
        shift_type=assignment.shift_type,
    ).first()


def is_current_operational_assignment(assignment, *, shift=None, now=None):
    local_now = timezone.localtime(now or timezone.now())
    today = local_now.date()
    if assignment.date == today:
        return True
    if assignment.shift_type != Shift.ShiftType.NIGHT:
        return False

    shift = shift or assignment_shift(assignment)
    _, default_end = default_shift_times(assignment)
    end_time = shift.end_time if shift else default_end
    return assignment.date == today - timedelta(days=1) and local_now.time() < end_time


def operational_edit_failure(assignment, *, now=None):
    if assignment.plan_status != TeamLeaderAssignment.PlanStatus.PUBLISHED:
        return "This plan has not been published or approved by the Operations Manager."
    shift = assignment_shift(assignment)
    if shift is None:
        return "This published plan has no active shift record. Ask a Manager to repair the shift."
    if not is_current_operational_assignment(assignment, shift=shift, now=now):
        return "Operational output, downtime and completion evidence is read-only outside the current operational day."
    return None


@transaction.atomic
def ensure_shift_for_assignment(assignment, *, supervisor=None):
    start_time, end_time = default_shift_times(assignment)
    shift, created = Shift.objects.select_for_update().get_or_create(
        production_line=assignment.production_line,
        date=assignment.date,
        shift_type=assignment.shift_type,
        defaults={
            "supervisor": supervisor,
            "start_time": start_time,
            "end_time": end_time,
            "notes": "Automatically activated from the daily line plan.",
        },
    )
    if not created and shift.supervisor_id is None and supervisor is not None:
        shift.supervisor = supervisor
        shift.save(update_fields=("supervisor", "updated_at"))
    recalculate_shift_totals(assignment, shift=shift)
    return shift, created


@transaction.atomic
def recalculate_shift_totals(assignment, *, shift=None):
    shift = shift or (
        Shift.objects.select_for_update()
        .filter(
            production_line=assignment.production_line,
            date=assignment.date,
            shift_type=assignment.shift_type,
        )
        .first()
    )
    if shift is None:
        return None

    planned_output = sum(
        block.planned_units
        for block in DailyPlanBlock.objects.filter(
            assignment=assignment,
            block_type=DailyPlanBlock.BlockType.PRODUCTION,
        )
    )
    actual_output = (
        HourlyOutput.objects.filter(assignment=assignment).aggregate(
            total=Coalesce(Sum("actual_units"), 0),
        )["total"]
        or 0
    )
    downtime_minutes = sum(
        event.duration_minutes for event in DowntimeEvent.objects.filter(shift=shift)
    )
    changed_fields = []
    for field, value in (
        ("planned_output", planned_output),
        ("actual_output", actual_output),
        ("downtime_minutes", downtime_minutes),
    ):
        if getattr(shift, field) != value:
            setattr(shift, field, value)
            changed_fields.append(field)
    if changed_fields:
        shift.save(update_fields=(*changed_fields, "updated_at"))
    return shift
