from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from .models import (
    BreakRecovery,
    HourlyLineUpdate,
    OperationalEscalation,
    OperationalEvent,
    ProductMaterialReadiness,
    QualityIncident,
    Shift,
    ShiftHandover,
    TeamLeaderAssignment,
)

EVENT_MODELS = (
    TeamLeaderAssignment,
    Shift,
    QualityIncident,
    HourlyLineUpdate,
    ProductMaterialReadiness,
    OperationalEscalation,
    ShiftHandover,
    BreakRecovery,
)


def serialize_event(event):
    return {
        "id": event.id,
        "event_type": event.event_type,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "assignment": event.assignment_id,
        "production_line": event.production_line_id,
        "actor": event.actor_id,
        "severity": event.severity,
        "metadata": event.metadata,
        "occurred_at": event.occurred_at.isoformat(),
    }


def event_queryset_for_user(user):
    queryset = OperationalEvent.objects.select_related(
        "assignment",
        "production_line",
        "actor",
    )
    if user.is_staff:
        return queryset
    return queryset.filter(audiences=user).distinct()


def publish_model_event(instance, created):
    descriptor = _event_descriptor(instance, created)
    if descriptor is None:
        return None

    event_type, assignment, production_line, actor, severity, metadata, recipients = (
        descriptor
    )
    return create_operational_event(
        event_type=event_type,
        resource_type=instance._meta.model_name,
        resource_id=instance.pk,
        assignment=assignment,
        production_line=production_line,
        actor=actor,
        severity=severity,
        metadata=metadata,
        recipients=recipients,
    )


def create_operational_event(
    *,
    event_type,
    resource_type,
    resource_id,
    assignment=None,
    production_line=None,
    actor=None,
    severity=OperationalEvent.Severity.INFO,
    metadata=None,
    recipients=(),
    dedupe_key=None,
):
    values = {
        "event_type": event_type,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "assignment": assignment,
        "production_line": production_line,
        "actor": actor,
        "severity": severity,
        "metadata": metadata or {},
    }
    try:
        if dedupe_key:
            event, created = OperationalEvent.objects.get_or_create(
                dedupe_key=dedupe_key,
                defaults=values,
            )
            if not created:
                return event, False
        else:
            event = OperationalEvent.objects.create(**values)
            created = True
    except IntegrityError:
        if dedupe_key:
            return OperationalEvent.objects.get(dedupe_key=dedupe_key), False
        raise

    recipient_ids = {user.id for user in recipients if user and user.is_active}
    if recipient_ids:
        event.audiences.add(*recipient_ids)

    transaction.on_commit(lambda: _broadcast(event.id, recipient_ids))
    return event, created


def _broadcast(event_id, recipient_ids):
    event = OperationalEvent.objects.get(id=event_id)
    message = {
        "type": "operational.event",
        "event": serialize_event(event),
    }
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)("operations.staff", message)
    for user_id in recipient_ids:
        async_to_sync(channel_layer.group_send)(
            f"operations.user.{user_id}",
            message,
        )


def _event_descriptor(instance, created):
    action = "created" if created else "changed"
    assignment = _assignment(instance)
    production_line = _production_line(instance, assignment)
    recipients = _recipients(instance, assignment)
    actor = _actor(instance)
    severity = _severity(instance)
    metadata = _metadata(instance)
    event_name = {
        TeamLeaderAssignment: "assignment",
        Shift: "shift",
        QualityIncident: "quality_incident",
        HourlyLineUpdate: "line_update",
        ProductMaterialReadiness: "material",
        OperationalEscalation: "escalation",
        ShiftHandover: "handover",
        BreakRecovery: "break_recovery",
    }.get(type(instance))
    if event_name is None:
        return None
    return (
        f"{event_name}.{action}",
        assignment,
        production_line,
        actor,
        severity,
        metadata,
        recipients,
    )


def _assignment(instance):
    if isinstance(instance, TeamLeaderAssignment):
        return instance
    if isinstance(instance, ShiftHandover):
        return instance.outgoing_assignment
    if isinstance(instance, Shift):
        return None
    if isinstance(instance, QualityIncident):
        return None
    return getattr(instance, "assignment", None)


def _production_line(instance, assignment):
    if assignment:
        return assignment.production_line
    if isinstance(instance, Shift):
        return instance.production_line
    if isinstance(instance, QualityIncident):
        return instance.shift.production_line
    return None


def _actor(instance):
    for field in (
        "resolved_by",
        "acknowledged_by",
        "accepted_by",
        "recovered_by",
        "started_by",
        "coverage_accepted_by",
        "cancelled_by",
        "recorded_by",
        "created_by",
        "raised_by",
        "handed_over_by",
        "supervisor",
        "team_leader",
    ):
        value = getattr(instance, field, None)
        if value is not None:
            return value
    return None


