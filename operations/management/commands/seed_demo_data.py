from datetime import time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from operations.models import (
    BreakRecovery,
    HourlyLineUpdate,
    IdempotentRequest,
    OperationalEscalation,
    OperationalEvent,
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
DEFAULT_PASSWORD = "DemoPass123!"


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
            default=DEFAULT_PASSWORD,
            help="Password assigned to every demo user.",
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
        password = options["password"]

        if len(password) < 8:
            raise CommandError("The demo password must contain at least 8 characters.")

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
            f"{summary['updates']} line updates, "
            f"{summary['materials']} material items, "
            f"{summary['escalations']} escalations, "
            f"{summary['breaks']} break records, and "
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
        ShiftHandover.objects.filter(demo_handover).delete()
        BreakRecovery.objects.filter(demo_assignment).delete()
        OperationalEscalation.objects.filter(demo_assignment).delete()
        ProductMaterialReadiness.objects.filter(demo_assignment).delete()
        HourlyLineUpdate.objects.filter(demo_assignment).delete()
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
        updates = self._seed_updates(now, users, assignments)
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
            "updates": len(updates),
            "materials": len(materials),
            "escalations": len(escalations),
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
            "line_1": (lines["line_1"], 5000, 3200, 47),
            "line_2": (lines["line_2"], 4200, 3650, 18),
            "line_3": (lines["line_3"], 3600, 2100, 31),
        }
        shifts = {}

        for key, (line, planned, actual, downtime) in definitions.items():
            shift, _ = Shift.objects.update_or_create(
                production_line=line,
                date=operational_date,
                shift_type=Shift.ShiftType.DAY,
                defaults={
                    "supervisor": users["manager"],
                    "start_time": time(6, 0),
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
    def _seed_updates(now, users, assignments):
        definitions = {
            "red": {
                "assignment": assignments["line_1"],
                "status": HourlyLineUpdate.Status.RED,
                "current_product": "Premium Juice 1L",
                "issue_summary": "Filler stopping intermittently",
                "action_taken": "Engineering inspection started",
                "support_required": "Replacement valve inspection",
                "requires_follow_up": True,
                "recorded_at": now - timedelta(minutes=80),
                "next_update_due_at": now - timedelta(minutes=20),
            },
            "amber": {
                "assignment": assignments["line_2"],
                "status": HourlyLineUpdate.Status.AMBER,
                "current_product": "Sparkling Water 500ml",
                "issue_summary": "Carton stock running low",
                "action_taken": "Warehouse replenishment requested",
                "support_required": "Confirm delivery ETA",
                "requires_follow_up": True,
                "recorded_at": now - timedelta(minutes=25),
                "next_update_due_at": now + timedelta(minutes=35),
            },
        }
        updates = {}

        for key, definition in definitions.items():
            update, _ = HourlyLineUpdate.objects.update_or_create(
                assignment=definition["assignment"],
                recorded_by=users["leader"],
                defaults={
                    **definition,
                    "action_owner": users["engineer"],
                },
            )
            updates[key] = update

        return updates

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
