from datetime import timedelta

from .models import BreakOpportunity, DailyPlanBlock, HourlyLineUpdate


def detect_break_opportunity(
    line_update: HourlyLineUpdate,
) -> BreakOpportunity | None:
    """Suggest an approved 40-minute break when a RED stop is near a break window."""

    if line_update.status != HourlyLineUpdate.Status.RED:
        return None

    fault_at = line_update.recorded_at
    search_until = fault_at + timedelta(minutes=60)
    break_block = (
        DailyPlanBlock.objects.filter(
            assignment=line_update.assignment,
            block_type=DailyPlanBlock.BlockType.BREAK,
            planned_start_at__lte=search_until,
            planned_end_at__gte=fault_at,
        )
        .exclude(
            break_opportunities__status__in=(
                BreakOpportunity.Status.SUGGESTED,
                BreakOpportunity.Status.CONFIRMED,
                BreakOpportunity.Status.RETURNED,
                BreakOpportunity.Status.CHECKS_COMPLETE,
            )
        )
        .order_by("planned_start_at")
        .first()
    )

    if break_block is None:
        return None

    opportunity = BreakOpportunity(
        assignment=line_update.assignment,
        break_block=break_block,
        source_update=line_update,
        fault_at=fault_at,
        suggested_start_at=fault_at,
        expected_return_at=fault_at + timedelta(minutes=40),
    )
    opportunity.full_clean()
    opportunity.save()
    return opportunity
