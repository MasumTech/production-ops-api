# Production Operations API

[![CI](https://github.com/MasumTech/production-ops-api/actions/workflows/ci.yml/badge.svg)](https://github.com/MasumTech/production-ops-api/actions/workflows/ci.yml)

A production-focused REST API for managing manufacturing lines, shifts, production performance, downtime, and quality incidents.

The project demonstrates a structured Django backend using JWT authentication, PostgreSQL, Docker, automated testing, and continuous integration.

## Features

- Manage production lines and their operational status
- Record day and night shifts
- Track planned and actual production output
- Calculate shift performance percentage automatically
- Record downtime for each shift
- Report and manage quality incidents
- Track root causes and corrective actions
- Filter, search, and order API results
- JWT-based authentication and token refresh
- Interactive Swagger API documentation
- PostgreSQL database with Docker Compose
- Non-root Gunicorn application container
- Automated linting, tests, system checks, and Docker builds in CI

## Technology Stack

| Area | Technology |
|---|---|
| Language | Python 3.12 |
| Framework | Django 5.2 |
| API | Django REST Framework |
| Authentication | Simple JWT |
| Database | PostgreSQL 16 |
| API documentation | drf-spectacular / Swagger UI |
| Application server | Gunicorn |
| Containers | Docker and Docker Compose |
| Testing | pytest and pytest-django |
| Code quality | Ruff |
| Continuous integration | GitHub Actions |

## Core Models

### ProductionLine

Stores production line details, including:

- Unique line code
- Name and location
- Target units per hour
- Operational status

### Shift

Records production activity for a particular line and date, including:

- Day or night shift
- Supervisor
- Planned and actual output
- Downtime
- Automatically calculated performance percentage

A production line cannot have duplicate shifts with the same date and shift type.

### QualityIncident

Tracks production quality issues, including:

- Category and severity
- Incident status
- Description and immediate action
- Root cause and corrective action
- Occurrence and resolution time
- User who reported the incident

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/token/` | Obtain JWT access and refresh tokens |
| `POST` | `/api/auth/token/refresh/` | Refresh an access token |
| `GET` | `/api/schema/` | Download the OpenAPI schema |
| `GET` | `/api/docs/` | Open Swagger API documentation |
| `GET, POST` | `/api/production-lines/` | List or create production lines |
| `GET, PUT, PATCH, DELETE` | `/api/production-lines/{id}/` | Manage one production line |
| `GET, POST` | `/api/shifts/` | List or create shifts |
| `GET, PUT, PATCH, DELETE` | `/api/shifts/{id}/` | Manage one shift |
| `GET, POST` | `/api/quality-incidents/` | List or create quality incidents |
| `GET, PUT, PATCH, DELETE` | `/api/quality-incidents/{id}/` | Manage one quality incident |

All operations endpoints require a JWT access token:

```http
Authorization: Bearer <access-token>
```

## Search, Filtering, and Ordering

Examples:

```text
/api/production-lines/?status=active
/api/production-lines/?search=packing
/api/shifts/?production_line=1
/api/shifts/?shift_type=day
/api/shifts/?date=2026-08-21
/api/quality-incidents/?severity=high
/api/quality-incidents/?status=open
/api/quality-incidents/?category=packaging
/api/shifts/?ordering=-actual_output
```

## Quick Start with Docker

### Prerequisites

- Docker Desktop
- Docker Compose
- Git

### 1. Clone the repository

```bash
git clone git@github.com:MasumTech/production-ops-api.git
cd production-ops-api
```

### 2. Create the Docker environment file

```bash
cp .env.docker.example .env.docker
```

Update the placeholder secrets inside `.env.docker` before using the application outside local development.

### 3. Start the application

```bash
docker compose up --build -d
```

### 4. Apply database migrations

```bash
docker compose exec web python manage.py migrate
```

### 5. Create an administrator

```bash
docker compose exec web python manage.py createsuperuser
```

The application will be available at:

| Service | URL |
|---|---|
| Swagger documentation | http://localhost:8000/api/docs/ |
| Django admin | http://localhost:8000/admin/ |
| OpenAPI schema | http://localhost:8000/api/schema/ |

Check the running containers:

```bash
docker compose ps
```

View application logs:

```bash
docker compose logs --tail=50 web
```

Stop the containers:

```bash
docker compose down
```

The PostgreSQL data remains stored in the named Docker volume after the containers stop.

## Local Development

### 1. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 3. Create the local environment file

```bash
cp .env.example .env
```

The default local configuration uses SQLite, so PostgreSQL is not required for this setup.

### 4. Apply migrations and start Django

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## Authentication Example

Request JWT tokens:

```bash
curl -X POST http://localhost:8000/api/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"your-username","password":"your-password"}'
```

Use the returned access token:

```bash
curl http://localhost:8000/api/production-lines/ \
  -H "Authorization: Bearer <access-token>"
```

## Testing and Code Quality

Run the complete test suite:

```bash
python -m pytest
```

Check Django configuration:

```bash
python manage.py check
```

Check code formatting:

```bash
python -m ruff format --check .
```

Run lint checks:

```bash
python -m ruff check .
```

Check whitespace errors:

```bash
git diff --check
```

## Continuous Integration

GitHub Actions automatically runs the following checks for changes targeting `main`:

1. Dependency installation
2. Ruff formatting check
3. Ruff lint check
4. Django system check
5. pytest test suite
6. Docker Compose configuration validation
7. Docker image build

## Project Structure

```text
production-ops-api/
├── .github/workflows/   # GitHub Actions configuration
├── config/              # Django settings and root URLs
├── operations/          # Models, serializers, views, URLs, and tests
├── Dockerfile           # Django application image
├── compose.yml          # Web and PostgreSQL services
├── manage.py            # Django management command
├── pytest.ini           # pytest configuration
├── requirements.txt     # Python dependencies
└── ruff.toml            # Ruff configuration
```

## Author

**Md Masum Reza**

- GitHub: [MasumTech](https://github.com/MasumTech)