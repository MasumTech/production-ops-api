import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0010_add_assets_and_loss_evidence"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="OperationalWorkerHeartbeat",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("worker_name", models.CharField(max_length=80, unique=True)),
                ("last_started_at", models.DateTimeField()),
                (
                    "last_completed_at",
                    models.DateTimeField(blank=True, null=True),
                ),
                ("last_error", models.CharField(blank=True, max_length=160)),
                ("published_count", models.PositiveIntegerField(default=0)),
            ],
            options={"ordering": ("worker_name",)},
        ),
        migrations.CreateModel(
            name="OperationalEventReadReceipt",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("read_at", models.DateTimeField(auto_now_add=True)),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="read_receipts",
                        to="operations.operationalevent",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="operational_event_read_receipts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="operationaleventreadreceipt",
            constraint=models.UniqueConstraint(
                fields=("event", "user"),
                name="unique_operational_event_read_receipt",
            ),
        ),
        migrations.AddIndex(
            model_name="operationaleventreadreceipt",
            index=models.Index(
                fields=["user", "read_at"],
                name="operations__user_id_300faf_idx",
            ),
        ),
    ]
