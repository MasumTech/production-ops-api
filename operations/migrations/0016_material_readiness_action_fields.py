from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0015_downtimeevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="productmaterialreadiness",
            name="needed_by_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="productmaterialreadiness",
            name="risk_summary",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="productmaterialreadiness",
            name="responsible_role",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="productmaterialreadiness",
            name="expected_action",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="productmaterialreadiness",
            name="next_action",
            field=models.CharField(blank=True, max_length=160),
        ),
    ]
