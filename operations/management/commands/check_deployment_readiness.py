from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from config.deployment import deployment_readiness_errors


class Command(BaseCommand):
    help = "Validate the fail-closed settings required for a staging deployment."

    def handle(self, *args, **options):
        errors = deployment_readiness_errors(settings)
        if errors:
            details = "\n".join(f"- {message}" for message in errors)
            raise CommandError(f"Deployment readiness check failed:\n{details}")

        self.stdout.write(
            self.style.SUCCESS("Deployment readiness settings are valid.")
        )
