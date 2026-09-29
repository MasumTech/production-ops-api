from datetime import date, time
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q, Sum
from django.utils import timezone

from operations.models import (
    BreakOpportunity,
    BreakRecovery,
    DailyPlanBlock,
    DowntimeEvent,
    HourlyLineUpdate,
    HourlyOutput,
    IdempotentRequest,
    OperationalEscalation,
    OperationalEvent,
    OperationalEventReadReceipt,
    OperationalEvidence,
    OperationalWorkerHeartbeat,
    PilotApproval,
    PilotFeedback,
    PilotObservation,
    PilotTrial,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)

DEMO_PREFIX = "DEMO-"
DEMO_USER_PREFIX = "demo."


class Command(BaseCommand):
    help = "Verify that the complete local showcase dataset is present and coherent."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            help="Operational date in YYYY-MM-DD format (default: today).",
        )

    def handle(self, *args, **options):
        operational_date = self._parse_date(options["date"])
        users = get_user_model().objects.filter(username__startswith=DEMO_USER_PREFIX)
        assignments = TeamLeaderAssignment.objects.filter(
            production_line__code__startswith=DEMO_PREFIX,
            date=operational_date,
            shift_type=Shift.ShiftType.DAY,
        )
        shifts = Shift.objects.filter(
            production_line__code__startswith=DEMO_PREFIX,
            date=operational_date,
            shift_type=Shift.ShiftType.DAY,
        )
        updates = HourlyLineUpdate.objects.filter(assignment__in=assignments)
        materials = ProductMaterialReadiness.objects.filter(assignment__in=assignments)
        opportunities = BreakOpportunity.objects.filter(assignment__in=assignments)
        escalations = OperationalEscalation.objects.filter(
            assignment__production_line__code__startswith=DEMO_PREFIX,
        )
        events = OperationalEvent.objects.filter(
            Q(production_line__code__startswith=DEMO_PREFIX)
            | Q(assignment__production_line__code__startswith=DEMO_PREFIX)
            | Q(actor__username__startswith=DEMO_USER_PREFIX)
        )
        evidence = OperationalEvidence.objects.filter(
            hourly_update__assignment__in=assignments,
        )
        leader_line_counts = list(
            assignments.values("team_leader_id")
            .annotate(line_count=Count("production_line_id"))
            .values_list("line_count", flat=True)
            .order_by("team_leader_id")
        )
        output_totals_match = all(
            HourlyOutput.objects.filter(
                assignment__date=shift.date,
                assignment__shift_type=shift.shift_type,
                assignment__production_line=shift.production_line,
            ).aggregate(total=Sum("actual_units"))["total"]
            == shift.actual_output
            for shift in shifts
        )
        day_four = opportunities.filter(
            assignment__production_line__code="DEMO-LINE-02",
            status=BreakOpportunity.Status.RECOVERED,
        ).first()
        site_timezone = ZoneInfo("Europe/London")
        worker = OperationalWorkerHeartbeat.objects.filter(
            worker_name="operational-reminders",
        ).first()
        demo_trials = PilotTrial.objects.filter(name__startswith=DEMO_PREFIX)
        pilot_statuses = set(demo_trials.values_list("status", flat=True))
        approval_decisions = set(
            PilotApproval.objects.filter(trial__in=demo_trials).values_list(
                "decision", flat=True
            )
        )
        feedback_categories = set(
            PilotFeedback.objects.filter(trial__in=demo_trials).values_list(
                "category", flat=True
            )
        )

        checks = [
            ("personas", users.count() == 5, f"{users.count()} demo accounts"),
            (
                "two lines per Team Leader",
                leader_line_counts == [2, 2, 2],
                f"line distribution {leader_line_counts}",
            ),
            ("six live day shifts", shifts.count() == 6, f"{shifts.count()} shifts"),
            (
                "hourly output reconciles",
                output_totals_match,
                "hourly totals equal each shift actual",
            ),
            (
                "RAG line states",
                set(updates.values_list("status", flat=True))
                == {
                    HourlyLineUpdate.Status.GREEN,
                    HourlyLineUpdate.Status.AMBER,
                    HourlyLineUpdate.Status.RED,
                },
                "Green, Amber and Red present",
            ),
            (
                "material states",
                set(materials.values_list("status", flat=True))
                == {
                    ProductMaterialReadiness.Status.READY,
                    ProductMaterialReadiness.Status.IN_PROCESS,
                    ProductMaterialReadiness.Status.SHORT,
                    ProductMaterialReadiness.Status.HELD,
                },
                "Ready, In process, Short and Held present",
            ),
            (
                "downtime evidence",
                sum(
                    event.duration_minutes
                    for event in DowntimeEvent.objects.filter(shift__in=shifts)
                )
                == 42,
                "42 recorded minutes across seven events",
            ),
            (
                "protected break plan",
                DailyPlanBlock.objects.filter(
                    assignment__in=assignments,
                    block_type=DailyPlanBlock.BlockType.BREAK,
                ).count()
                == 12,
                "two 40-minute breaks on each line",
            ),
            (
                "break opportunity states",
                set(opportunities.values_list("status", flat=True))
                == {
                    BreakOpportunity.Status.SUGGESTED,
                    BreakOpportunity.Status.RECOVERED,
                },
                "suggested and recovered examples present",
            ),
            (
                "10:08 recovery story",
                bool(
                    day_four
                    and day_four.fault_at.astimezone(site_timezone).time()
                    == time(10, 8)
                    and day_four.expected_return_at.astimezone(site_timezone).time()
                    == time(10, 48)
                    and day_four.checks_completed_at.astimezone(site_timezone).time()
                    == time(10, 53)
                ),
                "fault 10:08, return 10:48, checks 10:53",
            ),
            (
                "legacy break controls",
                set(
                    BreakRecovery.objects.filter(
                        assignment__in=assignments
                    ).values_list("status", flat=True)
                )
                == {BreakRecovery.Status.ACTIVE, BreakRecovery.Status.PLANNED},
                "active overdue and planned examples present",
            ),
            (
                "action ownership",
                escalations.filter(status=OperationalEscalation.Status.OPEN).exists()
                and escalations.filter(owner__isnull=True).exists()
                and escalations.filter(owner__username="demo.support").exists(),
                "open, unassigned and Support-owned actions present",
            ),
            (
                "loss history",
                escalations.filter(
                    assignment__date__lt=operational_date,
                    status=OperationalEscalation.Status.RESOLVED,
                ).count()
                == 2,
                "two resolved historical losses present",
            ),
            (
                "quality and handover",
                QualityIncident.objects.filter(shift__in=shifts).exists()
                and ShiftHandover.objects.filter(
                    outgoing_assignment__in=assignments,
                    status=ShiftHandover.Status.PENDING,
                ).exists(),
                "investigating incident and pending handover present",
            ),
            (
                "uploaded evidence",
                evidence.count() == 1
                and default_storage.exists(evidence.first().file.name),
                "downloadable dummy text evidence present",
            ),
            (
                "notification severities",
                set(events.values_list("severity", flat=True))
                == {
                    OperationalEvent.Severity.INFO,
                    OperationalEvent.Severity.WARNING,
                    OperationalEvent.Severity.CRITICAL,
                },
                f"{events.count()} Info, Warning and Critical events",
            ),
            (
                "notification read state",
                OperationalEventReadReceipt.objects.filter(event__in=events).count()
                >= 2,
                "manager and Team Leader read receipts present",
            ),
            (
                "offline idempotency",
                IdempotentRequest.objects.filter(
                    user__username="demo.leader",
                    completed_at__isnull=False,
                    response_status=201,
                ).exists(),
                "completed replay-safe request present",
            ),
            (
                "reminder worker",
                bool(worker and worker.last_completed_at and not worker.last_error),
                "successful operational-reminders heartbeat present",
            ),
            (
                "pilot lifecycle",
                pilot_statuses
                == {
                    PilotTrial.Status.PLANNED,
                    PilotTrial.Status.ACTIVE,
                    PilotTrial.Status.COMPLETED,
                    PilotTrial.Status.STOPPED,
                },
                "planned, active, completed and stopped trials present",
            ),
            (
                "pilot approvals",
                approval_decisions
                == {
                    PilotApproval.Decision.PENDING,
                    PilotApproval.Decision.APPROVED,
                    PilotApproval.Decision.CHANGES_REQUESTED,
                },
                "pending, approved and changes-requested decisions present",
            ),
            (
                "pilot observations",
                PilotObservation.objects.filter(trial__in=demo_trials).count() == 5,
                "five multi-line evidence rows present",
            ),
            (
                "pilot feedback",
                feedback_categories
                == {
                    PilotFeedback.Category.USABILITY,
                    PilotFeedback.Category.WORKFLOW,
                    PilotFeedback.Category.SAFETY_QUALITY,
                    PilotFeedback.Category.TECHNICAL,
                },
                "all four feedback categories present",
            ),
        ]

        failures = []
        self.stdout.write(f"Showcase verification for {operational_date.isoformat()}")
        for label, passed, detail in checks:
            marker = self.style.SUCCESS("PASS") if passed else self.style.ERROR("FAIL")
            self.stdout.write(f"[{marker}] {label}: {detail}")
            if not passed:
                failures.append(label)

        if failures:
            raise CommandError("Showcase verification failed: " + ", ".join(failures))
        self.stdout.write(
            self.style.SUCCESS(f"All {len(checks)} showcase checks passed.")
        )

    @staticmethod
    def _parse_date(value):
        if not value:
            return timezone.localdate()
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise CommandError("--date must use YYYY-MM-DD format.") from exc
