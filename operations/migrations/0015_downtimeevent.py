import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0014_dailyplanblock_breakopportunity_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="DowntimeEvent",
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
                ("started_at", models.DateTimeField()),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                (
                    "reason_category",
                    models.CharField(
                        choices=[
                            ("equipment", "Equipment"),
                            ("material", "Material"),
                            ("quality", "Quality"),
                            ("staffing", "Staffing"),
                            ("changeover", "Changeover"),
                            ("other", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("description", models.CharField(max_length=160)),
                (
                    "owner_group",
                    models.CharField(
                        choices=[
                            ("operations", "Operations"),
                            ("engineering", "Engineering"),
                            ("qa", "QA"),
                            ("machine_minder", "Machine Minder"),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("open", "Open"), ("resolved", "Resolved")],
                        default="open",
                        max_length=20,
                    ),
                ),
                ("resolution_note", models.CharField(blank=True, max_length=255)),
                (
                    "shift",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="downtime_events",
                        to="operations.shift",
                    ),
                ),
            ],
            options={
                "ordering": ("started_at", "id"),
                "indexes": [
                    models.Index(
                        fields=["shift", "started_at"],
                        name="ops_down_shift_started_idx",
                    ),
                    models.Index(
                        fields=["status", "started_at"],
                        name="ops_down_status_started_idx",
                    ),
                ],
            },
        ),
    ]