def _recipients(instance, assignment):
    recipients = set()
    if assignment:
        recipients.add(assignment.team_leader)
    if isinstance(instance, OperationalEscalation) and instance.owner:
        recipients.add(instance.owner)
    if isinstance(instance, ShiftHandover):
        recipients.add(instance.outgoing_assignment.team_leader)
        recipients.add(instance.incoming_assignment.team_leader)
    if isinstance(instance, BreakRecovery):
        recipients.add(instance.cover_user)
    return recipients


def _severity(instance):
    if isinstance(instance, HourlyLineUpdate):
        if instance.status == HourlyLineUpdate.Status.RED:
            return OperationalEvent.Severity.CRITICAL
        if instance.status == HourlyLineUpdate.Status.AMBER:
            return OperationalEvent.Severity.WARNING
    if isinstance(instance, OperationalEscalation):
        if instance.priority == OperationalEscalation.Priority.CRITICAL:
            return OperationalEvent.Severity.CRITICAL
        if instance.priority in {
            OperationalEscalation.Priority.HIGH,
            OperationalEscalation.Priority.MEDIUM,
        }:
            return OperationalEvent.Severity.WARNING
    if isinstance(instance, ProductMaterialReadiness) and instance.status in {
        ProductMaterialReadiness.Status.SHORT,
        ProductMaterialReadiness.Status.HELD,
    }:
        return OperationalEvent.Severity.WARNING
    if isinstance(instance, QualityIncident) and instance.severity in {
        QualityIncident.Severity.HIGH,
        QualityIncident.Severity.CRITICAL,
    }:
        return OperationalEvent.Severity.CRITICAL
    if isinstance(instance, BreakRecovery) and instance.is_overdue:
        return OperationalEvent.Severity.WARNING
    return OperationalEvent.Severity.INFO


def _metadata(instance):
    metadata = {}
    for field in ("status", "priority", "category", "shift_type"):
        value = getattr(instance, field, None)
        if value:
            metadata[field] = value
    return metadata


def publish_due_reminders(now=None):
    now = now or timezone.now()
    published = 0

    escalations = OperationalEscalation.objects.select_related(
        "assignment__production_line",
        "assignment__team_leader",
        "owner",
    ).filter(
        status__in=(
            OperationalEscalation.Status.OPEN,
            OperationalEscalation.Status.ACKNOWLEDGED,
        ),
        response_due_at__lt=now,
    )
    for escalation in escalations:
        _, created = create_operational_event(
            event_type="escalation.overdue",
            resource_type="operationalescalation",
            resource_id=escalation.id,
            assignment=escalation.assignment,
            production_line=escalation.assignment.production_line,
            actor=escalation.owner,
            severity=(
                OperationalEvent.Severity.CRITICAL
                if escalation.priority == OperationalEscalation.Priority.CRITICAL
                else OperationalEvent.Severity.WARNING
            ),
            metadata={"response_due_at": escalation.response_due_at.isoformat()},
            recipients=_recipients(escalation, escalation.assignment),
            dedupe_key=f"escalation-overdue:{escalation.id}:{escalation.response_due_at.isoformat()}",
        )
        published += int(created)

    latest_update_id = (
        HourlyLineUpdate.objects.filter(assignment_id=OuterRef("assignment_id"))
        .order_by("-recorded_at", "-id")
        .values("id")[:1]
    )
    late_updates = HourlyLineUpdate.objects.select_related(
        "assignment__production_line",
        "assignment__team_leader",
        "recorded_by",
    ).filter(
        id=Subquery(latest_update_id),
        next_update_due_at__lt=now,
    )
    for update in late_updates:
        _, created = create_operational_event(
            event_type="line_update.overdue",
            resource_type="hourlylineupdate",
            resource_id=update.id,
            assignment=update.assignment,
            production_line=update.assignment.production_line,
            actor=update.recorded_by,
            severity=OperationalEvent.Severity.WARNING,
            metadata={"next_update_due_at": update.next_update_due_at.isoformat()},
            recipients=(update.assignment.team_leader,),
            dedupe_key=f"line-update-overdue:{update.id}:{update.next_update_due_at.isoformat()}",
        )
        published += int(created)

    late_breaks = BreakRecovery.objects.select_related(
        "assignment__production_line",
        "assignment__team_leader",
        "cover_user",
    ).filter(
        status=BreakRecovery.Status.ACTIVE,
        expected_return_at__lt=now,
    )
    for break_recovery in late_breaks:
        _, created = create_operational_event(
            event_type="break_recovery.overdue",
            resource_type="breakrecovery",
            resource_id=break_recovery.id,
            assignment=break_recovery.assignment,
            production_line=break_recovery.assignment.production_line,
            severity=OperationalEvent.Severity.WARNING,
            metadata={
                "expected_return_at": break_recovery.expected_return_at.isoformat()
            },
            recipients=_recipients(break_recovery, break_recovery.assignment),
            dedupe_key=(
                f"break-overdue:{break_recovery.id}:"
                f"{break_recovery.expected_return_at.isoformat()}"
            ),
        )
        published += int(created)

    return published
