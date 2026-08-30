from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsStaffOrReadOnly(BasePermission):
    message = "Only management staff can change line assignments."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return request.method in SAFE_METHODS or request.user.is_staff


class IsAssignedTeamLeaderOrStaff(BasePermission):
    message = "You can only access records for your assigned lines."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True

        return obj.assignment.team_leader_id == request.user.id


class IsEscalationParticipantOrStaff(BasePermission):
    message = "You can only access escalations for your lines or assigned actions."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True

        return (
            obj.assignment.team_leader_id == request.user.id
            or obj.owner_id == request.user.id
            or obj.shift_handovers.filter(
                incoming_assignment__team_leader_id=request.user.id,
            ).exists()
        )


class IsHandoverParticipantOrStaff(BasePermission):
    message = "You can only access handovers involving your assignments."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True

        return request.user.id in {
            obj.outgoing_assignment.team_leader_id,
            obj.incoming_assignment.team_leader_id,
        }


class IsBreakRecoveryParticipantOrStaff(BasePermission):
    message = "You can only access break records involving you or your assignment."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True

        return request.user.id in {
            obj.assignment.team_leader_id,
            obj.cover_user_id,
        }
