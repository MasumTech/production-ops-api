from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsStaffOrReadOnly(BasePermission):
    message = "Only management staff can change line assignments."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return request.method in SAFE_METHODS or request.user.is_staff
