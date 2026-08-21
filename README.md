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