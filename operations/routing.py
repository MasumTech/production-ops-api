from django.urls import path

from .consumers import OperationalEventConsumer

websocket_urlpatterns = [
    path("ws/operations/", OperationalEventConsumer.as_asgi()),
]
