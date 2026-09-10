from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("operations", "0011_add_pilot_monitoring"),
    ]

    operations = [
        migrations.CreateModel(
            name="PilotTrial",
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
                ("name", models.CharField(max_length=120)),
                ("objective", models.TextField()),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("planned", "Planned"),
                            ("active", "Active"),
                            ("completed", "Completed"),
                            ("stopped", "Stopped"),
                        ],
                        default="planned",
                        max_length=20,
                    ),
                ),
                ("decision_note", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="created_pilot_trials",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decided_pilot_trials",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "started_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="started_pilot_trials",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "selected_lines",
                    models.ManyToManyField(
                        related_name="pilot_trials",
                        to="operations.productionline",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [
                    models.Index(fields=["status", "start_date"], name="operations__status_61610f_idx"),
                    models.Index(fields=["start_date", "end_date"], name="operations__start_d_11c9a9_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="PilotObservation",
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
                ("observed_on", models.DateField()),
                (
                    "shift_type",
                    models.CharField(
                        choices=[("day", "Day"), ("night", "Night")],
                        max_length=10,
                    ),
                ),
                (
                    "line_status",
                    models.CharField(
                        choices=[
                            ("green", "Green"),
                            ("amber", "Amber"),
                            ("red", "Red"),
                        ],
                        max_length=10,
                    ),
                ),
                ("update_duration_seconds", models.PositiveIntegerField(default=0)),
                (
                    "escalation_ack_seconds",
                    models.PositiveIntegerField(blank=True, null=True),
                ),
                ("missed_actions", models.PositiveIntegerField(default=0)),
                ("status_was_accurate", models.BooleanField(default=True)),
                ("used_paper_fallback", models.BooleanField(default=False)),
                ("notes", models.TextField(blank=True)),
                (
                    "observed_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pilot_observations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "production_line",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pilot_observations",
                        to="operations.productionline",
                    ),
                ),
                (
                    "trial",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="observations",
                        to="operations.pilottrial",
                    ),
                ),
            ],
            options={
                "ordering": ("-observed_on", "-created_at"),
                "indexes": [
                    models.Index(fields=["trial", "observed_on"], name="operations__trial_i_02a9ca_idx"),
                    models.Index(fields=["production_line", "observed_on"], name="operations__product_bab9f1_idx"),
                ],
            },
        ),
    ]
