import string
from types import SimpleNamespace

from config.deployment import deployment_readiness_errors

FIXTURE_SECRET_KEY = string.ascii_letters + string.digits
FIXTURE_PASSWORD = string.ascii_letters[:24]


def secure_config(**overrides):
    values = {
        "DEBUG": False,
        "SECRET_KEY": FIXTURE_SECRET_KEY,
        "ALLOWED_HOSTS": ["ops-staging.example.com"],
        "CSRF_TRUSTED_ORIGINS": ["https://ops-staging.example.com"],
        "DATABASES": {
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "PASSWORD": FIXTURE_PASSWORD,
            }
        },
        "REDIS_URL": f"redis://:{FIXTURE_PASSWORD}@redis:6379/0",
        "SECURE_SSL_REDIRECT": True,
        "SESSION_COOKIE_SECURE": True,
        "CSRF_COOKIE_SECURE": True,
        "SECURE_HSTS_SECONDS": 31536000,
        "SECURE_HSTS_INCLUDE_SUBDOMAINS": True,
        "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_secure_deployment_configuration_passes():
    assert deployment_readiness_errors(secure_config()) == []


def test_insecure_deployment_configuration_reports_every_boundary():
    config = secure_config(
        DEBUG=True,
        SECRET_KEY="replace-with-a-secure-secret-key",
        ALLOWED_HOSTS=["*"],
        CSRF_TRUSTED_ORIGINS=["http://ops-staging.example.com"],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3"}},
        REDIS_URL="redis://redis:6379/0",
        SECURE_SSL_REDIRECT=False,
        SESSION_COOKIE_SECURE=False,
        CSRF_COOKIE_SECURE=False,
        SECURE_HSTS_SECONDS=0,
        SECURE_HSTS_INCLUDE_SUBDOMAINS=False,
        SECURE_PROXY_SSL_HEADER=None,
    )

    assert deployment_readiness_errors(config) == [
        "DJANGO_DEBUG must be False.",
        "DJANGO_SECRET_KEY must be long and unpredictable.",
        "DJANGO_ALLOWED_HOSTS must contain explicit hostnames.",
        "DJANGO_CSRF_TRUSTED_ORIGINS must contain explicit HTTPS origins.",
        "DATABASE_URL must use PostgreSQL.",
        "DATABASE_URL must include a non-example password of at least 16 characters.",
        "REDIS_URL must include a non-example password of at least 16 characters.",
        "DJANGO_SECURE_SSL_REDIRECT must be True.",
        "DJANGO_SESSION_COOKIE_SECURE must be True.",
        "DJANGO_CSRF_COOKIE_SECURE must be True.",
        "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS must be True.",
        "DJANGO_SECURE_HSTS_SECONDS must be at least 31536000.",
        "DJANGO_TRUST_X_FORWARDED_PROTO must be True.",
    ]
