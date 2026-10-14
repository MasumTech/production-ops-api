from django.core.management.base import BaseCommand

from operations.models import TeamLeaderAssignment
from operations.operational_editing import assignment_shift, ensure_shift_for_assignment


class Command(BaseCommand):
    help = "Find or repair line plans that do not have a matching shift record."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Create missing shifts. Without this flag the command is a dry run.",
        )
        parser.add_argument(
            "--date",
            help="Only inspect one operational date in YYYY-MM-DD format.",
        )

    def handle(self, *args, **options):
        assignments = TeamLeaderAssignment.objects.select_related(
            "production_line",
            "assigned_by",
        ).order_by("date", "production_line__code", "shift_type")
        if options["date"]:
            assignments = assignments.filter(date=options["date"])

        missing = [
            assignment
            for assignment in assignments
            if assignment_shift(assignment) is None
        ]
        for assignment in missing:
            self.stdout.write(
                f"{assignment.date} {assignment.production_line.code} "
                f"{assignment.shift_type}: missing shift"
            )

        if options["apply"]:
            for assignment in missing:
                ensure_shift_for_assignment(
                    assignment,
                    supervisor=assignment.assigned_by,
                )
            self.stdout.write(
                self.style.SUCCESS(f"Created {len(missing)} missing shift(s).")
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"Dry run: {len(missing)} missing shift(s). Use --apply to repair."
                )
            )
