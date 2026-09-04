from enum import StrEnum

OPERATIONAL_SUPPORT_GROUP = "Operational Support"


class WorkspaceRole(StrEnum):
    MANAGER = "manager"
    TEAM_LEADER = "team_leader"
    SUPPORT = "support"


def is_operational_support(user) -> bool:
    return bool(
        user
        and user.is_authenticated
        and user.groups.filter(name=OPERATIONAL_SUPPORT_GROUP).exists()
    )


def workspace_role_for_user(user) -> WorkspaceRole:
    if user.is_staff:
        return WorkspaceRole.MANAGER
    if is_operational_support(user):
        return WorkspaceRole.SUPPORT
    return WorkspaceRole.TEAM_LEADER
