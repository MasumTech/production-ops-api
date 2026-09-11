import os
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from operations.access import OPERATIONAL_SUPPORT_GROUP
from operations.models import (
    BreakOpportunity,
    BreakRecovery,
    DailyPlanBlock,
    HourlyLineUpdate,
    IdempotentRequest,
    OperationalEscalation,
    OperationalEvent,
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


class Command(BaseCommand):
    help = (
        "Create a repeatable local demo dataset covering the Team Leader, "
        "Manager, handover, break, and loss analytics workflows."
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

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo seeding is disabled while DJANGO_DEBUG is false.")

        operational_date = self._parse_date(options["date"])
        password = options["password"] or os.environ.get("DEMO_SEED_PASSWORD")

        if not password or len(password) < 8:
            raise CommandError(
                "Provide --password or DEMO_SEED_PASSWORD (at least 8 characters)."
            )

        with transaction.atomic():
            if options["reset"]:
                self._delete_demo_data()
            else:
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
            f"{summary['plan_blocks']} daily plan blocks, "
            f"{summary['updates']} line updates, "
            f"{summary['materials']} material items, "
            f"{summary['escalations']} escalations, "
            f"{summary['break_opportunities']} break opportunities, "
            f"{summary['breaks']} legacy break records, and "
            f"{summary['handovers']} handover."
        )
        self.stdout.write("")
        self.stdout.write("Local demo accounts:")
        self.stdout.write("  Manager:    demo.manager")
        self.stdout.write("  Team Leader: demo.leader")
        self.stdout.write("  Cover user:  demo.cover")
        self.stdout.write("  Engineer:    demo.engineer")
        self.stdout.write(f"  Password:    {password}")
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
        now = timezone.now()
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
        plan_blocks = self._seed_daily_plan(operational_date, users, assignments)
        updates = self._seed_updates(now, operational_date, users, assignments)
        break_opportunities = self._seed_break_opportunities(
            operational_date,
            users,
            assignments,
            plan_blocks,
            updates,
        )
        materials = self._seed_materials(now, users, assignments)
        escalations = self._seed_escalations(
            now,
            users,
            assets,
            assignments,
            updates,
        )
        self._seed_quality_incident(now, users, shifts)
        breaks = self._seed_breaks(now, users, assignments)
        handovers = self._seed_handover(
            users,
            assignments,
            escalations,
        )

        return {
            "users": len(users),
            "lines": len(lines),
            "assets": len(assets),
            "assignments": len(assignments),
            "shifts": len(shifts),
            "plan_blocks": len(plan_blocks),
            "updates": len(updates),
            "materials": len(materials),
            "escalations": len(escalations),
            "break_opportunities": len(break_opportunities),
            "breaks": len(breaks),
            "handovers": len(handovers),
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
            "cover": {
                "username": "demo.cover",
                "first_name": "Sara",
                "last_name": "Ahmed",
                "is_staff": False,
            },
            "engineer": {
                "username": "demo.engineer",
                "first_name": "Nadia",
                "last_name": "Hossain",
                "is_staff": False,
            },
        }
        users = {}

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
            users[key] = user

        support_group, _ = Group.objects.get_or_create(
            name=OPERATIONAL_SUPPORT_GROUP,
        )
        users["engineer"].groups.add(support_group)

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
                users["leader"],
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
                users["cover"],
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
        definitions = {
            key: (lines[key], planned, actual, downtime)
            for key, planned, actual, downtime in (
                ("line_1", 8400, 4980, 12),
                ("line_2", 6000, 2760, 18),
                ("line_3", 7200, 6350, 5),
                ("line_4", 6400, 3450, 32),
                ("line_5", 7000, 6160, 8),
                ("line_6", 5800, 3538, 42),
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
                    "start_time": time(7, 0),
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
    def _seed_daily_plan(operational_date, users, assignments):
        def planned_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute))
            )

        schedules = {
            "line_1": (
                ("production", 7, 0, 9, 0, "SPC-01", "Salt & Pepper Chicken", 24, None),
                ("break", 9, 0, 9, 40, "", "", None, 1),
                (
                    "production",
                    9,
                    40,
                    12,
                    0,
                    "SSC-02",
                    "Sweet & Sour Chicken",
                    30,
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
                    20,
                    None,
                ),
            ),
            "line_2": (
                ("production", 7, 0, 10, 0, "ODM-01", "Oat Drink 1L", 20, None),
                ("break", 10, 0, 10, 40, "", "", None, 1),
                ("production", 10, 40, 14, 0, "BBQ-02", "BBQ Chicken Bites", 28, None),
                ("break", 14, 0, 14, 40, "", "", None, 2),
                (
                    "production",
                    14,
                    40,
                    18,
                    0,
                    "VMF-03",
                    "Vegetable Mix Filling",
                    24,
                    None,
                ),
            ),
        }
        schedules.update(
            {
                key: (
                    ("production", 7, 0, 11, 0, code, name, target, None),
                    ("break", 11, 0, 11, 40, "", "", None, 1),
                    ("production", 11, 40, 15, 0, code, name, target, None),
                    ("break", 15, 0, 15, 40, "", "", None, 2),
                    ("production", 15, 40, 18, 0, code, name, target, None),
                )
                for key, code, name, target in (
                    ("line_3", "SPC-04", "Salt & Pepper Chicken", 26),
                    ("line_4", "VSR-05", "Vegetable Spring Rolls", 22),
                    ("line_5", "OBT-06", "Oat Milk Chai", 30),
                    ("line_6", "BMF-07", "Baja Milk Foam", 24),
                )
            }
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
    def _seed_updates(now, operational_date, users, assignments):
        def recorded_time(hour, minute=0):
            return timezone.make_aware(
                datetime.combine(operational_date, time(hour, minute))
            )

        definitions = {
            "red": {
                "assignment": assignments["line_1"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Premium Juice 1L",
                "issue_summary": "Filler stopping intermittently",
                "action_taken": "Engineering inspection started",
                "support_required": "Replacement valve inspection",
                "requires_follow_up": True,
                "recorded_at": recorded_time(8, 5),
                "next_update_due_at": recorded_time(9, 5),
            },
            "amber": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.AMBER,
                "current_product": "Sparkling Water 500ml",
                "issue_summary": "Carton stock running low",
                "action_taken": "Warehouse replenishment requested",
                "support_required": "Confirm delivery ETA",
                "requires_follow_up": True,
                "recorded_at": recorded_time(10, 15),
                "next_update_due_at": recorded_time(11, 15),
            },
            "line_2_stop": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "BBQ Chicken Bites",
                "issue_summary": "Case packer stopped before approved break",
                "action_taken": "Line made safe and break opportunity reviewed",
                "support_required": "Engineering checks before restart",
                "requires_follow_up": True,
                "recorded_at": recorded_time(13, 20),
                "next_update_due_at": recorded_time(14, 20),
            },
        }
        updates = {}

        for key, definition in definitions.items():
            update, _ = HourlyLineUpdate.objects.update_or_create(
                assignment=definition["assignment"],
                recorded_by=users["leader"],
                issue_summary=definition["issue_summary"],
                defaults={
                    **definition,
                    "action_owner": users["engineer"],
                },
            )
            updates[key] = update

        return updates

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
                datetime.combine(operational_date, time(hour, minute))
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
        suggested, _ = BreakOpportunity.objects.update_or_create(
            source_update=updates["line_2_stop"],
            defaults={
                "assignment": assignments["line_2"],
                "break_block": plan_blocks["line_2_4"],
                "status": BreakOpportunity.Status.SUGGESTED,
                "fault_at": event_time(13, 20),
                "suggested_start_at": event_time(13, 25),
                "expected_return_at": event_time(14, 5),
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

        return {"recovered": recovered, "suggested": suggested}

    @staticmethod
    def _seed_materials(now, users, assignments):
        definitions = {
            "ready": {
                "assignment": assignments["line_1"],
                "sequence_number": 1,
                "product_code": "PJ-1L",
                "product_name": "Premium Juice 1L",
                "planned_quantity": 5000,
                "status": ProductMaterialReadiness.Status.READY,
                "notes": "All ingredients released.",
            },
            "short": {
                "assignment": assignments["line_2"],
                "sequence_number": 1,
                "product_code": "SW-500",
                "product_name": "Sparkling Water 500ml",
                "planned_quantity": 4200,
                "status": ProductMaterialReadiness.Status.SHORT,
                "shortage_quantity": 640,
                "owner": users["engineer"],
                "expected_available_at": now + timedelta(hours=1),
                "notes": "Carton delivery is in transit.",
            },
            "held": {
                "assignment": assignments["line_3"],
                "sequence_number": 1,
                "product_code": "LB-330",
                "product_name": "Labelled Bottle 330ml",
                "planned_quantity": 3600,
                "status": ProductMaterialReadiness.Status.HELD,
                "hold_reason": "Label artwork confirmation pending.",
                "owner": users["engineer"],
                "notes": "Management release required.",
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
                    "shortage_quantity": definition.get(
                        "shortage_quantity",
                        0,
                    ),
                    "owner": definition.get("owner"),
                    "expected_available_at": definition.get("expected_available_at"),
                    "hold_reason": definition.get("hold_reason", ""),
                    "created_by": users["leader"],
                    "notes": definition["notes"],
                },
            )
            materials[key] = item

        return materials

    @staticmethod
    def _seed_escalations(now, users, assets, assignments, updates):
        definitions = {
            "critical": {
                "assignment": assignments["line_1"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.CRITICAL,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Filler pressure repeatedly dropping",
                "details": "Pressure drops during high-speed production.",
                "immediate_action": "Line isolated and engineering contacted.",
                "owner": users["engineer"],
                "raised_at": now - timedelta(minutes=70),
                "response_due_at": now - timedelta(minutes=10),
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
                "owner": users["engineer"],
                "raised_at": now - timedelta(minutes=20),
                "response_due_at": now + timedelta(minutes=25),
                "loss_minutes": 8,
                "estimated_lost_units": 120,
            },
            "unmapped": {
                "assignment": assignments["line_3"],
                "category": OperationalEscalation.Category.EQUIPMENT,
                "priority": OperationalEscalation.Priority.MEDIUM,
                "status": OperationalEscalation.Status.OPEN,
                "summary": "Label feed alignment issue",
                "details": "Asset mapping is intentionally pending.",
                "immediate_action": "Operator reduced line speed.",
                "owner": users["engineer"],
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
                "owner": users["engineer"],
                "raised_at": now - timedelta(days=4),
                "response_due_at": now - timedelta(days=4) + timedelta(hours=1),
                "acknowledged_at": now - timedelta(days=4) + timedelta(minutes=10),
                "acknowledged_by": users["engineer"],
                "resolution_notes": "Pressure restored.",
                "resolved_at": now - timedelta(days=4) + timedelta(minutes=45),
                "resolved_by": users["engineer"],
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
                "owner": users["engineer"],
                "raised_at": now - timedelta(days=11),
                "response_due_at": now - timedelta(days=11) + timedelta(hours=1),
                "acknowledged_at": now - timedelta(days=11) + timedelta(minutes=8),
                "acknowledged_by": users["engineer"],
                "resolution_notes": "Valve recalibrated and verified.",
                "resolved_at": now - timedelta(days=11) + timedelta(minutes=40),
                "resolved_by": users["engineer"],
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
                "coverage_accepted_by": users["cover"],
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
                    "cover_user": users["cover"],
                    "created_by": users["leader"],
                },
            )
            breaks[key] = item

        return breaks

    @staticmethod
    def _seed_handover(users, assignments, escalations):
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
                "accepted_at": None,
                "accepted_by": None,
            },
        )
        handover.escalations.set((escalations["critical"],))
        return {"pending": handover}
