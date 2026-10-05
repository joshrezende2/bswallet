// BS Wallet — convites online. Tabelas existentes, sem alteração de IDs.
// Request History desativado: history = false (confirmado no editor da instância).
// Veja docs/XANO-INVITES.md para migração aditiva e validação de concorrência.

query "workspace/invites/create" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid workspace_id
    email email filters=trim|lower
    text role
    text[] permissions
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $input.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "single"}
    } as $membership
    precondition ($membership != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
    }
    var $permissions {
      value = $membership.permissions
    }
    conditional {
      if ($permissions == null) {
        conditional {
          if ($membership.role == "admin_master") {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
            }
          }
          else {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
            }
          }
        }
      }
    }
    array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
    precondition ($membership.role == "admin_master" || $can_manage) {
      error_type = "accessdenied"
      error = "Sem permissão para gerenciar membros."
    }
    db.transaction {
      stack {
        // Serialize mudanças do mesmo workspace antes de reler convites/membros.
        db.edit "workspace" {
          field_name = "id"
          field_value = $input.workspace_id
          data = {updated_at: now}
        } as $workspace
        precondition ($workspace != null && $workspace.active == true) {
          error_type = "accessdenied"
          error = "Workspace indisponível."
        }
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
          return = {type: "single"}
        } as $membership
        precondition ($membership != null) {
          error_type = "accessdenied"
          error = "Você não pertence a este workspace."
        }
        var $permissions {
          value = $membership.permissions
        }
        conditional {
          if ($permissions == null) {
            conditional {
              if ($membership.role == "admin_master") {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                }
              }
              else {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
                }
              }
            }
          }
        }
        array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
        precondition ($membership.role == "admin_master" || $can_manage) {
          error_type = "accessdenied"
          error = "Sem permissão para gerenciar membros."
        }
        precondition ($input.role == "member" || $input.role == "admin") {
          error_type = "inputerror"
          error = "Papel inválido."
        }
        var $invalid_permissions {
          value = $input.permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
        }
        precondition (($invalid_permissions|count) == 0) {
          error_type = "inputerror"
          error = "Permissão inválida."
        }
        var $excess_permissions {
          value = $input.permissions|diff:$permissions
        }
        precondition ($membership.role == "admin_master" || ($input.role == "member" && ($excess_permissions|count) == 0)) {
          error_type = "accessdenied"
          error = "Somente o Master pode conceder administração ou permissões superiores."
        }
        precondition ($input.email != $actor_email) {
          error_type = "inputerror"
          error = "Você não pode convidar a si mesmo."
        }
        db.get "user" {
          field_name = "email"
          field_value = $input.email
        } as $recipient
        conditional {
          if ($recipient != null) {
            db.query workspace_members {
              where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $recipient.id
              return = {type: "single"}
            } as $recipient_member
            precondition ($recipient_member == null) {
              error_type = "inputerror"
              error = "Esta pessoa já possui vínculo com a família. Reative o vínculo existente."
            }
          }
        }
        db.query workspace_invites {
          where = $db.workspace_invites.workspace_id == $input.workspace_id && $db.workspace_invites.email == $input.email && $db.workspace_invites.status == "pending" && $db.workspace_invites.expires_at > now
          return = {type: "single"}
        } as $duplicate
        precondition ($duplicate == null) {
          error_type = "inputerror"
          error = "Já existe um convite pendente para este e-mail."
        }
        security.create_uuid as $invite_id
        security.random_bytes {
          length = 32
        } as $random_bytes
        var $token {
          value = $random_bytes|bin2hex
        }
        var $token_hash {
          value = $token|sha256:true
        }
        var $expires_at {
          value = now + 604800000
        }
        db.add "workspace_invites" {
          data = {id: $invite_id, created_at: now, updated_at: now, workspace_id: $input.workspace_id, email: $input.email, invited_by: $auth.id, role: $input.role, permissions: $input.permissions, status: "pending", token_hash: $token_hash, expires_at: $expires_at, accepted_at: null, accepted_user_id: null, declined_at: null, revoked_at: null, revoked_by: null, last_sent_at: now, send_count: 1}
        } as $invite
        var $safe_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.create_uuid as $audit_id
        db.add "audit_logs" {
          data = {id: $audit_id, workspace_id: $invite.workspace_id, entity_type: "workspace_invites", entity_id: $invite.id, action: "invite_create", actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $auth.id, before_data: null, after_data: $safe_invite}
        }
      }
    }
  }

  response = {invite: $safe_invite, token: $token}
  history = false
}

