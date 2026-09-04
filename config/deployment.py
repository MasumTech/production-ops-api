from urllib.parse import urlparse


def deployment_readiness_errors(config):
    errors = []

    if config.DEBUG:
        errors.append("DJANGO_DEBUG must be False.")

    secret_key = config.SECRET_KEY
    unsafe_markers = ("replace-with", "change-me", "test-only", "ci-only")
    if len(secret_key) < 50 or len(set(secret_key)) < 8:
        errors.append("DJANGO_SECRET_KEY must be long and unpredictable.")
    elif any(marker in secret_key.lower() for marker in unsafe_markers):
        errors.append("DJANGO_SECRET_KEY must not use an example or test value.")

    allowed_hosts = config.ALLOWED_HOSTS
    if not allowed_hosts or "*" in allowed_hosts:
        errors.append("DJANGO_ALLOWED_HOSTS must contain explicit hostnames.")

    origins = config.CSRF_TRUSTED_ORIGINS
    if not origins or any(not origin.startswith("https://") for origin in origins):
        errors.append(
            "DJANGO_CSRF_TRUSTED_ORIGINS must contain explicit HTTPS origins."
        )

    database_engine = config.DATABASES["default"].get("ENGINE", "")
    if database_engine != "django.db.backends.postgresql":
        errors.append("DATABASE_URL must use PostgreSQL.")
    database_password = config.DATABASES["default"].get("PASSWORD", "")
    if len(database_password) < 16 or any(
        marker in database_password.lower() for marker in unsafe_markers
    ):
        errors.append(
            "DATABASE_URL must include a non-example password of at least 16 characters."
        )

    redis_url = config.REDIS_URL
    parsed_redis = urlparse(redis_url)
    if parsed_redis.scheme not in {"redis", "rediss"} or not parsed_redis.hostname:
        errors.append("REDIS_URL must be a valid Redis URL.")
    elif (
        not parsed_redis.password
        or len(parsed_redis.password) < 16
        or any(marker in parsed_redis.password.lower() for marker in unsafe_markers)
    ):
        errors.append(
            "REDIS_URL must include a non-example password of at least 16 characters."
        )

    required_flags = {
        "DJANGO_SECURE_SSL_REDIRECT": config.SECURE_SSL_REDIRECT,
        "DJANGO_SESSION_COOKIE_SECURE": config.SESSION_COOKIE_SECURE,
        "DJANGO_CSRF_COOKIE_SECURE": config.CSRF_COOKIE_SECURE,
        "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS": (
            config.SECURE_HSTS_INCLUDE_SUBDOMAINS
        ),
    }
    for setting_name, enabled in required_flags.items():
        if not enabled:
            errors.append(f"{setting_name} must be True.")

    if config.SECURE_HSTS_SECONDS < 31536000:
        errors.append("DJANGO_SECURE_HSTS_SECONDS must be at least 31536000.")

    expected_proxy_header = ("HTTP_X_FORWARDED_PROTO", "https")
    if config.SECURE_PROXY_SSL_HEADER != expected_proxy_header:
        errors.append("DJANGO_TRUST_X_FORWARDED_PROTO must be True.")

    return errors
