import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from operations.events import publish_due_reminders
from operations.models import OperationalWorkerHeartbeat

WORKER_NAME = "operational-reminders"


def run_reminder_scan():
    started_at = timezone.now()
    heartbeat, _ = OperationalWorkerHeartbeat.objects.update_or_create(
        worker_name=WORKER_NAME,
        defaults={
            "last_started_at": started_at,
            "last_completed_at": None,
            "last_error": "",
            "published_count": 0,
        },
    )
    try:
        published = publish_due_reminders(now=started_at)
    except Exception as exc:
        heartbeat.last_error = type(exc).__name__
        heartbeat.save(update_fields=("last_error", "updated_at"))
        raise

    heartbeat.last_completed_at = timezone.now()
    heartbeat.published_count = published
    heartbeat.save(
        update_fields=(
            "last_completed_at",
            "published_count",
            "updated_at",
        ),
    )
    return published


class Command(BaseCommand):
    help = "Publish deduplicated overdue operational reminder events."

    def add_arguments(self, parser):
        parser.add_argument(
            "--watch",
            action="store_true",
            help="Repeat until stopped, for the Docker reminder worker.",
        )
        parser.add_argument(
            "--interval",
            type=int,
            default=60,
            help="Seconds between scans in watch mode (default: 60).",
        )

    def handle(self, *args, **options):
        if options["interval"] < 10:
            self.stderr.write(self.style.ERROR("Interval must be at least 10 seconds."))
            return

        while True:
            published = run_reminder_scan()
            self.stdout.write(f"Published {published} overdue operational reminders.")
            if not options["watch"]:
                return
            try:
                time.sleep(options["interval"])
            except KeyboardInterrupt:
                return