---
query "workspace/invites/pending" verb=GET {
  api_group = "BS Wallet"
  auth = "user"

  input {

  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    db.query workspace_invites {
      where = $db.workspace_invites.email == $actor_email && $db.workspace_invites.status == "pending" && $db.workspace_invites.expires_at > now
      return = {type: "list"}
      output = ["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
    } as $invites
    var $result {
      value = []
    }
    foreach ($invites) {
      each as invite {
        db.get "workspace" {
          field_name = "id"
          field_value = $invite.workspace_id
        } as $workspace
        conditional {
          if ($workspace != null && $workspace.active == true) {
            var $item {
              value = $invite|set:"workspace_name":$workspace.name
            }
            array.push result {
              value = $item
            }
          }
        }
      }
    }
  }

  response = $result
  history = false
}

---
query "workspace/invites/resolve" verb=POST {
  api_group = "BS Wallet"

  input {
    text token filters=trim|min:32|max:256
  }

  stack {
    var $token_hash {
      value = $input.token|sha256:true
    }
    db.get "workspace_invites" {
      field_name = "token_hash"
      field_value = $token_hash
    } as $invite
    var $result {
      value = {valid: false}
    }
    conditional {
      if ($invite != null && $invite.status == "pending" && $invite.expires_at > now) {
        db.get "workspace" {
          field_name = "id"
          field_value = $invite.workspace_id
        } as $workspace
        conditional {
          if ($workspace != null && $workspace.active == true) {
            var $email_parts {
              value = $invite.email|split:"@"
            }
            var $prefix {
              value = $invite.email|substr:0:2
            }
            var $domain {
              value = $email_parts|last
            }
            var $masked_email {
              value = $prefix|concat:"***@":$domain
            }
            var.update $result {
              value = {valid: true, workspace_name: $workspace.name, role: $invite.role, masked_email: $masked_email, expires_at: $invite.expires_at}
            }
          }
        }
      }
    }
  }

  response = $result
  history = false
}

---
query "workspace/invites/accept" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    text token?="" filters=trim|max:256
    uuid? invite_id?
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    precondition (($input.token != "" && $input.invite_id == null) || ($input.token == "" && $input.invite_id != null)) {
      error_type = "inputerror"
      error = "Informe token ou invite_id, exclusivamente."
    }
    var $token_hash {
      value = $input.token|sha256:true
    }
    var $located {
      value = null
    }
    conditional {
      if ($input.token != "") {
        db.get "workspace_invites" {
          field_name = "token_hash"
          field_value = $token_hash
        } as $located
      }
      else {
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $input.invite_id
        } as $located
      }
    }
    precondition ($located != null) {
      error_type = "accessdenied"
      error = "Convite inválido."
    }
    var $located_email {
      value = $located.email|trim|to_lower
    }
    precondition ($located_email == $actor_email) {
      error_type = "accessdenied"
      error = "Entre com a conta destinatária do convite."
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $located.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.transaction {
      stack {
        // Serialize mudanças do mesmo workspace antes de reler convites/membros.
        db.edit "workspace" {
          field_name = "id"
          field_value = $located.workspace_id
          data = {updated_at: now}
        } as $workspace
        precondition ($workspace != null && $workspace.active == true) {
          error_type = "accessdenied"
          error = "Workspace indisponível."
        }
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $located.id
        } as $invite
        precondition ($invite != null && $invite.status == "pending" && $invite.expires_at > now) {
          error_type = "accessdenied"
          error = "Convite expirado ou indisponível."
        }
        var $invite_email {
          value = $invite.email|trim|to_lower
        }
        precondition ($invite_email == $actor_email && ($input.token == "" || $invite.token_hash == $token_hash)) {
          error_type = "accessdenied"
          error = "Convite inválido."
        }
        var $before_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        precondition ($invite.role == "member" || $invite.role == "admin") {
          error_type = "accessdenied"
          error = "Papel inválido."
        }
        var $invalid_permissions {
          value = $invite.permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
        }
        precondition (($invalid_permissions|count) == 0) {
          error_type = "accessdenied"
          error = "Permissões inválidas."
        }
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $invite.workspace_id && $db.workspace_members.user_id == $invite.invited_by && $db.workspace_members.active == true
          return = {type: "single"}
        } as $inviter
        precondition ($inviter != null) {
          error_type = "accessdenied"
          error = "O convidador não possui mais autorização."
        }
        var $inviter_permissions {
          value = $inviter.permissions
        }
        conditional {
          if ($inviter_permissions == null) {
            conditional {
              if ($inviter.role == "admin_master") {
                var.update $inviter_permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                }
              }
              else {
                var.update $inviter_permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
                }
              }
            }
          }
        }
        array.has ($inviter_permissions) if (`$this == "members.manage"`) as $inviter_manage
        var $excess_permissions {
          value = $invite.permissions|diff:$inviter_permissions
        }
        precondition ($inviter.role == "admin_master" || ($inviter_manage && $invite.role == "member" && ($excess_permissions|count) == 0)) {
          error_type = "accessdenied"
          error = "As permissões do convidador mudaram. Solicite um novo convite."
        }
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $invite.workspace_id && $db.workspace_members.user_id == $auth.id
          return = {type: "single"}
        } as $existing_member
        precondition ($existing_member == null) {
          error_type = "inputerror"
          error = "Você já possui vínculo com esta família."
        }
        security.create_uuid as $membership_id
        db.add "workspace_members" {
          data = {id: $membership_id, created_at: now, updated_at: now, workspace_id: $invite.workspace_id, user_id: $auth.id, role: $invite.role, permissions: $invite.permissions, active: true, joined_at: now, invited_by: $invite.invited_by}
        } as $new_member
        db.edit "workspace_invites" {
          field_name = "id"
          field_value = $invite.id
          data = {status: "accepted", updated_at: now, accepted_at: now, accepted_user_id: $auth.id}
        } as $invite
        var $safe_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.create_uuid as $audit_id
        db.add "audit_logs" {
          data = {id: $audit_id, workspace_id: $invite.workspace_id, entity_type: "workspace_invites", entity_id: $invite.id, action: "invite_accept", actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $auth.id, before_data: $before_invite, after_data: $safe_invite}
        }
      }
    }
  }

  response = {ok: true, workspace_id: $invite.workspace_id, membership_id: $membership_id}
  history = false
}

