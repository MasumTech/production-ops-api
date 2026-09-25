from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0017_issue_capture_evidence"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="HourlyOutput",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("hour_start_at", models.DateTimeField()),
                ("actual_units", models.PositiveIntegerField()),
                ("assignment", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hourly_outputs", to="operations.teamleaderassignment")),
                ("recorded_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="recorded_hourly_outputs", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ("hour_start_at",),
                "constraints": [models.UniqueConstraint(fields=("assignment", "hour_start_at"), name="unique_assignment_output_hour")],
            },
        ),
    ]
