from collections import defaultdict
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from operations.models import (
    HourlyLineUpdate,
    OperationalEscalation,
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    Shift,
    TeamLeaderAssignment,
)

RISK_LEVEL_ORDER = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}
COMPLETENESS_SOURCES = (
    "assignment",
    "shift",
    "line_status",
    "material_readiness",
    "escalation",
    "asset_registry",
)


def _risk_level(score):
    if score >= 70:
        return "critical"
    if score >= 40:
        return "high"
    if score >= 20:
        return "medium"
    return "low"


def _factor(code, source, severity, score, reason, **evidence):
    return {
        "code": code,
        "source": source,
        "severity": severity,
        "score": score,
        "reason": reason,
        "evidence": evidence,
    }


def _warning(code, source, message):
    return {
        "code": code,
        "source": source,
        "message": message,
    }


def _keyed_rows(rows, key="production_line_id"):
    return {row[key]: row for row in rows}


def build_daily_risk_briefing(
    briefing_date,
    *,
    production_line=None,
    now=None,
):
    """Build an advisory briefing from existing, deterministic evidence."""
    now = now or timezone.now()

    lines_queryset = ProductionLine.objects.filter(
        status=ProductionLine.Status.ACTIVE,
    ).order_by("code")
    if production_line is not None:
        lines_queryset = lines_queryset.filter(pk=production_line.pk)

    lines = list(lines_queryset)
    line_ids = [line.id for line in lines]

    assignments = list(
        TeamLeaderAssignment.objects.filter(
            production_line_id__in=line_ids,
            date=briefing_date,
        ).only("id", "production_line_id")
    )
    assignment_ids = [assignment.id for assignment in assignments]
    assignment_line_ids = {
        assignment.id: assignment.production_line_id for assignment in assignments
    }
    assignment_counts = defaultdict(int)
    for assignment in assignments:
        assignment_counts[assignment.production_line_id] += 1

    shifts = _keyed_rows(
        Shift.objects.filter(
            production_line_id__in=line_ids,
            date=briefing_date,
        )
        .values("production_line_id")
        .annotate(
            shift_count=Count("id"),
            planned_output=Coalesce(Sum("planned_output"), 0),
            actual_output=Coalesce(Sum("actual_output"), 0),
            downtime_minutes=Coalesce(Sum("downtime_minutes"), 0),
        )
    )

    latest_updates = {}
    updates = HourlyLineUpdate.objects.filter(
        assignment_id__in=assignment_ids,
    ).order_by("-recorded_at", "-id")
    for update in updates:
        line_id = assignment_line_ids[update.assignment_id]
        latest_updates.setdefault(line_id, update)

    materials = _keyed_rows(
        ProductMaterialReadiness.objects.filter(
            assignment_id__in=assignment_ids,
        )
        .values("assignment__production_line_id")
        .annotate(
            material_count=Count("id"),
            short_items=Count(
                "id",
                filter=Q(status=ProductMaterialReadiness.Status.SHORT),
            ),
            held_items=Count(
                "id",
                filter=Q(status=ProductMaterialReadiness.Status.HELD),
            ),
        ),
        key="assignment__production_line_id",
    )

    escalations = _keyed_rows(
        OperationalEscalation.objects.filter(
            assignment_id__in=assignment_ids,
        )
        .values("assignment__production_line_id")
        .annotate(
            escalation_count=Count("id"),
            open_escalations=Count(
                "id",
                filter=~Q(status=OperationalEscalation.Status.RESOLVED),
            ),
            overdue_escalations=Count(
                "id",
                filter=(
                    ~Q(status=OperationalEscalation.Status.RESOLVED)
                    & Q(response_due_at__lt=now)
                ),
            ),
            critical_escalations=Count(
                "id",
                filter=(
                    ~Q(status=OperationalEscalation.Status.RESOLVED)
                    & Q(priority=OperationalEscalation.Priority.CRITICAL)
                ),
            ),
            unassigned_escalations=Count(
                "id",
                filter=(
                    ~Q(status=OperationalEscalation.Status.RESOLVED)
                    & Q(owner__isnull=True)
                ),
            ),
            confirmed_loss_minutes=Coalesce(Sum("loss_minutes"), 0),
            estimated_lost_units=Coalesce(Sum("estimated_lost_units"), 0),
        ),
        key="assignment__production_line_id",
    )

    assets = _keyed_rows(
        ProductionAsset.objects.filter(
            production_line_id__in=line_ids,
            status=ProductionAsset.Status.ACTIVE,
        )
        .values("production_line_id")
        .annotate(asset_count=Count("id"))
    )

    recurring_faults = defaultdict(int)
    history_start = briefing_date - timedelta(days=29)
    historical_rows = (
        OperationalEscalation.objects.filter(
            assignment__production_line_id__in=line_ids,
            assignment__date__range=(history_start, briefing_date),
            category=OperationalEscalation.Category.EQUIPMENT,
            asset__isnull=False,
        )
        .values(
            "assignment__production_line_id",
            "asset_id",
        )
        .annotate(occurrences=Count("id"))
        .filter(occurrences__gte=3)
    )
    for row in historical_rows:
        recurring_faults[row["assignment__production_line_id"]] += 1

    line_payloads = []
    for line in lines:
        line_id = line.id
        shift_row = shifts.get(line_id, {})
        material_row = materials.get(line_id, {})
        escalation_row = escalations.get(line_id, {})
        asset_row = assets.get(line_id, {})
        latest_update = latest_updates.get(line_id)

        assignment_count = assignment_counts[line_id]
        shift_count = shift_row.get("shift_count", 0)
        planned_output = shift_row.get("planned_output", 0)
        actual_output = shift_row.get("actual_output", 0)
        downtime_minutes = shift_row.get("downtime_minutes", 0)
        performance_percentage = (
            round((actual_output / planned_output) * 100, 2) if planned_output else None
        )
        material_count = material_row.get("material_count", 0)
        short_items = material_row.get("short_items", 0)
        held_items = material_row.get("held_items", 0)
        escalation_count = escalation_row.get("escalation_count", 0)
        open_escalations = escalation_row.get("open_escalations", 0)
        overdue_escalations = escalation_row.get("overdue_escalations", 0)
        critical_escalations = escalation_row.get("critical_escalations", 0)
        unassigned_escalations = escalation_row.get("unassigned_escalations", 0)
        confirmed_loss_minutes = escalation_row.get("confirmed_loss_minutes", 0)
        estimated_lost_units = escalation_row.get("estimated_lost_units", 0)
        asset_count = asset_row.get("asset_count", 0)
        recurring_asset_faults = recurring_faults[line_id]

        factors = []
        warnings = []
        completeness = {
            "assignment": assignment_count > 0,
            "shift": shift_count > 0 and planned_output > 0,
            "line_status": latest_update is not None,
            "material_readiness": material_count > 0,
            "escalation": escalation_count > 0,
            "asset_registry": asset_count > 0,
        }

        if not assignment_count:
            warnings.append(
                _warning(
                    "missing_assignment",
                    "assignment",
                    "No line assignment is recorded for this operational date.",
                )
            )
            factors.append(
                _factor(
                    "missing_assignment",
                    "assignment",
                    "high",
                    20,
                    "Line ownership is not recorded.",
                    assignment_count=0,
                )
            )

        if not shift_count:
            warnings.append(
                _warning(
                    "missing_shift",
                    "shift",
                    "No production result is recorded for this line and date.",
                )
            )
            factors.append(
                _factor(
                    "missing_shift",
                    "shift",
                    "medium",
                    15,
                    "Planned and actual output evidence is unavailable.",
                    shift_count=0,
                )
            )
        elif not planned_output:
            warnings.append(
                _warning(
                    "missing_output_plan",
                    "shift",
                    "Shift records exist but planned output is zero.",
                )
            )
            factors.append(
                _factor(
                    "missing_output_plan",
                    "shift",
                    "medium",
                    10,
                    "Performance cannot be calculated without a positive plan.",
                    planned_output=planned_output,
                )
            )
        elif performance_percentage < 70:
            factors.append(
                _factor(
                    "output_critical_gap",
                    "shift",
                    "high",
                    25,
                    "Actual output is below 70% of plan.",
                    planned_output=planned_output,
                    actual_output=actual_output,
                    performance_percentage=performance_percentage,
                )
            )
        elif performance_percentage < 90:
            factors.append(
                _factor(
                    "output_at_risk",
                    "shift",
                    "medium",
                    15,
                    "Actual output is below 90% of plan.",
                    planned_output=planned_output,
                    actual_output=actual_output,
                    performance_percentage=performance_percentage,
                )
            )

        if downtime_minutes >= 60:
            factors.append(
                _factor(
                    "high_downtime",
                    "shift",
                    "high",
                    20,
                    "Recorded downtime is at least 60 minutes.",
                    downtime_minutes=downtime_minutes,
                )
            )
        elif downtime_minutes >= 30:
            factors.append(
                _factor(
                    "elevated_downtime",
                    "shift",
                    "medium",
                    10,
                    "Recorded downtime is at least 30 minutes.",
                    downtime_minutes=downtime_minutes,
                )
            )

        if latest_update is None:
            warnings.append(
                _warning(
                    "missing_line_status",
                    "line_status",
                    "No hourly line status is recorded for this date.",
                )
            )
            factors.append(
                _factor(
                    "missing_line_status",
                    "line_status",
                    "high",
                    15,
                    "Current Green, Amber, or Red condition is unknown.",
                    update_count=0,
                )
            )
        else:
            if latest_update.status == HourlyLineUpdate.Status.RED:
                factors.append(
                    _factor(
                        "red_line_status",
                        "line_status",
                        "critical",
                        35,
                        "Latest recorded line condition is Red.",
                        status=latest_update.status,
                        update_id=latest_update.id,
                    )
                )
            elif latest_update.status == HourlyLineUpdate.Status.AMBER:
                factors.append(
                    _factor(
                        "amber_line_status",
                        "line_status",
                        "high",
                        20,
                        "Latest recorded line condition is Amber.",
                        status=latest_update.status,
                        update_id=latest_update.id,
                    )
                )

            if latest_update.next_update_due_at < now:
                factors.append(
                    _factor(
                        "late_line_update",
                        "line_status",
                        "high",
                        15,
                        "The next line update deadline has passed.",
                        update_id=latest_update.id,
                        next_update_due_at=latest_update.next_update_due_at.isoformat(),
                    )
                )

        if not material_count:
            warnings.append(
                _warning(
                    "missing_material_readiness",
                    "material_readiness",
                    "No product or material readiness record exists for this date.",
                )
            )
        if held_items:
            factors.append(
                _factor(
                    "held_material",
                    "material_readiness",
                    "high",
                    min(25, 15 + ((held_items - 1) * 5)),
                    "One or more planned items are held.",
                    held_items=held_items,
                )
            )
        if short_items:
            factors.append(
                _factor(
                    "material_shortage",
                    "material_readiness",
                    "high",
                    min(20, 10 + ((short_items - 1) * 5)),
                    "One or more planned items have a recorded shortage.",
                    short_items=short_items,
                )
            )

        if not escalation_count:
            warnings.append(
                _warning(
                    "missing_escalation_evidence",
                    "escalation",
                    "No escalation record exists; confirm this represents no issues.",
                )
            )
        if critical_escalations:
            factors.append(
                _factor(
                    "critical_escalation",
                    "escalation",
                    "critical",
                    min(30, 20 + ((critical_escalations - 1) * 5)),
                    "A critical escalation remains unresolved.",
                    critical_escalations=critical_escalations,
                )
            )
        if overdue_escalations:
            factors.append(
                _factor(
                    "overdue_escalation",
                    "escalation",
                    "high",
                    min(20, 10 + ((overdue_escalations - 1) * 5)),
                    "An unresolved escalation has passed its response deadline.",
                    overdue_escalations=overdue_escalations,
                )
            )
        if unassigned_escalations:
            factors.append(
                _factor(
                    "unassigned_escalation",
                    "escalation",
                    "high",
                    min(15, unassigned_escalations * 5),
                    "An unresolved escalation has no response owner.",
                    unassigned_escalations=unassigned_escalations,
                )
            )

        if not asset_count:
            warnings.append(
                _warning(
                    "missing_asset_registry",
                    "asset_registry",
                    "No active production asset is registered for this line.",
                )
            )
        if recurring_asset_faults:
            factors.append(
                _factor(
                    "recurring_asset_fault",
                    "asset_history",
                    "high",
                    min(20, recurring_asset_faults * 10),
                    "An asset has at least three equipment escalations in 30 days.",
                    recurring_asset_faults=recurring_asset_faults,
                    history_days=30,
                )
            )

        if confirmed_loss_minutes >= 60:
            factors.append(
                _factor(
                    "high_confirmed_loss",
                    "escalation",
                    "high",
                    15,
                    "Confirmed operational loss is at least 60 minutes.",
                    confirmed_loss_minutes=confirmed_loss_minutes,
                    estimated_lost_units=estimated_lost_units,
                )
            )
        elif confirmed_loss_minutes > 0:
            factors.append(
                _factor(
                    "recorded_operational_loss",
                    "escalation",
                    "medium",
                    5,
                    "Confirmed operational loss has been recorded.",
                    confirmed_loss_minutes=confirmed_loss_minutes,
                    estimated_lost_units=estimated_lost_units,
                )
            )

        score = min(100, sum(factor["score"] for factor in factors))
        factors.sort(
            key=lambda factor: (
                -RISK_LEVEL_ORDER[factor["severity"]],
                -factor["score"],
                factor["code"],
            )
        )
        confidence_percent = round(
            (sum(completeness.values()) / len(COMPLETENESS_SOURCES)) * 100
        )

        line_payloads.append(
            {
                "production_line_id": line.id,
                "production_line_code": line.code,
                "production_line_name": line.name,
                "risk_level": _risk_level(score),
                "risk_score": score,
                "confidence_percent": confidence_percent,
                "risk_factors": factors,
                "missing_data_warnings": warnings,
                "metrics": {
                    "assignment_count": assignment_count,
                    "shift_count": shift_count,
                    "planned_output": planned_output,
                    "actual_output": actual_output,
                    "performance_percentage": performance_percentage,
                    "downtime_minutes": downtime_minutes,
                    "latest_status": (
                        latest_update.status if latest_update is not None else None
                    ),
                    "latest_update_at": (
                        latest_update.recorded_at if latest_update is not None else None
                    ),
                    "open_escalations": open_escalations,
                    "overdue_escalations": overdue_escalations,
                    "critical_escalations": critical_escalations,
                    "unassigned_escalations": unassigned_escalations,
                    "short_material_items": short_items,
                    "held_material_items": held_items,
                    "active_assets": asset_count,
                    "recurring_asset_faults": recurring_asset_faults,
                    "confirmed_loss_minutes": confirmed_loss_minutes,
                    "estimated_lost_units": estimated_lost_units,
                },
            }
        )

    line_payloads.sort(
        key=lambda row: (
            -RISK_LEVEL_ORDER[row["risk_level"]],
            -row["risk_score"],
            row["production_line_code"],
        )
    )
    risk_counts = {level: 0 for level in RISK_LEVEL_ORDER}
    for row in line_payloads:
        risk_counts[row["risk_level"]] += 1

    highest_score = max(
        (row["risk_score"] for row in line_payloads),
        default=0,
    )
    average_confidence = (
        round(
            sum(row["confidence_percent"] for row in line_payloads) / len(line_payloads)
        )
        if line_payloads
        else 0
    )

    return {
        "summary": {
            "date": briefing_date,
            "generated_at": now,
            "rules_version": "1.0",
            "overall_risk_level": _risk_level(highest_score),
            "highest_risk_score": highest_score,
            "average_confidence_percent": average_confidence,
            "lines_assessed": len(line_payloads),
            "risk_counts": risk_counts,
        },
        "lines": line_payloads,
    }
