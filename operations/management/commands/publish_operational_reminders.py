import time

from django.core.management.base import BaseCommand

from operations.events import publish_due_reminders


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
            published = publish_due_reminders()
            self.stdout.write(f"Published {published} overdue operational reminders.")
            if not options["watch"]:
                return
            try:
                time.sleep(options["interval"])
            except KeyboardInterrupt:
                return
