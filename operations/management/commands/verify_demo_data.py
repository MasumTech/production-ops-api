from datetime import date, time, timedelta
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
    ProductionAsset,
    ProductionLine,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)

DEMO_PREFIX = "DEMO-"
DEMO_USER_PREFIX = "demo."
SHOWCASE_SNAPSHOT_TIME = time(16, 10)
SITE_TIMEZONE = ZoneInfo("Europe/London")


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
        lines = ProductionLine.objects.filter(code__startswith=DEMO_PREFIX)
        assets = ProductionAsset.objects.filter(
            production_line__code__startswith=DEMO_PREFIX
        )
        all_assignments = TeamLeaderAssignment.objects.filter(
            production_line__code__startswith=DEMO_PREFIX,
        )
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
        plan_blocks = DailyPlanBlock.objects.filter(assignment__in=assignments)
        hourly_outputs = HourlyOutput.objects.filter(assignment__in=assignments)
        downtime_events = DowntimeEvent.objects.filter(shift__in=shifts)
        handovers = ShiftHandover.objects.filter(outgoing_assignment__in=assignments)
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
        output_details_complete = all(
            output.last_edited_by_id is not None and bool(output.notes.strip())
            for output in hourly_outputs
        )
        day_four = opportunities.filter(
            assignment__production_line__code="DEMO-LINE-02",
            status=BreakOpportunity.Status.RECOVERED,
        ).first()
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
        latest_updates = {}
        for update in updates.select_related("assignment__production_line").order_by(
            "recorded_at", "id"
        ):
            latest_updates[update.assignment.production_line.code] = update

        expected_line_stories = {
            "DEMO-LINE-01": (
                HourlyLineUpdate.Status.GREEN,
                "Vegetable Spring Rolls",
            ),
            "DEMO-LINE-02": (
                HourlyLineUpdate.Status.AMBER,
                "Vegetable Mix Filling",
            ),
            "DEMO-LINE-03": (
                HourlyLineUpdate.Status.GREEN,
                "Vegetable Spring Rolls",
            ),
            "DEMO-LINE-04": (HourlyLineUpdate.Status.RED, "Baja Milk Foam"),
            "DEMO-LINE-05": (
                HourlyLineUpdate.Status.GREEN,
                "BBQ Chicken Bites",
            ),
            "DEMO-LINE-06": (
                HourlyLineUpdate.Status.AMBER,
                "Sweet & Sour Chicken",
            ),
        }
        line_stories_match = all(
            code in latest_updates
            and latest_updates[code].status == status
            and latest_updates[code].current_product == product
            for code, (status, product) in expected_line_stories.items()
        )
        latest_snapshot_times = [
            update.recorded_at.astimezone(SITE_TIMEZONE).time().replace(tzinfo=None)
            for update in latest_updates.values()
        ]
        snapshot_is_aligned = bool(
            latest_snapshot_times
            and max(latest_snapshot_times) == SHOWCASE_SNAPSHOT_TIME
            and all(value <= SHOWCASE_SNAPSHOT_TIME for value in latest_snapshot_times)
        )

        expected_shift_totals = {
            "DEMO-LINE-01": (8400, 6888, 4),
            "DEMO-LINE-02": (6000, 4020, 8),
            "DEMO-LINE-03": (7200, 6350, 5),
            "DEMO-LINE-04": (6400, 3450, 14),
            "DEMO-LINE-05": (7000, 6160, 3),
            "DEMO-LINE-06": (5800, 3538, 8),
        }
        shift_totals_match = all(
            shift.production_line.code in expected_shift_totals
            and (
                shift.planned_output,
                shift.actual_output,
                shift.downtime_minutes,
            )
            == expected_shift_totals[shift.production_line.code]
            for shift in shifts.select_related("production_line")
        )
        hourly_coverage_is_complete = all(
            hourly_outputs.filter(assignment=assignment).count() == 11
            and hourly_outputs.filter(assignment=assignment)
            .latest("hour_start_at")
            .hour_start_at.astimezone(SITE_TIMEZONE)
            .time()
            .replace(tzinfo=None)
            == time(16, 0)
            for assignment in assignments
        )
        plan_rows_are_complete = all(
            plan_blocks.filter(assignment=assignment).count() == 5
            and plan_blocks.filter(
                assignment=assignment,
                block_type=DailyPlanBlock.BlockType.PRODUCTION,
            ).count()
            == 3
            and all(
                block.planned_end_at - block.planned_start_at == timedelta(minutes=40)
                for block in plan_blocks.filter(
                    assignment=assignment,
                    block_type=DailyPlanBlock.BlockType.BREAK,
                )
            )
            for assignment in assignments
        )
        line_four_break = plan_blocks.filter(
            assignment__production_line__code="DEMO-LINE-04",
            block_type=DailyPlanBlock.BlockType.BREAK,
            break_number=2,
        ).first()
        line_four_opportunity = opportunities.filter(
            assignment__production_line__code="DEMO-LINE-04",
            status=BreakOpportunity.Status.SUGGESTED,
        ).first()
        line_four_recovery_story = bool(
            line_four_break
            and line_four_opportunity
            and line_four_opportunity.fault_at.astimezone(SITE_TIMEZONE).time()
            == time(16, 10)
            and line_four_opportunity.source_update.recorded_at.astimezone(
                SITE_TIMEZONE
            ).time()
            == time(16, 10)
            and line_four_break.planned_start_at.astimezone(SITE_TIMEZONE).time()
            == time(16, 20)
            and line_four_break.planned_end_at.astimezone(SITE_TIMEZONE).time()
            == time(17, 0)
            and line_four_opportunity.suggested_start_at.astimezone(
                SITE_TIMEZONE
            ).time()
            == time(16, 20)
            and line_four_opportunity.expected_return_at.astimezone(
                SITE_TIMEZONE
            ).time()
            == time(17, 0)
        )
        short_material = materials.filter(product_code="OMC-01").first()
        held_material = materials.filter(product_code="BBQ-02").first()
        material_details_are_complete = bool(
            short_material
            and short_material.shortage_quantity == 640
            and short_material.needed_by_at.astimezone(SITE_TIMEZONE).time()
            == time(10, 30)
            and held_material
            and held_material.hold_reason
            and held_material.expected_action == "Do not use"
        )
        current_open_actions = escalations.filter(
            assignment__date=operational_date,
            status=OperationalEscalation.Status.OPEN,
        )
        action_portfolio_is_complete = bool(
            current_open_actions.count() == 4
            and current_open_actions.filter(
                priority=OperationalEscalation.Priority.CRITICAL
            ).exists()
            and current_open_actions.filter(
                priority=OperationalEscalation.Priority.HIGH
            ).exists()
            and current_open_actions.filter(owner__isnull=True).exists()
            and current_open_actions.filter(owner__username="demo.support").exists()
        )
        pending_handover = handovers.filter(status=ShiftHandover.Status.PENDING).first()
        handover_story_is_complete = bool(
            pending_handover
            and pending_handover.operational_summary
            == "Filler pressure issue remains under engineering control."
            and pending_handover.notes
            == "Confirm stable pressure before increasing speed."
            and pending_handover.escalations.filter(
                priority=OperationalEscalation.Priority.CRITICAL,
                status=OperationalEscalation.Status.OPEN,
            ).exists()
        )
        exact_inventory = {
            "users": users.count(),
            "lines": lines.count(),
            "assets": assets.count(),
            "assignments": all_assignments.count(),
            "shifts": shifts.count(),
            "downtime_events": downtime_events.count(),
            "plan_blocks": plan_blocks.count(),
            "hourly_outputs": hourly_outputs.count(),
            "updates": updates.count(),
            "materials": materials.count(),
            "escalations": escalations.count(),
            "break_opportunities": opportunities.count(),
            "legacy_breaks": BreakRecovery.objects.filter(
                assignment__in=assignments
            ).count(),
            "handovers": handovers.count(),
            "quality_incidents": QualityIncident.objects.filter(
                shift__in=shifts
            ).count(),
            "pilot_trials": demo_trials.count(),
            "pilot_observations": PilotObservation.objects.filter(
                trial__in=demo_trials
            ).count(),
            "pilot_approvals": PilotApproval.objects.filter(
                trial__in=demo_trials
            ).count(),
            "pilot_feedback": PilotFeedback.objects.filter(
                trial__in=demo_trials
            ).count(),
        }
        expected_inventory = {
            "users": 17,
            "lines": 20,
            "assets": 3,
            "assignments": 10,
            "shifts": 6,
            "downtime_events": 7,
            "plan_blocks": 30,
            "hourly_outputs": 66,
            "updates": 10,
            "materials": 4,
            "escalations": 6,
            "break_opportunities": 5,
            "legacy_breaks": 2,
            "handovers": 1,
            "quality_incidents": 1,
            "pilot_trials": 4,
            "pilot_observations": 5,
            "pilot_approvals": 16,
            "pilot_feedback": 6,
        }

        checks = [
            (
                "exact showcase inventory",
                exact_inventory == expected_inventory,
                str(exact_inventory),
            ),
            ("personas", users.count() == 17, f"{users.count()} demo accounts"),
            (
                "two lines per Team Leader",
                leader_line_counts == [2, 2, 2],
                f"line distribution {leader_line_counts}",
            ),
            ("six live day shifts", shifts.count() == 6, f"{shifts.count()} shifts"),
            (
                "per-line shift totals",
                shift_totals_match,
                "planned, actual and downtime totals match all six stories",
            ),
            (
                "complete line stories",
                line_stories_match,
                "all six latest RAG and product records are present",
            ),
            (
                "shared showcase snapshot",
                snapshot_is_aligned,
                "all latest line stories are available by 16:10 Europe/London",
            ),
            (
                "complete hourly coverage",
                hourly_coverage_is_complete,
                "11 recorded buckets on every line through the 16:00 bucket",
            ),
            (
                "hourly output reconciles",
                output_totals_match,
                "hourly totals equal each shift actual",
            ),
            (
                "hourly output detail",
                output_details_complete,
                "every hourly record includes recorder metadata and a showcase note",
            ),
            (
                "complete plan rows",
                plan_rows_are_complete,
                "three production blocks and two 40-minute breaks per line",
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
                    BreakOpportunity.Status.CHECKS_COMPLETE,
                    BreakOpportunity.Status.RECOVERED,
                },
                "suggested, checks-complete and recovered examples present",
            ),
            (
                "Line 4 recovery opportunity",
                line_four_recovery_story,
                "Red-line suggested break is backed by the 16:20-17:00 plan block",
            ),
            (
                "10:08 recovery story",
                bool(
                    day_four
                    and day_four.fault_at.astimezone(SITE_TIMEZONE).time()
                    == time(10, 8)
                    and day_four.expected_return_at.astimezone(SITE_TIMEZONE).time()
                    == time(10, 48)
                    and day_four.checks_completed_at.astimezone(SITE_TIMEZONE).time()
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
                "current action portfolio",
                action_portfolio_is_complete,
                "four open actions with critical, high, unassigned and Support evidence",
            ),
            (
                "material showcase details",
                material_details_are_complete,
                "640-pack shortage and protected QA hold are complete",
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
                "handover story details",
                handover_story_is_complete,
                "pending filler handover retains summary, note and linked critical action",
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
            (
                "pilot evidence inventory",
                demo_trials.count() == 4
                and PilotObservation.objects.filter(trial__in=demo_trials).count() == 5
                and PilotApproval.objects.filter(trial__in=demo_trials).count() == 16
                and PilotFeedback.objects.filter(trial__in=demo_trials).count() == 6,
                "4 trials, 5 observations, 16 approvals and 6 feedback notes",
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
