from django.db.models.signals import post_save
from django.dispatch import receiver

from .events import EVENT_MODELS, publish_model_event


@receiver(post_save)
def publish_operational_change(sender, instance, created, raw, **kwargs):
    if raw or sender not in EVENT_MODELS:
        return
    publish_model_event(instance, created)