---
query "workspace/invites/decline" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    text token?="" filters=trim|max:256
    uuid? invite_id?
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    precondition (($input.token != "" && $input.invite_id == null) || ($input.token == "" && $input.invite_id != null)) {
      error_type = "inputerror"
      error = "Informe token ou invite_id, exclusivamente."
    }
    var $token_hash {
      value = $input.token|sha256:true
    }
    var $located {
      value = null
    }
    conditional {
      if ($input.token != "") {
        db.get "workspace_invites" {
          field_name = "token_hash"
          field_value = $token_hash
        } as $located
      }
      else {
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $input.invite_id
        } as $located
      }
    }
    precondition ($located != null) {
      error_type = "accessdenied"
      error = "Convite inválido."
    }
    var $located_email {
      value = $located.email|trim|to_lower
    }
    precondition ($located_email == $actor_email) {
      error_type = "accessdenied"
      error = "Entre com a conta destinatária do convite."
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $located.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.transaction {
      stack {
        // Serialize mudanças do mesmo workspace antes de reler convites/membros.
        db.edit "workspace" {
          field_name = "id"
          field_value = $located.workspace_id
          data = {updated_at: now}
        } as $workspace
        precondition ($workspace != null && $workspace.active == true) {
          error_type = "accessdenied"
          error = "Workspace indisponível."
        }
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $located.id
        } as $invite
        precondition ($invite != null && $invite.status == "pending" && $invite.expires_at > now) {
          error_type = "accessdenied"
          error = "Convite expirado ou indisponível."
        }
        var $invite_email {
          value = $invite.email|trim|to_lower
        }
        precondition ($invite_email == $actor_email && ($input.token == "" || $invite.token_hash == $token_hash)) {
          error_type = "accessdenied"
          error = "Convite inválido."
        }
        var $before_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        db.edit "workspace_invites" {
          field_name = "id"
          field_value = $invite.id
          data = {status: "declined", updated_at: now, declined_at: now}
        } as $invite
        var $safe_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.create_uuid as $audit_id
        db.add "audit_logs" {
          data = {id: $audit_id, workspace_id: $invite.workspace_id, entity_type: "workspace_invites", entity_id: $invite.id, action: "invite_decline", actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $auth.id, before_data: $before_invite, after_data: $safe_invite}
        }
      }
    }
  }

  response = {ok: true}
  history = false
}

