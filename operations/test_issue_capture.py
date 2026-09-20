from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from operations.models import (
    HourlyLineUpdate,
    OperationalEscalation,
    OperationalEvidence,
    ProductionLine,
    Shift,
    TeamLeaderAssignment,
)


@pytest.fixture
def issue_user(db):
    return get_user_model().objects.create_user(
        username="issue.leader",
        password="issue-test-password",
    )


@pytest.fixture
def issue_client(issue_user):
    client = APIClient()
    client.force_authenticate(user=issue_user)
    return client


@pytest.fixture
def issue_assignment(issue_user):
    line = ProductionLine.objects.create(
        code="ISSUE-LINE-02",
        name="Issue Capture Line",
        location="Hall B",
        target_units_per_hour=600,
    )
    return TeamLeaderAssignment.objects.create(
        team_leader=issue_user,
        production_line=line,
        date=timezone.localdate(),
        shift_type=Shift.ShiftType.DAY,
    )


def payload(assignment_id, **overrides):
    data = {
        "assignment": assignment_id,
        "status": HourlyLineUpdate.Status.AMBER,
        "category": OperationalEscalation.Category.EQUIPMENT,
        "current_product": "Oat Milk Chai",
        "short_problem": "Seal concern after former change",
        "immediate_control": "Line slowed; Machine Minder checking",
        "support_required": "engineering",
        "action_owner_role": "engineering",
        "next_update_minutes": 10,
        "escalate": False,
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_issue_capture_records_support_request(
    issue_client,
    issue_assignment,
):
    response = issue_client.post(
        reverse("issue-capture"),
        payload(issue_assignment.id),
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    update = HourlyLineUpdate.objects.get()
    assert update.assignment == issue_assignment
    assert update.status == HourlyLineUpdate.Status.AMBER
    assert update.current_product == "Oat Milk Chai"
    assert update.issue_summary == "Seal concern after former change"
    assert update.action_taken == "Line slowed; Machine Minder checking"
    assert update.action_owner_role == "Engineering"
    assert update.support_required == "Engineering"
    assert update.requires_follow_up is True
    assert OperationalEscalation.objects.count() == 0
    assert response.data["escalation"] is None


@pytest.mark.django_db
def test_red_issue_capture_atomically_creates_linked_escalation(
    issue_client,
    issue_assignment,
):
    response = issue_client.post(
        reverse("issue-capture"),
        payload(
            issue_assignment.id,
            status=HourlyLineUpdate.Status.RED,
            category=OperationalEscalation.Category.QUALITY,
            short_problem="Product hold requires QA control",
            immediate_control="Product isolated and line stopped safely",
            support_required="qa",
            action_owner_role="qa",
            escalate=True,
        ),
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    update = HourlyLineUpdate.objects.get()
    escalation = OperationalEscalation.objects.get()
    assert escalation.hourly_update == update
    assert escalation.assignment == issue_assignment
    assert escalation.priority == OperationalEscalation.Priority.HIGH
    assert escalation.category == OperationalEscalation.Category.QUALITY
    assert escalation.owner is None
    assert escalation.owner_role == "QA"
    assert escalation.immediate_action == "Product isolated and line stopped safely"
    assert response.data["escalation"]["id"] == escalation.id


@pytest.mark.django_db
def test_green_issue_cannot_be_escalated(
    issue_client,
    issue_assignment,
):
    response = issue_client.post(
        reverse("issue-capture"),
        payload(
            issue_assignment.id,
            status=HourlyLineUpdate.Status.GREEN,
            short_problem="Routine check",
            immediate_control="",
            escalate=True,
        ),
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "status" in response.data
    assert HourlyLineUpdate.objects.count() == 0
    assert OperationalEscalation.objects.count() == 0


@pytest.mark.django_db
def test_issue_capture_persists_and_protects_evidence(
    issue_client,
    issue_user,
    issue_assignment,
    settings,
    tmp_path,
):
    settings.MEDIA_ROOT = Path(tmp_path)
    evidence_file = SimpleUploadedFile(
        "seal-photo.png",
        b"fake-png-bytes",
        content_type="image/png",
    )
    request_payload = payload(issue_assignment.id)
    request_payload["evidence"] = evidence_file

    response = issue_client.post(
        reverse("issue-capture"),
        request_payload,
        format="multipart",
    )

    assert response.status_code == status.HTTP_201_CREATED
    evidence = OperationalEvidence.objects.get()
    assert evidence.hourly_update_id == response.data["line_update"]["id"]
    assert evidence.original_name == "seal-photo.png"
    assert evidence.content_type == "image/png"
    assert evidence.size_bytes == len(b"fake-png-bytes")
    assert evidence.uploaded_by == issue_user

    download = issue_client.get(
        reverse("operational-evidence-download", args=(evidence.id,))
    )
    assert download.status_code == status.HTTP_200_OK
    assert "attachment" in download["Content-Disposition"]
    assert "seal-photo.png" in download["Content-Disposition"]


@pytest.mark.django_db
def test_unrelated_team_leader_cannot_read_issue_evidence(
    issue_client,
    issue_assignment,
    settings,
    tmp_path,
):
    settings.MEDIA_ROOT = Path(tmp_path)
    evidence_file = SimpleUploadedFile(
        "seal-photo.png",
        b"fake-png-bytes",
        content_type="image/png",
    )
    request_payload = payload(issue_assignment.id)
    request_payload["evidence"] = evidence_file
    response = issue_client.post(
        reverse("issue-capture"),
        request_payload,
        format="multipart",
    )
    evidence_id = response.data["evidence"]["id"]

    other_user = get_user_model().objects.create_user(
        username="other.issue.leader",
        password="other-password",
    )
    other_client = APIClient()
    other_client.force_authenticate(user=other_user)

    detail = other_client.get(
        reverse("operational-evidence-detail", args=(evidence_id,))
    )
    assert detail.status_code == status.HTTP_404_NOT_FOUND
