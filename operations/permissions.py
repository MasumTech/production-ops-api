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
        )