---
query "workspace/invites/list" verb=GET {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid workspace_id
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $input.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "single"}
    } as $membership
    precondition ($membership != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
    }
    var $permissions {
      value = $membership.permissions
    }
    conditional {
      if ($permissions == null) {
        conditional {
          if ($membership.role == "admin_master") {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
            }
          }
          else {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
            }
          }
        }
      }
    }
    array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
    precondition ($membership.role == "admin_master" || $can_manage) {
      error_type = "accessdenied"
      error = "Sem permissão para gerenciar membros."
    }
    db.query workspace_invites {
      where = $db.workspace_invites.workspace_id == $input.workspace_id
      return = {type: "list"}
      output = ["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
    } as $invites
    var $result {
      value = []
    }
    foreach ($invites) {
      each as invite {
        conditional {
          if ($invite.status == "pending" && $invite.expires_at <= now) {
            var.update $invite {
              value = $invite|set:"status":"expired"
            }
          }
        }
        array.push result {
          value = $invite
        }
      }
    }
  }

  response = $result
  history = false
}

---
query "workspace/invites/revoke" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid invite_id
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    db.get "workspace_invites" {
      field_name = "id"
      field_value = $input.invite_id
    } as $located
    precondition ($located != null) {
      error_type = "accessdenied"
      error = "Convite indisponível."
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $located.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $located.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "single"}
    } as $membership
    precondition ($membership != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
    }
    var $permissions {
      value = $membership.permissions
    }
    conditional {
      if ($permissions == null) {
        conditional {
          if ($membership.role == "admin_master") {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
            }
          }
          else {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
            }
          }
        }
      }
    }
    array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
    precondition ($membership.role == "admin_master" || $can_manage) {
      error_type = "accessdenied"
      error = "Sem permissão para gerenciar membros."
    }
    db.transaction {
      stack {
        // Serialize mudanças do mesmo workspace antes de reler convites/membros.
        db.edit "workspace" {
          field_name = "id"
          field_value = $located.workspace_id
          data = {updated_at: now}
        } as $workspace
        precondition ($workspace != null && $workspace.active == true) {
          error_type = "accessdenied"
          error = "Workspace indisponível."
        }
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $located.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
          return = {type: "single"}
        } as $membership
        precondition ($membership != null) {
          error_type = "accessdenied"
          error = "Você não pertence a este workspace."
        }
        var $permissions {
          value = $membership.permissions
        }
        conditional {
          if ($permissions == null) {
            conditional {
              if ($membership.role == "admin_master") {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                }
              }
              else {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
                }
              }
            }
          }
        }
        array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
        precondition ($membership.role == "admin_master" || $can_manage) {
          error_type = "accessdenied"
          error = "Sem permissão para gerenciar membros."
        }
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $input.invite_id
        } as $invite
        precondition ($invite != null && $invite.status == "pending" && $invite.expires_at > now) {
          error_type = "accessdenied"
          error = "Convite expirado ou indisponível."
        }
        precondition ($invite.role == "member" || $invite.role == "admin") {
          error_type = "inputerror"
          error = "Papel inválido."
        }
        var $invalid_permissions {
          value = $invite.permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
        }
        precondition (($invalid_permissions|count) == 0) {
          error_type = "inputerror"
          error = "Permissão inválida."
        }
        var $excess_permissions {
          value = $invite.permissions|diff:$permissions
        }
        precondition ($membership.role == "admin_master" || ($invite.role == "member" && ($excess_permissions|count) == 0)) {
          error_type = "accessdenied"
          error = "Somente o Master pode conceder administração ou permissões superiores."
        }
        var $before_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        db.edit "workspace_invites" {
          field_name = "id"
          field_value = $invite.id
          data = {status: "revoked", updated_at: now, revoked_at: now, revoked_by: $auth.id}
        } as $invite
        var $safe_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.create_uuid as $audit_id
        db.add "audit_logs" {
          data = {id: $audit_id, workspace_id: $invite.workspace_id, entity_type: "workspace_invites", entity_id: $invite.id, action: "invite_revoke", actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $auth.id, before_data: $before_invite, after_data: $safe_invite}
        }
      }
    }
  }

  response = {ok: true}
  history = false
}

