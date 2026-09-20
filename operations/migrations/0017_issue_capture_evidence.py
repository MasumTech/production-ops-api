from django.conf import settings
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0016_material_readiness_action_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="hourlylineupdate",
            name="action_owner_role",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="operationalescalation",
            name="owner_role",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.CreateModel(
            name="OperationalEvidence",
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
                (
                    "file",
                    models.FileField(upload_to="operational_evidence/%Y/%m/%d"),
                ),
                ("original_name", models.CharField(max_length=255)),
                ("content_type", models.CharField(max_length=120)),
                ("size_bytes", models.PositiveIntegerField()),
                (
                    "hourly_update",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="evidence",
                        to="operations.hourlylineupdate",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="uploaded_operational_evidence",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("-created_at",)},
        ),
    ]
