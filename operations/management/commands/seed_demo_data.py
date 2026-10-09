import os
from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from operations.access import OPERATIONAL_SUPPORT_GROUP
from operations.events import publish_due_reminders
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
FULL_RESET_CONFIRMATION = "DELETE-ALL-LOCAL-DATA"
SHOWCASE_SNAPSHOT_TIME = time(16, 10)
SITE_TIMEZONE = ZoneInfo("Europe/London")


class Command(BaseCommand):
    help = (
        "Create a repeatable local showcase dataset covering Team Leader, "
        "Manager, Support, notifications, pilot evidence, handover, break, "
        "and loss analytics workflows."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            help="Operational date in YYYY-MM-DD format (default: today).",
        )
        parser.add_argument(
            "--password",
            default=None,
            help="Password assigned to every demo user (or DEMO_SEED_PASSWORD).",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete only DEMO-* records and recreate the dataset.",
        )
        parser.add_argument(
            "--full-reset",
            action="store_true",
            help=(
                "Flush every record from the local development database before "
                "creating the demo dataset. Schema and migrations are preserved."
            ),
        )
        parser.add_argument(
            "--confirm-full-reset",
            default=None,
            help=(f"Required with --full-reset; must be {FULL_RESET_CONFIRMATION}."),
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo seeding is disabled while DJANGO_DEBUG is false.")

        operational_date = self._parse_date(options["date"])
        password = options["password"] or os.environ.get("DEMO_SEED_PASSWORD")

        if not password or len(password) < 8:
            raise CommandError(
                "Provide --password or DEMO_SEED_PASSWORD (at least 8 characters)."
            )

        if options["reset"] and options["full_reset"]:
            raise CommandError("Use either --reset or --full-reset, not both.")

        if options["full_reset"]:
            if options["confirm_full_reset"] != FULL_RESET_CONFIRMATION:
                raise CommandError(
                    "Full reset deletes every local database record. Re-run with "
                    f"--confirm-full-reset {FULL_RESET_CONFIRMATION}."
                )
            self._flush_local_database()

        with transaction.atomic():
            if options["reset"]:
                self._delete_demo_data()
            elif not options["full_reset"]:
                self._delete_demo_events()

            summary = self._seed(operational_date, password)

        self.stdout.write(self.style.SUCCESS("Demo dataset is ready."))
        self.stdout.write(f"Operational date: {operational_date.isoformat()}")
        self.stdout.write(
            "Created/updated: "
            f"{summary['users']} users, "
            f"{summary['lines']} lines, "
            f"{summary['assets']} assets, "
            f"{summary['assignments']} assignments, "
            f"{summary['shifts']} shifts, "
            f"{summary['downtime_events']} downtime events, "
            f"{summary['plan_blocks']} daily plan blocks, "
            f"{summary['hourly_outputs']} hourly outputs, "
            f"{summary['updates']} line updates, "
            f"{summary['evidence']} evidence files, "
            f"{summary['materials']} material items, "
            f"{summary['escalations']} escalations, "
            f"{summary['break_opportunities']} break opportunities, "
            f"{summary['breaks']} legacy break records, and "
            f"{summary['handovers']} handover."
        )
        self.stdout.write(
            "Showcase evidence: "
            f"{summary['quality_incidents']} quality incident, "
            f"{summary['operational_events']} notifications, "
            f"{summary['read_receipts']} read receipts, "
            f"{summary['pilot_trials']} pilot trials, "
            f"{summary['pilot_observations']} pilot observations, "
            f"{summary['pilot_approvals']} pilot approvals, "
            f"{summary['pilot_feedback']} pilot feedback notes, "
            f"{summary['idempotent_requests']} idempotent request, and "
            f"{summary['worker_heartbeats']} healthy reminder worker."
        )
        self.stdout.write("")
        self.stdout.write("Local demo accounts:")
        self.stdout.write("  Operations Manager: demo.manager")
        self.stdout.write("  Team Leader 1:      demo.leader")
        self.stdout.write("  Team Leader 2:      demo.leader.two")
        self.stdout.write("  Team Leader 3:      demo.leader.three")
        self.stdout.write("  Operational Support: demo.support (workflow demo only)")
        self.stdout.write("  Password: use the value supplied by you")
        self.stdout.write("")
        self.stdout.write("Frontend: http://localhost:5173/")
        self.stdout.write("Admin:    http://localhost:8000/admin/")
        self.stdout.write(
            self.style.WARNING(
                "These credentials and records are for local demonstration only."
            )
        )

    @staticmethod
    def _parse_date(value):
        if not value:
            return timezone.localdate()
        try:
            return timezone.datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise CommandError("--date must use YYYY-MM-DD format.") from exc

    @staticmethod
    def _delete_demo_events():
        OperationalEvent.objects.filter(
            Q(production_line__code__startswith=DEMO_PREFIX)
            | Q(assignment__production_line__code__startswith=DEMO_PREFIX)
            | Q(actor__username__startswith=DEMO_USER_PREFIX)
        ).delete()

    @staticmethod
    def _flush_local_database():
        call_command(
            "flush",
            interactive=False,
            verbosity=0,
        )

    def _delete_demo_data(self):
        self._delete_demo_events()
        demo_assignment = Q(assignment__production_line__code__startswith=DEMO_PREFIX)
        demo_handover = Q(
            outgoing_assignment__production_line__code__startswith=DEMO_PREFIX
        ) | Q(incoming_assignment__production_line__code__startswith=DEMO_PREFIX)

        IdempotentRequest.objects.filter(
            user__username__startswith=DEMO_USER_PREFIX
        ).delete()
        # Pilot observations protect their production line, so remove demo
        # evidence before deleting the demo lines themselves.
        PilotObservation.objects.filter(
            production_line__code__startswith=DEMO_PREFIX
        ).delete()
        demo_trials = Q(trial__name__startswith=DEMO_PREFIX)
        PilotApproval.objects.filter(demo_trials).delete()
        PilotFeedback.objects.filter(demo_trials).delete()
        PilotTrial.objects.filter(name__startswith=DEMO_PREFIX).delete()
        ShiftHandover.objects.filter(demo_handover).delete()
        BreakOpportunity.objects.filter(demo_assignment).delete()
        BreakRecovery.objects.filter(demo_assignment).delete()
        OperationalEscalation.objects.filter(demo_assignment).delete()
        ProductMaterialReadiness.objects.filter(demo_assignment).delete()
        HourlyLineUpdate.objects.filter(demo_assignment).delete()
        HourlyOutput.objects.filter(demo_assignment).delete()
        DailyPlanBlock.objects.filter(demo_assignment).delete()
        QualityIncident.objects.filter(
            shift__production_line__code__startswith=DEMO_PREFIX
        ).delete()
        TeamLeaderAssignment.objects.filter(
            production_line__code__startswith=DEMO_PREFIX
        ).delete()
        Shift.objects.filter(production_line__code__startswith=DEMO_PREFIX).delete()
        ProductionAsset.objects.filter(
            production_line__code__startswith=DEMO_PREFIX
        ).delete()
        ProductionLine.objects.filter(code__startswith=DEMO_PREFIX).delete()
        get_user_model().objects.filter(username__startswith=DEMO_USER_PREFIX).delete()

    def _seed(self, operational_date, password):
        # Keep every relative demo timestamp anchored to the requested
        # operational date rather than the machine clock running the seed.
        now = timezone.make_aware(
            datetime.combine(operational_date, time(16, 30)), SITE_TIMEZONE
        )
        users = self._seed_users(password)
        lines = self._seed_lines()
        assets = self._seed_assets(lines)
        assignments = self._seed_assignments(
            operational_date,
            users,
            lines,
        )
        shifts = self._seed_shifts(
            operational_date,
            users,
            lines,
        )
        downtime_events = self._seed_downtime_events(operational_date, shifts)
        plan_blocks = self._seed_daily_plan(operational_date, users, assignments)
        hourly_outputs = self._seed_hourly_output(
            operational_date,
            assignments,
            shifts,
            plan_blocks,
        )
        updates = self._seed_updates(now, operational_date, users, assignments)
        evidence = self._seed_operational_evidence(users, updates)
        break_opportunities = self._seed_break_opportunities(
            operational_date,
            users,
            assignments,
            plan_blocks,
            updates,
        )
        materials = self._seed_materials(operational_date, users, assignments)
        escalations = self._seed_escalations(
            now,
            users,
            assets,
            assignments,
            updates,
        )
        quality_incident = self._seed_quality_incident(now, users, shifts)
        breaks = self._seed_breaks(now, users, assignments)
        handovers = self._seed_handover(
            users,
            assignments,
            escalations,
        )
        pilot = self._seed_pilot_data(operational_date, users, lines)
        idempotent_request = self._seed_idempotent_request(now, users, updates)
        runtime = self._seed_runtime_evidence(now, users)

        return {
            "users": len(users),
            "lines": len(lines),
            "assets": len(assets),
            "assignments": len(assignments),
            "shifts": len(shifts),
            "downtime_events": len(downtime_events),
            "plan_blocks": len(plan_blocks),
            "hourly_outputs": len(hourly_outputs),
            "updates": len(updates),
            "evidence": len(evidence),
            "materials": len(materials),
            "escalations": len(escalations),
            "break_opportunities": len(break_opportunities),
            "breaks": len(breaks),
            "handovers": len(handovers),
            "quality_incidents": int(quality_incident is not None),
            "operational_events": runtime["event_count"],
            "read_receipts": len(runtime["read_receipts"]),
            "pilot_trials": len(pilot["trials"]),
            "pilot_observations": len(pilot["observations"]),
            "pilot_approvals": len(pilot["approvals"]),
            "pilot_feedback": len(pilot["feedback"]),
            "idempotent_requests": int(idempotent_request is not None),
            "worker_heartbeats": int(runtime["heartbeat"] is not None),
        }

    @staticmethod
    def _seed_users(password):
        user_model = get_user_model()
        definitions = {
            "manager": {
                "username": "demo.manager",
                "first_name": "Amina",
                "last_name": "Rahman",
                "is_staff": True,
            },
            "leader": {
                "username": "demo.leader",
                "first_name": "Imran",
                "last_name": "Khan",
                "is_staff": False,
            },
            "leader_2": {
                "username": "demo.leader.two",
                "first_name": "Team",
                "last_name": "Leader Two",
                "is_staff": False,
            },
            "leader_3": {
                "username": "demo.leader.three",
                "first_name": "Team",
                "last_name": "Leader Three",
                "is_staff": False,
            },
            "support": {
                "username": "demo.support",
                "first_name": "Operational",
                "last_name": "Support",
                "is_staff": False,
            },
        }
        users = {}
        support_group, _ = Group.objects.get_or_create(name=OPERATIONAL_SUPPORT_GROUP)

        for key, definition in definitions.items():
            user, _ = user_model.objects.update_or_create(
                username=definition["username"],
                defaults={
                    "first_name": definition["first_name"],
                    "last_name": definition["last_name"],
                    "is_staff": definition["is_staff"],
                    "is_active": True,
                },
            )
            user.set_password(password)
            user.save(update_fields=("password",))
            user.groups.remove(support_group)
            if key == "support":
                user.groups.add(support_group)
            users[key] = user

        return users

    @staticmethod
    def _seed_lines():
        definitions = {
            "line_1": {
                "code": "DEMO-LINE-01",
                "name": "Primary Filling",
                "location": "Hall A",
                "target_units_per_hour": 1200,
            },
            "line_2": {
                "code": "DEMO-LINE-02",
                "name": "Secondary Packing",
                "location": "Hall B",
                "target_units_per_hour": 900,
            },
            "line_3": {
                "code": "DEMO-LINE-03",
                "name": "Labelling and Dispatch",
                "location": "Hall C",
                "target_units_per_hour": 750,
            },
            "line_4": {
                "code": "DEMO-LINE-04",
                "name": "Secondary Filling",
                "location": "Hall D",
                "target_units_per_hour": 800,
            },
            "line_5": {
                "code": "DEMO-LINE-05",
                "name": "Final Packing",
                "location": "Hall E",
                "target_units_per_hour": 700,
            },
            "line_6": {
                "code": "DEMO-LINE-06",
                "name": "Dispatch Preparation",
                "location": "Hall F",
                "target_units_per_hour": 650,
            },
        }
        definitions.update(
            {
                f"line_{number}": {
                    "code": f"DEMO-LINE-{number:02d}",
                    "name": f"Production Line {number}",
                    "location": f"Hall {chr(65 + (number - 1) // 4)}",
                    "target_units_per_hour": 600,
                }
                for number in range(7, 21)
            }
        )
        lines = {}

        for key, definition in definitions.items():
            line, _ = ProductionLine.objects.update_or_create(
                code=definition["code"],
                defaults={
                    "name": definition["name"],
                    "location": definition["location"],
                    "target_units_per_hour": definition["target_units_per_hour"],
                    "status": ProductionLine.Status.ACTIVE,
                },
            )
            lines[key] = line

        return lines

    @staticmethod
    def _seed_assets(lines):
        definitions = {
            "filler": {
                "line": lines["line_1"],
                "code": "FILL-01",
                "name": "Rotary Filler",
                "asset_type": ProductionAsset.AssetType.FILLER,
            },
            "packer": {
                "line": lines["line_2"],
                "code": "PACK-02",
                "name": "Case Packer",
                "asset_type": ProductionAsset.AssetType.PACKER,
            },
            "labeler": {
                "line": lines["line_3"],
                "code": "LAB-03",
                "name": "Automatic Labeler",
                "asset_type": ProductionAsset.AssetType.LABELER,
            },
        }
        assets = {}

        for key, definition in definitions.items():
            asset, _ = ProductionAsset.objects.update_or_create(
                production_line=definition["line"],
                code=definition["code"],
                defaults={
                    "name": definition["name"],
                    "asset_type": definition["asset_type"],
                    "manufacturer": "Demo Machinery Ltd",
                    "status": ProductionAsset.Status.ACTIVE,
                    "notes": "Local demonstration asset.",
                },
            )
            assets[key] = asset

        return assets

    @staticmethod
    def _seed_assignments(operational_date, users, lines):
        definitions = {
            "line_1": (
                lines["line_1"],
                users["leader"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "line_2": (
                lines["line_2"],
                users["leader"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "line_3": (
                lines["line_3"],
                users["leader_2"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "line_4": (
                lines["line_4"],
                users["leader_2"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "line_5": (
                lines["line_5"],
                users["leader_3"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "line_6": (
                lines["line_6"],
                users["leader_3"],
                operational_date,
                Shift.ShiftType.DAY,
            ),
            "incoming": (
                lines["line_1"],
                users["leader_2"],
                operational_date,
                Shift.ShiftType.NIGHT,
            ),
            "incoming_line_2": (
                lines["line_2"],
                users["leader_2"],
                operational_date,
                Shift.ShiftType.NIGHT,
            ),
            "history_1": (
                lines["line_1"],
                users["leader"],
                operational_date - timedelta(days=4),
                Shift.ShiftType.DAY,
            ),
            "history_2": (
                lines["line_1"],
                users["leader"],
                operational_date - timedelta(days=11),
                Shift.ShiftType.DAY,
            ),
        }
        assignments = {}

        for key, (line, leader, date, shift_type) in definitions.items():
            assignment, _ = TeamLeaderAssignment.objects.update_or_create(
                production_line=line,
                date=date,
                shift_type=shift_type,
                defaults={
                    "team_leader": leader,
                    "assigned_by": users["manager"],
                    "notes": "Local demonstration assignment.",
                },
            )
            assignments[key] = assignment

        return assignments

    @staticmethod
    def _seed_shifts(operational_date, users, lines):
        day_start = time(7, 0) if operational_date.weekday() >= 5 else time(6, 45)
        definitions = {
            key: (lines[key], planned, actual, downtime)
            for key, planned, actual, downtime in (
                ("line_1", 8400, 6888, 4),
                ("line_2", 6000, 4020, 8),
                ("line_3", 7200, 6350, 5),
                ("line_4", 6400, 3450, 14),
                ("line_5", 7000, 6160, 3),
                ("line_6", 5800, 3538, 8),
            )
        }
        shifts = {}

        for key, (line, planned, actual, downtime) in definitions.items():
            shift, _ = Shift.objects.update_or_create(
                production_line=line,
                date=operational_date,
                shift_type=Shift.ShiftType.DAY,
                defaults={
                    "supervisor": users["manager"],
                    "start_time": day_start,
                    "end_time": time(18, 0),
                    "planned_output": planned,
                    "actual_output": actual,
                    "downtime_minutes": downtime,
                    "notes": "Local demonstration shift.",
                },
            )
            shifts[key] = shift

        return shifts

    @staticmethod
    def _seed_downtime_events(operational_date, shifts):
        def event_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        definitions = (
            ("line_1", 8, 5, 8, 9, "equipment", "Filler sensor reset", "engineering"),
            ("line_2", 9, 12, 9, 20, "material", "Carton replenishment", "operations"),
            (
                "line_3",
                10,
                18,
                10,
                23,
                "changeover",
                "Label roll change",
                "machine_minder",
            ),
            (
                "line_4",
                8,
                40,
                8,
                49,
                "equipment",
                "Conveyor jam cleared",
                "engineering",
            ),
            (
                "line_4",
                13,
                15,
                13,
                20,
                "equipment",
                "Restart safety checks",
                "engineering",
            ),
            ("line_5", 14, 22, 14, 25, "quality", "QA sample hold", "qa"),
            (
                "line_6",
                15,
                10,
                15,
                18,
                "equipment",
                "Sealer temperature reset",
                "machine_minder",
            ),
        )
        events = []
        for (
            line_key,
            start_hour,
            start_minute,
            end_hour,
            end_minute,
            reason,
            description,
            owner,
        ) in definitions:
            event, _ = DowntimeEvent.objects.update_or_create(
                shift=shifts[line_key],
                started_at=event_time(start_hour, start_minute),
                defaults={
                    "ended_at": event_time(end_hour, end_minute),
                    "reason_category": reason,
                    "description": description,
                    "owner_group": owner,
                    "status": DowntimeEvent.Status.RESOLVED,
                    "resolution_note": "Line returned to planned operation.",
                },
            )
            events.append(event)
        return events

    @staticmethod
    def _seed_daily_plan(operational_date, users, assignments):
        day_start_hour, day_start_minute = (
            (7, 0) if operational_date.weekday() >= 5 else (6, 45)
        )

        def planned_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        schedules = {
            "line_1": (
                (
                    "production",
                    day_start_hour,
                    day_start_minute,
                    9,
                    0,
                    "SPC-01",
                    "Salt & Pepper Chicken",
                    1200,
                    None,
                ),
                ("break", 9, 0, 9, 40, "", "", None, 1),
                (
                    "production",
                    9,
                    40,
                    12,
                    0,
                    "SSC-02",
                    "Sweet & Sour Chicken",
                    1100,
                    None,
                ),
                ("break", 12, 0, 12, 40, "", "", None, 2),
                (
                    "production",
                    12,
                    40,
                    18,
                    0,
                    "VSR-03",
                    "Vegetable Spring Rolls",
                    610,
                    None,
                ),
            ),
            "line_2": (
                (
                    "production",
                    day_start_hour,
                    day_start_minute,
                    10,
                    0,
                    "ODM-01",
                    "Oat Drink 1L",
                    600,
                    None,
                ),
                ("break", 10, 0, 10, 40, "", "", None, 1),
                ("production", 10, 40, 14, 0, "BBQ-02", "BBQ Chicken Bites", 600, None),
                ("break", 14, 0, 14, 40, "", "", None, 2),
                (
                    "production",
                    14,
                    40,
                    18,
                    0,
                    "VMF-03",
                    "Vegetable Mix Filling",
                    615,
                    None,
                ),
            ),
        }
        schedules.update(
            {
                key: (
                    (
                        "production",
                        day_start_hour,
                        day_start_minute,
                        11,
                        0,
                        code,
                        name,
                        target,
                        None,
                    ),
                    ("break", 11, 0, 11, 40, "", "", None, 1),
                    ("production", 11, 40, 15, 0, code, name, target, None),
                    ("break", 15, 0, 15, 40, "", "", None, 2),
                    ("production", 15, 40, 18, 0, code, name, target, None),
                )
                for key, code, name, target in (
                    ("line_3", "SPC-04", "Salt & Pepper Chicken", 726),
                    ("line_4", "VSR-05", "Vegetable Spring Rolls", 645),
                    ("line_5", "OBT-06", "Oat Milk Chai", 706),
                    ("line_6", "BMF-07", "Baja Milk Foam", 585),
                )
            }
        )
        # Line 4 carries the Manager showcase's Red-line recovery decision.
        # Its second protected break is deliberately later so the 16:20-17:00
        # suggested opportunity is backed by a real approved plan block.
        schedules["line_4"] = (
            (
                "production",
                day_start_hour,
                day_start_minute,
                11,
                0,
                "VSR-05",
                "Vegetable Spring Rolls",
                645,
                None,
            ),
            ("break", 11, 0, 11, 40, "", "", None, 1),
            (
                "production",
                11,
                40,
                16,
                20,
                "VSR-05",
                "Vegetable Spring Rolls",
                645,
                None,
            ),
            ("break", 16, 20, 17, 0, "", "", None, 2),
            (
                "production",
                17,
                0,
                18,
                0,
                "VSR-05",
                "Vegetable Spring Rolls",
                645,
                None,
            ),
        )
        plan_blocks = {}

        for line_key, schedule in schedules.items():
            for sequence, definition in enumerate(schedule, start=1):
                (
                    block_type,
                    start_hour,
                    start_minute,
                    end_hour,
                    end_minute,
                    product_code,
                    product_name,
                    hourly_target,
                    break_number,
                ) = definition
                block, _ = DailyPlanBlock.objects.update_or_create(
                    assignment=assignments[line_key],
                    sequence_number=sequence,
                    defaults={
                        "block_type": block_type,
                        "planned_start_at": planned_time(start_hour, start_minute),
                        "planned_end_at": planned_time(end_hour, end_minute),
                        "product_code": product_code,
                        "product_name": product_name,
                        "target_units_per_hour": hourly_target,
                        "break_number": break_number,
                        "created_by": users["manager"],
                    },
                )
                plan_blocks[f"{line_key}_{sequence}"] = block

        return plan_blocks

    @staticmethod
    def _seed_hourly_output(operational_date, assignments, shifts, plan_blocks):
        """Distribute sample shift totals over clock hours to the shared snapshot."""
        outputs = []
        snapshot = timezone.make_aware(
            datetime.combine(operational_date, SHOWCASE_SNAPSHOT_TIME), SITE_TIMEZONE
        )
        for key, assignment in assignments.items():
            if key not in shifts:
                continue
            shift = shifts[key]
            blocks = [
                block
                for block in plan_blocks.values()
                if block.assignment_id == assignment.id
                and block.block_type == DailyPlanBlock.BlockType.PRODUCTION
            ]
            hour = timezone.make_aware(
                datetime.combine(operational_date, shift.start_time.replace(minute=0)),
                SITE_TIMEZONE,
            )
            weighted_hours = []
            while hour < snapshot:
                end = min(hour + timedelta(hours=1), snapshot)
                weight = sum(
                    max(
                        0,
                        (
                            min(
                                end,
                                timezone.make_aware(
                                    datetime.combine(
                                        operational_date,
                                        block.planned_end_at.astimezone(
                                            SITE_TIMEZONE
                                        ).time(),
                                    ),
                                    SITE_TIMEZONE,
                                ),
                            )
                            - max(
                                hour,
                                timezone.make_aware(
                                    datetime.combine(
                                        operational_date,
                                        block.planned_start_at.astimezone(
                                            SITE_TIMEZONE
                                        ).time(),
                                    ),
                                    SITE_TIMEZONE,
                                ),
                            )
                        ).total_seconds(),
                    )
                    * (block.target_units_per_hour or 0)
                    for block in blocks
                )
                weighted_hours.append((hour, weight))
                hour += timedelta(hours=1)
            weight_total = sum(weight for _, weight in weighted_hours)
            remaining = shift.actual_output
            for index, (hour, weight) in enumerate(weighted_hours):
                units = (
                    remaining
                    if index == len(weighted_hours) - 1
                    else round(shift.actual_output * weight / weight_total)
                    if weight_total
                    else 0
                )
                remaining -= units
                output, _ = HourlyOutput.objects.update_or_create(
                    assignment=assignment,
                    hour_start_at=hour,
                    defaults={
                        "actual_units": units,
                        "recorded_by": assignment.team_leader,
                    },
                )
                outputs.append(output)

        return outputs

    @staticmethod
    def _seed_updates(now, operational_date, users, assignments):
        def recorded_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)),
                SITE_TIMEZONE,
            )

        def deadline_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        definitions = {
            "red": {
                "assignment": assignments["line_1"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Salt & Pepper Chicken",
                "issue_summary": "Filler stopping intermittently",
                "action_taken": "Engineering inspection started",
                "support_required": "Replacement valve inspection",
                "requires_follow_up": True,
                "recorded_at": recorded_time(8, 5),
                "next_update_due_at": deadline_time(9, 5),
            },
            "amber": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.AMBER,
                "current_product": "Vegetable Mix Filling",
                "issue_summary": "Carton stock running low",
                "action_taken": "Warehouse replenishment requested",
                "support_required": "Confirm delivery ETA",
                "requires_follow_up": True,
                "recorded_at": recorded_time(16, 10),
                "next_update_due_at": deadline_time(17, 10),
            },
            "line_2_stop": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Oat Drink 1L",
                "issue_summary": "Printer fault",
                "action_taken": "Line stopped safely and product controlled",
                "support_required": "Engineering checks before restart",
                "requires_follow_up": True,
                "recorded_at": recorded_time(10, 8),
                "next_update_due_at": deadline_time(10, 53),
            },
            "line_2_suggestion": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Oat Drink 1L",
                "issue_summary": "Printer fault detected before planned break",
                "action_taken": "Line stopped safely and product controlled",
                "support_required": "Engineering checks before restart",
                "requires_follow_up": True,
                "recorded_at": recorded_time(9, 55),
                "next_update_due_at": deadline_time(10, 35),
            },
            "line_1_current": {
                "assignment": assignments["line_1"],
                "status": HourlyLineUpdate.Status.GREEN,
                "current_product": "Vegetable Spring Rolls",
                "issue_summary": "",
                "action_taken": "Filler reset completed",
                "support_required": "",
                "requires_follow_up": False,
                "recorded_at": recorded_time(16, 0),
                "next_update_due_at": deadline_time(17, 0),
            },
            "line_3_current": {
                "assignment": assignments["line_3"],
                "status": HourlyLineUpdate.Status.GREEN,
                "current_product": "Vegetable Spring Rolls",
                "issue_summary": "",
                "action_taken": "Hourly check completed",
                "support_required": "",
                "requires_follow_up": False,
                "recorded_at": recorded_time(16, 5),
                "next_update_due_at": deadline_time(17, 5),
            },
            "line_3_stop": {
                "assignment": assignments["line_3"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Vegetable Spring Rolls",
                "issue_summary": "Label sensor stopped before protected break",
                "action_taken": "Line stopped safely and sensor reset completed",
                "support_required": "Manager restart approval after checks",
                "requires_follow_up": True,
                "recorded_at": recorded_time(14, 55),
                "next_update_due_at": deadline_time(15, 45),
            },
            "line_4_current": {
                "assignment": assignments["line_4"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Baja Milk Foam",
                "issue_summary": "Conveyor restart remains below target",
                "action_taken": "Engineering fault finding in progress",
                "support_required": "Engineering recovery support",
                "requires_follow_up": True,
                "recorded_at": recorded_time(16, 10),
                "next_update_due_at": deadline_time(16, 45),
            },
            "line_5_current": {
                "assignment": assignments["line_5"],
                "status": HourlyLineUpdate.Status.GREEN,
                "current_product": "BBQ Chicken Bites",
                "issue_summary": "",
                "action_taken": "QA sample released",
                "support_required": "",
                "requires_follow_up": False,
                "recorded_at": recorded_time(16, 10),
                "next_update_due_at": deadline_time(17, 20),
            },
            "line_6_current": {
                "assignment": assignments["line_6"],
                "status": HourlyLineUpdate.Status.AMBER,
                "current_product": "Sweet & Sour Chicken",
                "issue_summary": "Sealer temperature trending high",
                "action_taken": "Machine Minder monitoring every cycle",
                "support_required": "Engineering standby",
                "requires_follow_up": True,
                "recorded_at": recorded_time(16, 10),
                "next_update_due_at": deadline_time(16, 55),
            },
        }
        updates = {}

        for key, definition in definitions.items():
            update, _ = HourlyLineUpdate.objects.update_or_create(
                assignment=definition["assignment"],
                recorded_at=definition["recorded_at"],
                defaults={
                    **definition,
                    "action_owner": users["manager"],
                    "recorded_by": definition["assignment"].team_leader,
                },
            )
            updates[key] = update

        return updates

    @staticmethod
    def _seed_operational_evidence(users, updates):
        path = "operational_evidence/demo/demo-filler-pressure-check.txt"
        payload = (
            "DEMO ONLY\n"
            "Line: DEMO-LINE-01\n"
            "Evidence: filler pressure inspection requested\n"
            "No real employee, customer, traceability, or production data.\n"
        )
        if not default_storage.exists(path):
            default_storage.save(path, ContentFile(payload.encode("utf-8")))

        evidence, _ = OperationalEvidence.objects.update_or_create(
            hourly_update=updates["red"],
            original_name="demo-filler-pressure-check.txt",
            defaults={
                "file": path,
                "content_type": "text/plain",
                "size_bytes": len(payload.encode("utf-8")),
                "uploaded_by": users["leader"],
            },
        )
        return {"filler_check": evidence}

    @staticmethod
    def _seed_break_opportunities(
        operational_date,
        users,
        assignments,
        plan_blocks,
        updates,
    ):
        def event_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        recovered, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["red"],
            defaults={
                "assignment": assignments["line_1"],
                "break_block": plan_blocks["line_1_2"],
                "status": BreakOpportunity.Status.RECOVERED,
                "fault_at": event_time(8, 5),
                "suggested_start_at": event_time(8, 10),
                "confirmed_at": event_time(8, 10),
                "confirmed_by": users["leader"],
                "expected_return_at": event_time(8, 50),
                "returned_at": event_time(8, 50),
                "checks_completed_at": event_time(8, 55),
                "run_resumed_at": event_time(9, 0),
                "recovery_notes": (
                    "Safety, quality and technical checks completed before restart."
                ),
            },
        )
        day_four_recovery, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["line_2_stop"],
            defaults={
                "assignment": assignments["line_2"],
                "break_block": plan_blocks["line_2_2"],
                "status": BreakOpportunity.Status.RECOVERED,
                "fault_at": event_time(10, 8),
                "suggested_start_at": event_time(10, 8),
                "expected_return_at": event_time(10, 48),
                "confirmed_at": event_time(10, 8),
                "confirmed_by": users["leader"],
                "returned_at": event_time(10, 48),
                "checks_completed_at": event_time(10, 53),
                "run_resumed_at": event_time(10, 53),
                "recovery_notes": (
                    "Full 40-minute break protected; restart checks completed "
                    "five minutes after return."
                ),
                "declined_at": None,
                "declined_by": None,
                "decline_reason": "",
            },
        )
        suggested, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["line_2_suggestion"],
            defaults={
                "assignment": assignments["line_2"],
                "break_block": plan_blocks["line_2_2"],
                "status": BreakOpportunity.Status.SUGGESTED,
                "fault_at": event_time(9, 55),
                "suggested_start_at": event_time(10, 0),
                "expected_return_at": event_time(10, 40),
                "confirmed_at": None,
                "confirmed_by": None,
                "returned_at": None,
                "checks_completed_at": None,
                "run_resumed_at": None,
                "recovery_notes": "",
                "declined_at": None,
                "declined_by": None,
                "decline_reason": "",
            },
        )

        line_four_suggested, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["line_4_current"],
            defaults={
                "assignment": assignments["line_4"],
                "break_block": plan_blocks["line_4_4"],
                "status": BreakOpportunity.Status.SUGGESTED,
                "fault_at": event_time(16, 10),
                "suggested_start_at": event_time(16, 20),
                "expected_return_at": event_time(17, 0),
                "confirmed_at": None,
                "confirmed_by": None,
                "returned_at": None,
                "checks_completed_at": None,
                "run_resumed_at": None,
                "recovery_notes": "",
                "declined_at": None,
                "declined_by": None,
                "decline_reason": "",
            },
        )

        checks_complete, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["line_3_stop"],
            defaults={
                "assignment": assignments["line_3"],
                "break_block": plan_blocks["line_3_4"],
                "status": BreakOpportunity.Status.CHECKS_COMPLETE,
                "fault_at": event_time(14, 55),
                "suggested_start_at": event_time(15, 0),
                "expected_return_at": event_time(15, 40),
                "confirmed_at": event_time(15, 0),
                "confirmed_by": users["leader_2"],
                "returned_at": event_time(15, 40),
                "checks_completed_at": event_time(15, 45),
                "run_resumed_at": None,
                "recovery_notes": (
                    "Safety, quality and label sensor checks complete; awaiting "
                    "manager restart evidence."
                ),
                "declined_at": None,
                "declined_by": None,
                "decline_reason": "",
            },
        )

        return {
            "recovered": recovered,
            "day_four_recovery": day_four_recovery,
            "suggested": suggested,
            "line_four_suggested": line_four_suggested,
            "checks_complete": checks_complete,
        }

    @staticmethod
    def _seed_materials(operational_date, users, assignments):
        def material_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        definitions = {
            "ready": {
                "assignment": assignments["line_1"],
                "sequence_number": 1,
                "product_code": "SPC-01",
                "product_name": "Salt & Pepper Chicken",
                "planned_quantity": 8400,
                "status": ProductMaterialReadiness.Status.READY,
                "needed_by_at": material_time(9, 0),
                "risk_summary": "",
                "responsible_role": "Operations",
                "expected_action": "Available",
                "next_action": "Continue normal checks",
                "notes": "Ingredients, packaging and release checks are complete.",
            },
            "in_process": {
                "assignment": assignments["line_1"],
                "sequence_number": 2,
                "product_code": "SSC-02",
                "product_name": "Sweet & Sour Chicken",
                "planned_quantity": 2600,
                "status": ProductMaterialReadiness.Status.IN_PROCESS,
                "owner": users["manager"],
                "expected_available_at": material_time(11, 30),
                "needed_by_at": material_time(12, 0),
                "risk_summary": "120 kg",
                "responsible_role": "Batcher",
                "expected_action": "ETA 11:30",
                "next_action": "Confirm batch release",
                "notes": "Final sauce batch is being prepared for the next run.",
            },
            "short": {
                "assignment": assignments["line_2"],
                "sequence_number": 2,
                "product_code": "OMC-01",
                "product_name": "Oat Milk Chai",
                "planned_quantity": 6000,
                "status": ProductMaterialReadiness.Status.SHORT,
                "shortage_quantity": 640,
                "owner": users["manager"],
                "expected_available_at": material_time(11, 30),
                "needed_by_at": material_time(10, 30),
                "risk_summary": "640 packs",
                "responsible_role": "Materials",
                "expected_action": "Decision due 10:20",
                "next_action": "Confirm replenishment",
                "notes": "Carton stock below next-hour demand.",
            },
            "held": {
                "assignment": assignments["line_2"],
                "sequence_number": 3,
                "product_code": "BBQ-02",
                "product_name": "BBQ Chicken Bites",
                "planned_quantity": 2200,
                "status": ProductMaterialReadiness.Status.HELD,
                "needed_by_at": material_time(14, 0),
                "risk_summary": "QA label release",
                "responsible_role": "QA",
                "expected_action": "Do not use",
                "next_action": "Await authorised release",
                "hold_reason": "QA label verification is pending.",
                "owner": users["manager"],
                "notes": "QA release is required before the planned product change.",
            },
        }
        materials = {}

        for key, definition in definitions.items():
            item, _ = ProductMaterialReadiness.objects.update_or_create(
                assignment=definition["assignment"],
                sequence_number=definition["sequence_number"],
                defaults={
                    "product_code": definition["product_code"],
                    "product_name": definition["product_name"],
                    "planned_quantity": definition["planned_quantity"],
                    "status": definition["status"],
                    "shortage_quantity": definition.get("shortage_quantity", 0),
                    "owner": definition.get("owner"),
                    "expected_available_at": definition.get("expected_available_at"),
                    "needed_by_at": definition.get("needed_by_at"),
                    "risk_summary": definition.get("risk_summary", ""),
                    "responsible_role": definition.get("responsible_role", ""),
                    "expected_action": definition.get("expected_action", ""),
                    "next_action": definition.get("next_action", ""),
                    "hold_reason": definition.get("hold_reason", ""),
                    "created_by": definition["assignment"].team_leader,
                    "notes": definition["notes"],
                },
            )
            materials[key] = item

        return materials

    @staticmethod
    def _seed_escalations(now, users, assets, assignments, updates):
        operational_date = assignments["line_1"].date

        def event_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute)), SITE_TIMEZONE
            )

        definitions = {
            "critical": {
                "assignment": assignments["line_1"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.CRITICAL,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Filler pressure repeatedly dropping",
                "details": "Pressure drops during high-speed production.",
                "immediate_action": "Line isolated and engineering contacted.",
                "owner": users["support"],
                "raised_at": event_time(15, 10),
                "response_due_at": event_time(17, 10),
                "hourly_update": updates["red"],
                "asset": assets["filler"],
                "loss_minutes": 47,
                "estimated_lost_units": 940,
            },
            "material": {
                "assignment": assignments["line_2"],
                "category": OperationalEscalation.Category.MATERIAL,
                "priority": OperationalEscalation.Priority.HIGH,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Carton stock below next-hour demand",
                "details": "640 cartons are needed to protect the plan.",
                "immediate_action": "Warehouse replenishment requested.",
                "owner": users["manager"],
                "raised_at": event_time(16, 0),
                "response_due_at": event_time(18, 10),
                "loss_minutes": 8,
                "estimated_lost_units": 120,
            },
            "printer": {
                "assignment": assignments["line_2"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.MEDIUM,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Printer restart checks required",
                "details": "Temporary repair completed; first production runs need monitoring.",
                "immediate_action": "Temporary repair; checks passed",
                "owner": users["manager"],
                "raised_at": event_time(14, 35),
                "response_due_at": event_time(18, 0),
                "hourly_update": updates["line_2_stop"],
                "asset": assets["packer"],
                "loss_minutes": 35,
                "estimated_lost_units": 420,
            },
            "unmapped": {
                "assignment": assignments["line_3"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.MEDIUM,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Label feed alignment issue",
                "details": "Asset mapping is intentionally pending.",
                "immediate_action": "Operator reduced line speed.",
                "owner": None,
                "raised_at": now - timedelta(minutes=15),
                "response_due_at": now + timedelta(minutes=45),
                "loss_minutes": 12,
                "estimated_lost_units": 180,
            },
            "history_1": {
                "assignment": assignments["history_1"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.MEDIUM,
                "status": OperationalEscalation.Status.RESOLVED,
                "summary": "Historical filler pressure loss - 1",
                "details": "Repeated-loss evidence for demonstration.",
                "immediate_action": "Valve inspected.",
                "owner": users["manager"],
                "raised_at": now - timedelta(days=4),
                "response_due_at": now - timedelta(days=4) + timedelta(hours=1),
                "acknowledged_at": now - timedelta(days=4) + timedelta(minutes=10),
                "acknowledged_by": users["manager"],
                "resolution_notes": "Pressure restored.",
                "resolved_at": now - timedelta(days=4) + timedelta(minutes=45),
                "resolved_by": users["manager"],
                "asset": assets["filler"],
                "loss_minutes": 32,
                "estimated_lost_units": 610,
            },
            "history_2": {
                "assignment": assignments["history_2"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.MEDIUM,
                "status": OperationalEscalation.Status.RESOLVED,
                "summary": "Historical filler pressure loss - 2",
                "details": "Repeated-loss evidence for demonstration.",
                "immediate_action": "Valve recalibrated.",
                "owner": users["manager"],
                "raised_at": now - timedelta(days=11),
                "response_due_at": now - timedelta(days=11) + timedelta(hours=1),
                "acknowledged_at": now - timedelta(days=11) + timedelta(minutes=8),
                "acknowledged_by": users["manager"],
                "resolution_notes": "Valve recalibrated and verified.",
                "resolved_at": now - timedelta(days=11) + timedelta(minutes=40),
                "resolved_by": users["manager"],
                "asset": assets["filler"],
                "loss_minutes": 24,
                "estimated_lost_units": 450,
            },
        }
        escalations = {}

        for key, definition in definitions.items():
            escalation, _ = OperationalEscalation.objects.update_or_create(
                assignment=definition["assignment"],
                summary=definition["summary"],
                defaults={
                    **definition,
                    "raised_by": users["leader"],
                },
            )
            escalations[key] = escalation

        return escalations

    @staticmethod
    def _seed_quality_incident(now, users, shifts):
        incident, _ = QualityIncident.objects.update_or_create(
            shift=shifts["line_3"],
            title="Label verification hold",
            defaults={
                "category": QualityIncident.Category.PACKAGING,
                "severity": QualityIncident.Severity.HIGH,
                "status": QualityIncident.Status.INVESTIGATING,
                "description": "Label artwork verification is pending.",
                "immediate_action": "Product isolated pending approval.",
                "occurred_at": now - timedelta(minutes=35),
                "reported_by": users["leader"],
            },
        )
        return incident

    @staticmethod
    def _seed_breaks(now, users, assignments):
        definitions = {
            "active": {
                "assignment": assignments["line_1"],
                "status": BreakRecovery.Status.ACTIVE,
                "planned_start_at": now - timedelta(minutes=30),
                "expected_return_at": now - timedelta(minutes=5),
                "coverage_notes": "Monitor filler pressure and alarms.",
                "coverage_accepted_at": now - timedelta(minutes=35),
                "coverage_accepted_by": users["leader_2"],
                "started_at": now - timedelta(minutes=30),
                "started_by": users["leader"],
            },
            "planned": {
                "assignment": assignments["line_2"],
                "status": BreakRecovery.Status.PLANNED,
                "planned_start_at": now + timedelta(minutes=40),
                "expected_return_at": now + timedelta(minutes=70),
                "coverage_notes": "Track incoming carton delivery.",
            },
        }
        breaks = {}

        for key, definition in definitions.items():
            item, _ = BreakRecovery.objects.update_or_create(
                assignment=definition["assignment"],
                defaults={
                    **definition,
                    "cover_user": users["leader_2"],
                    "created_by": users["leader"],
                },
            )
            breaks[key] = item

        return breaks

    @staticmethod
    def _seed_handover(users, assignments, escalations):
        operational_date = assignments["line_1"].date
        handed_over_at = timezone.make_aware(
            datetime.combine(operational_date, time(16, 25)), SITE_TIMEZONE
        )
        handover, _ = ShiftHandover.objects.update_or_create(
            outgoing_assignment=assignments["line_1"],
            incoming_assignment=assignments["incoming"],
            defaults={
                "status": ShiftHandover.Status.PENDING,
                "operational_summary": (
                    "Filler pressure issue remains under engineering control."
                ),
                "notes": "Confirm stable pressure before increasing speed.",
                "handed_over_by": users["leader"],
                "handed_over_at": handed_over_at,
                "accepted_at": None,
                "accepted_by": None,
            },
        )
        handover.escalations.set((escalations["critical"],))
        return {"pending": handover}

    @staticmethod
    def _seed_pilot_data(operational_date, users, lines):
        def audit_time(days, hour=12, minute=0):
            return timezone.make_aware(
                datetime.combine(
                    operational_date + timedelta(days=days),
                    time(hour, minute),
                ),
                SITE_TIMEZONE,
            )

        definitions = {
            "stopped": {
                "name": "DEMO-01 Safeguards learning trial",
                "objective": (
                    "Demonstrate a controlled stop when paper fallback and missed "
                    "actions exceed the agreed pilot tolerance."
                ),
                "start_date": operational_date - timedelta(days=60),
                "end_date": operational_date - timedelta(days=46),
                "status": PilotTrial.Status.STOPPED,
                "started_at": audit_time(-60, 7),
                "started_by": users["manager"],
                "decided_at": audit_time(-52, 15),
                "decided_by": users["manager"],
                "decision_note": (
                    "Stopped safely after the paper-fallback threshold was reached."
                ),
                "selected_lines": (lines["line_1"],),
            },
            "completed": {
                "name": "DEMO-02 Completed workflow pilot",
                "objective": (
                    "Show a completed pilot decision with retained approval and "
                    "human feedback evidence."
                ),
                "start_date": operational_date - timedelta(days=35),
                "end_date": operational_date - timedelta(days=15),
                "status": PilotTrial.Status.COMPLETED,
                "started_at": audit_time(-35, 7),
                "started_by": users["manager"],
                "decided_at": audit_time(-14, 15),
                "decided_by": users["manager"],
                "decision_note": (
                    "Completed with the hourly control and escalation workflow accepted."
                ),
                "selected_lines": (lines["line_1"], lines["line_2"]),
            },
            "planned": {
                "name": "DEMO-03 Planned readiness review",
                "objective": (
                    "Demonstrate a planned trial that is blocked until requested "
                    "Quality/Safety changes and pending reviews are completed."
                ),
                "start_date": operational_date + timedelta(days=7),
                "end_date": operational_date + timedelta(days=34),
                "status": PilotTrial.Status.PLANNED,
                "started_at": None,
                "started_by": None,
                "decided_at": None,
                "decided_by": None,
                "decision_note": "",
                "selected_lines": (lines["line_5"], lines["line_6"]),
            },
            "active": {
                "name": "DEMO-04 Active multi-line pilot",
                "objective": (
                    "Measure update speed, escalation acknowledgement, status "
                    "accuracy, missed actions, and paper fallback using dummy data."
                ),
                "start_date": operational_date - timedelta(days=7),
                "end_date": operational_date + timedelta(days=20),
                "status": PilotTrial.Status.ACTIVE,
                "started_at": audit_time(-7, 6, 45),
                "started_by": users["manager"],
                "decided_at": None,
                "decided_by": None,
                "decision_note": "",
                "selected_lines": (
                    lines["line_1"],
                    lines["line_2"],
                    lines["line_3"],
                ),
            },
        }
        trials = {}
        for key, definition in definitions.items():
            selected_lines = definition["selected_lines"]
            trial, _ = PilotTrial.objects.update_or_create(
                name=definition["name"],
                defaults={
                    field: value
                    for field, value in definition.items()
                    if field not in {"name", "selected_lines"}
                }
                | {"created_by": users["manager"]},
            )
            trial.selected_lines.set(selected_lines)
            trials[key] = trial

        approvals = []
        reviewer_roles = [value for value, _ in PilotApproval.ReviewerRole.choices]
        for trial_key, trial in trials.items():
            for role in reviewer_roles:
                decision = PilotApproval.Decision.APPROVED
                note = "Approved for the controlled dummy-data pilot."
                if trial_key == "planned":
                    if role == PilotApproval.ReviewerRole.QUALITY_SAFETY:
                        decision = PilotApproval.Decision.CHANGES_REQUESTED
                        note = "Add the agreed restart-check evidence before launch."
                    elif role in {
                        PilotApproval.ReviewerRole.ENGINEERING_IT,
                        PilotApproval.ReviewerRole.PRODUCT_OWNER,
                    }:
                        decision = PilotApproval.Decision.PENDING
                        note = ""
                approval, _ = PilotApproval.objects.update_or_create(
                    trial=trial,
                    reviewer_role=role,
                    defaults={
                        "decision": decision,
                        "note": note,
                        "decided_by": (
                            None
                            if decision == PilotApproval.Decision.PENDING
                            else users["manager"]
                        ),
                        "decided_at": (
                            None
                            if decision == PilotApproval.Decision.PENDING
                            else audit_time(-8, 14)
                        ),
                    },
                )
                approvals.append(approval)

        observation_definitions = (
            ("line_1", -5, PilotObservation.LineStatus.GREEN, 44, 180, 0, True, False),
            ("line_2", -4, PilotObservation.LineStatus.AMBER, 61, 245, 0, True, False),
            ("line_3", -3, PilotObservation.LineStatus.RED, 73, 310, 1, True, False),
            ("line_1", -2, PilotObservation.LineStatus.GREEN, 39, 155, 0, True, False),
            ("line_2", 0, PilotObservation.LineStatus.AMBER, 52, 205, 0, False, True),
        )
        observations = []
        for (
            line_key,
            day_offset,
            line_status,
            update_seconds,
            acknowledgement_seconds,
            missed_actions,
            accurate,
            paper_fallback,
        ) in observation_definitions:
            observation, _ = PilotObservation.objects.update_or_create(
                trial=trials["active"],
                production_line=lines[line_key],
                observed_on=operational_date + timedelta(days=day_offset),
                shift_type=Shift.ShiftType.DAY,
                defaults={
                    "line_status": line_status,
                    "update_duration_seconds": update_seconds,
                    "escalation_ack_seconds": acknowledgement_seconds,
                    "missed_actions": missed_actions,
                    "status_was_accurate": accurate,
                    "used_paper_fallback": paper_fallback,
                    "notes": (
                        "Dummy observation retained for pilot evidence and trend review."
                    ),
                    "observed_by": users["manager"],
                },
            )
            observations.append(observation)

        feedback_definitions = (
            (
                trials["active"],
                PilotApproval.ReviewerRole.OPERATIONS,
                PilotFeedback.Category.USABILITY,
                PilotFeedback.Sentiment.POSITIVE,
                "Two-line desktop control is clear and quick to scan.",
            ),
            (
                trials["active"],
                PilotApproval.ReviewerRole.ENGINEERING_IT,
                PilotFeedback.Category.TECHNICAL,
                PilotFeedback.Sentiment.NEUTRAL,
                "Notification delivery is stable; continue worker freshness checks.",
            ),
            (
                trials["active"],
                PilotApproval.ReviewerRole.QUALITY_SAFETY,
                PilotFeedback.Category.SAFETY_QUALITY,
                PilotFeedback.Sentiment.CONCERN,
                "One paper fallback needs a reviewed follow-up before wider use.",
            ),
            (
                trials["active"],
                PilotApproval.ReviewerRole.PRODUCT_OWNER,
                PilotFeedback.Category.WORKFLOW,
                PilotFeedback.Sentiment.POSITIVE,
                "Hourly target, done, short and downtime evidence support decisions.",
            ),
            (
                trials["completed"],
                PilotApproval.ReviewerRole.OPERATIONS,
                PilotFeedback.Category.WORKFLOW,
                PilotFeedback.Sentiment.POSITIVE,
                "Completed trial confirmed clear handover ownership.",
            ),
            (
                trials["stopped"],
                PilotApproval.ReviewerRole.QUALITY_SAFETY,
                PilotFeedback.Category.SAFETY_QUALITY,
                PilotFeedback.Sentiment.CONCERN,
                "The stop decision correctly protected the agreed trial boundary.",
            ),
        )
        feedback = []
        for trial, reviewer_role, category, sentiment, notes in feedback_definitions:
            item, _ = PilotFeedback.objects.update_or_create(
                trial=trial,
                reviewer_role=reviewer_role,
                category=category,
                defaults={
                    "sentiment": sentiment,
                    "notes": notes,
                    "created_by": users["manager"],
                },
            )
            feedback.append(item)

        return {
            "trials": trials,
            "observations": observations,
            "approvals": approvals,
            "feedback": feedback,
        }

    @staticmethod
    def _seed_idempotent_request(now, users, updates):
        request, _ = IdempotentRequest.objects.update_or_create(
            user=users["leader"],
            key=UUID("00000000-0000-4000-8000-000000000001"),
            defaults={
                "method": "POST",
                "path": "/api/hourly-line-updates/capture-issue/",
                "request_hash": "0" * 64,
                "response_status": 201,
                "response_body": {
                    "demo": True,
                    "line_update_id": updates["red"].id,
                    "message": "Recovered once after an offline retry.",
                },
                "completed_at": now,
            },
        )
        return request

    @staticmethod
    def _seed_runtime_evidence(now, users):
        published = publish_due_reminders(now=now + timedelta(days=1))
        heartbeat_time = timezone.now()
        heartbeat, _ = OperationalWorkerHeartbeat.objects.update_or_create(
            worker_name="operational-reminders",
            defaults={
                "last_started_at": heartbeat_time - timedelta(seconds=1),
                "last_completed_at": heartbeat_time,
                "last_error": "",
                "published_count": published,
            },
        )

        demo_events = OperationalEvent.objects.filter(
            Q(production_line__code__startswith=DEMO_PREFIX)
            | Q(assignment__production_line__code__startswith=DEMO_PREFIX)
            | Q(actor__username__startswith=DEMO_USER_PREFIX)
        )
        read_receipts = []
        manager_event = (
            demo_events.filter(
                severity=OperationalEvent.Severity.CRITICAL,
            )
            .order_by("id")
            .first()
        )
        if manager_event:
            receipt, _ = OperationalEventReadReceipt.objects.get_or_create(
                event=manager_event,
                user=users["manager"],
            )
            read_receipts.append(receipt)

        leader_event = (
            demo_events.filter(
                audiences=users["leader"],
            )
            .order_by("id")
            .first()
        )
        if leader_event:
            receipt, _ = OperationalEventReadReceipt.objects.get_or_create(
                event=leader_event,
                user=users["leader"],
            )
            read_receipts.append(receipt)

        return {
            "heartbeat": heartbeat,
            "event_count": demo_events.count(),
            "read_receipts": read_receipts,
        }