---
query "workspace/invites/regenerate" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid invite_id
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
    } as $actor
    precondition ($actor != null && $actor.active == true) {
      error_type = "accessdenied"
      error = "Conta indisponível."
    }
    var $actor_email {
      value = $actor.email|trim|to_lower
    }
    db.get "workspace_invites" {
      field_name = "id"
      field_value = $input.invite_id
    } as $located
    precondition ($located != null) {
      error_type = "accessdenied"
      error = "Convite indisponível."
    }
    db.get "workspace" {
      field_name = "id"
      field_value = $located.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $located.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "single"}
    } as $membership
    precondition ($membership != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
    }
    var $permissions {
      value = $membership.permissions
    }
    conditional {
      if ($permissions == null) {
        conditional {
          if ($membership.role == "admin_master") {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
            }
          }
          else {
            var.update $permissions {
              value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
            }
          }
        }
      }
    }
    array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
    precondition ($membership.role == "admin_master" || $can_manage) {
      error_type = "accessdenied"
      error = "Sem permissão para gerenciar membros."
    }
    db.transaction {
      stack {
        // Serialize mudanças do mesmo workspace antes de reler convites/membros.
        db.edit "workspace" {
          field_name = "id"
          field_value = $located.workspace_id
          data = {updated_at: now}
        } as $workspace
        precondition ($workspace != null && $workspace.active == true) {
          error_type = "accessdenied"
          error = "Workspace indisponível."
        }
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $located.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
          return = {type: "single"}
        } as $membership
        precondition ($membership != null) {
          error_type = "accessdenied"
          error = "Você não pertence a este workspace."
        }
        var $permissions {
          value = $membership.permissions
        }
        conditional {
          if ($permissions == null) {
            conditional {
              if ($membership.role == "admin_master") {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                }
              }
              else {
                var.update $permissions {
                  value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
                }
              }
            }
          }
        }
        array.has ($permissions) if (`$this == "members.manage"`) as $can_manage
        precondition ($membership.role == "admin_master" || $can_manage) {
          error_type = "accessdenied"
          error = "Sem permissão para gerenciar membros."
        }
        db.get "workspace_invites" {
          field_name = "id"
          field_value = $input.invite_id
        } as $invite
        precondition ($invite != null && $invite.status == "pending" && $invite.expires_at > now) {
          error_type = "accessdenied"
          error = "Convite expirado ou indisponível."
        }
        precondition ($invite.role == "member" || $invite.role == "admin") {
          error_type = "inputerror"
          error = "Papel inválido."
        }
        var $invalid_permissions {
          value = $invite.permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
        }
        precondition (($invalid_permissions|count) == 0) {
          error_type = "inputerror"
          error = "Permissão inválida."
        }
        var $excess_permissions {
          value = $invite.permissions|diff:$permissions
        }
        precondition ($membership.role == "admin_master" || ($invite.role == "member" && ($excess_permissions|count) == 0)) {
          error_type = "accessdenied"
          error = "Somente o Master pode conceder administração ou permissões superiores."
        }
        var $before_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.random_bytes {
          length = 32
        } as $random_bytes
        var $token {
          value = $random_bytes|bin2hex
        }
        var $token_hash {
          value = $token|sha256:true
        }
        var $expires_at {
          value = now + 604800000
        }
        var $send_count {
          value = $invite.send_count + 1
        }
        db.edit "workspace_invites" {
          field_name = "id"
          field_value = $invite.id
          data = {token_hash: $token_hash, expires_at: $expires_at, updated_at: now, last_sent_at: now, send_count: $send_count}
        } as $invite
        var $safe_invite {
          value = $invite|pick:["id", "workspace_id", "email", "role", "permissions", "status", "created_at", "updated_at", "expires_at", "accepted_at", "send_count"]
        }
        security.create_uuid as $audit_id
        db.add "audit_logs" {
          data = {id: $audit_id, workspace_id: $invite.workspace_id, entity_type: "workspace_invites", entity_id: $invite.id, action: "invite_regenerate", actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $auth.id, before_data: $before_invite, after_data: $safe_invite}
        }
      }
    }
  }

  response = {invite: $safe_invite, token: $token}
  history = false
}
