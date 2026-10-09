from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0019_userprofile"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="hourlyoutput",
            name="correction_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="hourlyoutput",
            name="last_edited_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="edited_hourly_outputs",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="hourlyoutput",
            name="notes",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="hourlyoutput",
            name="rejected_units",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="hourlyoutput",
            name="rework_units",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
