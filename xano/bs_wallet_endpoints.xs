// BS Wallet — endpoints Xano para autenticação e sincronização local-first
// Base API "Authentication": https://xano.ab1midia.com.br/api:iJuDN1w_
// Base API "BS Wallet":      https://xano.ab1midia.com.br/api:A-AE1sTc
//
// Observação: o payload completo do app é guardado em audit_logs.after_data.
// Isso preserva campos do domínio que ainda não possuem coluna equivalente nas tabelas atuais.

// Cadastro preservando o UUID criado offline pelo BS Wallet
query "auth/signup" verb=POST {
  api_group = "Authentication"

  input {
    uuid id
    text name filters=trim
    email email filters=trim|lower
    text password filters=min:8|minAlpha:1|minDigit:1
  }

  stack {
    db.get "user" {
      field_name = "email"
      field_value = $input.email
    } as $existing

    precondition ($existing == null) {
      error_type = "accessdenied"
      error = "This account is already in use."
    }

    db.add "user" {
      enforce_hidden_fields = false
      data = {
        id         : $input.id
        created_at : now
        updated_at : now
        name       : $input.name
        email      : $input.email
        password   : $input.password
        active     : true
      }
    } as $user

    security.create_auth_token {
      table = "user"
      extras = {}
      expiration = 2592000
      id = $user.id
    } as $authToken
  }

  response = {authToken: $authToken, user: {id: $user.id, created_at: $user.created_at, updated_at: $user.updated_at, name: $user.name, email: $user.email, active: $user.active}}
}
---
// Login por e-mail. Username remoto depende de adicionar username à tabela user.
query "auth/login" verb=POST {
  api_group = "Authentication"

  input {
    email email filters=trim|lower
    text password
  }

  stack {
    db.get "user" {
      field_name = "email"
      field_value = $input.email
      output = ["id", "created_at", "updated_at", "name", "email", "password", "active"]
    } as $user

    precondition ($user != null && $user.active == true) {
      error_type = "accessdenied"
      error = "Invalid Credentials."
    }

    security.check_password {
      text_password = $input.password
      hash_password = $user.password
    } as $pass_result

    precondition ($pass_result) {
      error_type = "accessdenied"
      error = "Invalid Credentials."
    }

    security.create_auth_token {
      table = "user"
      extras = {}
      expiration = 2592000
      id = $user.id
    } as $authToken
  }

  response = {authToken: $authToken, user: {id: $user.id, created_at: $user.created_at, updated_at: $user.updated_at, name: $user.name, email: $user.email, active: $user.active}}
}
---
query "auth/me" verb=GET {
  api_group = "Authentication"
  auth = "user"

  input {}

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
      output = ["id", "created_at", "updated_at", "name", "email", "active"]
    } as $user
  }

  response = $user
}
---
query "auth/change_password" verb=POST {
  api_group = "Authentication"
  auth = "user"

  input {
    text current_password
    text new_password filters=min:8|minAlpha:1|minDigit:1
  }

  stack {
    db.get "user" {
      field_name = "id"
      field_value = $auth.id
      output = ["id", "password"]
    } as $user

    security.check_password {
      text_password = $input.current_password
      hash_password = $user.password
    } as $pass_result

    precondition ($pass_result) {
      error_type = "accessdenied"
      error = "Invalid Credentials."
    }

    db.edit "user" {
      field_name = "id"
      field_value = $auth.id
      data = {
        password   : $input.new_password
        updated_at : now
      }
    }
  }

  response = {ok: true}
}

---
// Workspaces disponíveis para a conta autenticada.
query "sync/workspaces" verb=GET {
  api_group = "BS Wallet"
  auth = "user"

  input {}

  stack {
    db.query workspace_members {
      where = $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "list"}
    } as $memberships
  }

  response = $memberships
}

---
// Snapshot completo autorizado de um workspace.
query "sync/bootstrap" verb=GET {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid workspace_id
  }

  stack {
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
    array.has ($permissions) if (`$this == "shared.read"`) as $can_shared_read
    array.has ($permissions) if (`$this == "attachments.read"`) as $can_attachment_read
    array.has ($permissions) if (`$this == "members.manage"`) as $can_manage

    db.get "workspace" {
      field_name = "id"
      field_value = $input.workspace_id
    } as $workspace
    precondition ($workspace != null && $workspace.active == true) {
      error_type = "accessdenied"
      error = "Workspace indisponível."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.active == true
      return = {type: "list"}
    } as $members
    db.query people {
      where = $db.people.workspace_id == $input.workspace_id && ($db.people.scope == "shared" || $db.people.owner_user_id == $auth.id) && ($db.people.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $people
    db.query categories {
      where = $db.categories.workspace_id == $input.workspace_id && ($db.categories.scope == "shared" || $db.categories.owner_user_id == $auth.id) && ($db.categories.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $categories
    db.query accounts {
      where = $db.accounts.workspace_id == $input.workspace_id && ($db.accounts.scope == "shared" || $db.accounts.owner_user_id == $auth.id) && ($db.accounts.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $accounts
    db.query cards {
      where = $db.cards.workspace_id == $input.workspace_id && ($db.cards.scope == "shared" || $db.cards.owner_user_id == $auth.id) && ($db.cards.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $cards
    db.query recurrences {
      where = $db.recurrences.workspace_id == $input.workspace_id && ($db.recurrences.scope == "shared" || $db.recurrences.owner_user_id == $auth.id) && ($db.recurrences.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $recurrences
    db.query invoices {
      where = $db.invoices.workspace_id == $input.workspace_id && ($db.invoices.scope == "shared" || $db.invoices.owner_user_id == $auth.id) && ($db.invoices.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $invoices
    db.query transactions {
      where = $db.transactions.workspace_id == $input.workspace_id && ($db.transactions.scope == "shared" || $db.transactions.owner_user_id == $auth.id) && ($db.transactions.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $transactions
    db.query budgets {
      where = $db.budgets.workspace_id == $input.workspace_id && ($db.budgets.scope == "shared" || $db.budgets.owner_user_id == $auth.id) && ($db.budgets.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $budgets
    db.query transfers {
      where = $db.transfers.workspace_id == $input.workspace_id && ($db.transfers.scope == "shared" || $db.transfers.owner_user_id == $auth.id) && ($db.transfers.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $transfers
    db.query installment_groups {
      where = $db.installment_groups.workspace_id == $input.workspace_id && ($db.installment_groups.scope == "shared" || $db.installment_groups.owner_user_id == $auth.id) && ($db.installment_groups.scope != "shared" || $membership.role == "admin_master" || $can_shared_read)
      return = {type: "list"}
    } as $installment_groups
    db.query preferences {
      where = $db.preferences.workspace_id == $input.workspace_id
      return = {type: "single"}
    } as $preferences
    db.query audit_logs {
      where = $db.audit_logs.workspace_id == $input.workspace_id && ($db.audit_logs.scope == "shared" || $db.audit_logs.owner_user_id == $auth.id) && ($db.audit_logs.scope != "shared" || $membership.role == "admin_master" || $can_shared_read) && ($db.audit_logs.entity_type != "workspace_invites" || $membership.role == "admin_master" || $can_manage) && ($db.audit_logs.entity_type != "attachments" || $membership.role == "admin_master" || $can_attachment_read || $db.audit_logs.scope == "private")
      sort = {timestamp: "asc"}
      return = {type: "list"}
    } as $audit_logs
    db.query trash {
      where = $db.trash.workspace_id == $input.workspace_id && $db.trash.owner_user_id == $auth.id
      sort = {deleted_at: "desc"}
      return = {type: "list"}
    } as $trash
    db.query attachments {
      where = $db.attachments.workspace_id == $input.workspace_id && $db.attachments.owner_user_id == $auth.id && $db.attachments.active == true
      return = {type: "list"}
    } as $attachments
  }

  response = {
    workspace          : $workspace
    members            : $members
    people             : $people
    categories         : $categories
    accounts           : $accounts
    cards              : $cards
    recurrences        : $recurrences
    invoices           : $invoices
    transactions       : $transactions
    budgets            : $budgets
    transfers          : $transfers
    installment_groups : $installment_groups
    preferences        : $preferences
    audit_logs         : $audit_logs
    trash              : $trash
    attachments        : $attachments
  }
}

---
// Cria/atualiza o workspace. Na criação, o usuário autenticado precisa ser o created_by.
query "sync/workspace" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    precondition ($input.entity_type == "workspace" && $input.entity_id == $input.workspace_id && $input.record.id == $input.workspace_id && $input.payload.id == $input.workspace_id) {
      error_type = "inputerror"
      error = "Identidade do workspace inválida."
    }
    precondition ($input.payload.masterAdminUserId == $input.record.created_by && $input.record.created_by == $auth.id) {
      error_type = "accessdenied"
      error = "Não é permitido transferir a propriedade."
    }
    db.has audit_logs {
      field_name = "id"
      field_value = $input.operation_id
    } as $already_processed

    conditional {
      if ($already_processed == false) {
        db.get "workspace" {
          field_name = "id"
          field_value = $input.entity_id
        } as $existing
        db.query workspace_members {
          where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
          return = {type: "single"}
        } as $membership

        conditional {
          if ($existing == null) {
            precondition ($input.record.created_by == $auth.id) {
              error_type = "accessdenied"
              error = "Workspace inválido."
            }
            db.add "workspace" {
              data = {
                id         : $input.record.id
                created_at : now
                updated_at : now
                name       : $input.record.name
                created_by : $auth.id
                active     : true
              }
            }
          }
          else {
            precondition ($membership != null && $membership.role == "admin_master") {
              error_type = "accessdenied"
              error = "Somente o Administrador Master altera o workspace."
            }
            db.edit "workspace" {
              field_name = "id"
              field_value = $input.entity_id
              data = {
                updated_at : now
                name       : $input.record.name
                active     : true
              }
            }
          }
        }

        db.add "audit_logs" {
          data = {
            id            : $input.operation_id
            workspace_id  : $input.workspace_id
            entity_type   : $input.entity_type
            entity_id     : $input.entity_id
            action        : $input.action
            actor_user_id : $auth.id
            actor_name    : $input.actor_name
            timestamp     : now
            scope         : "shared"
            owner_user_id : $auth.id
            before_data   : $existing
            after_data    : $input.payload
          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
query "sync/workspace_members" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    precondition ($input.entity_type == "members" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
      error_type = "inputerror"
      error = "Identidade do vínculo inválida."
    }
    precondition ($input.action != "delete" && $input.action != "purge") {
      error_type = "inputerror"
      error = "Membros devem ser desativados, nunca excluídos."
    }
    db.query workspace_members {
      where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
      return = {type: "single"}
    } as $preflight
    precondition ($preflight != null || ($workspace.created_by == $auth.id && $input.record.user_id == $auth.id && $input.record.role == "admin_master")) {
      error_type = "accessdenied"
      error = "Acesso não autorizado."
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
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == "members")) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        conditional {
          if ($processed == null) {
            db.get "workspace_members" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing
            db.query workspace_members {
              where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $input.record.user_id
              return = {type: "single"}
            } as $same_user
            db.query workspace_members {
              where = $db.workspace_members.workspace_id == $input.workspace_id && $db.workspace_members.user_id == $auth.id && $db.workspace_members.active == true
              return = {type: "single"}
            } as $membership
            db.get "user" {
              field_name = "id"
              field_value = $input.record.user_id
            } as $target_user
            precondition ($target_user != null) {
              error_type = "accessdenied"
              error = "Usuário inexistente."
            }
            var $next_permissions {
              value = $input.record|get:"permissions":null
            }
            conditional {
              if ($next_permissions == null) {
                conditional {
                  if ($input.record.role == "admin_master") {
                    var.update $next_permissions {
                      value = ["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                    }
                  }
                  else {
                    var.update $next_permissions {
                      value = ["shared.read", "shared.create", "transactions.editOwn", "attachments.read", "reports.read"]
                    }
                  }
                }
              }
            }
            var $invalid_permissions {
              value = $next_permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
            }
            precondition (($invalid_permissions|count) == 0) {
              error_type = "inputerror"
              error = "Permissão inválida."
            }
            conditional {
              if ($existing == null) {
                db.query workspace_members {
                  where = $db.workspace_members.workspace_id == $input.workspace_id
                  return = {type: "single"}
                } as $any_member
                precondition ($same_user == null && $any_member == null && $workspace.created_by == $auth.id && $input.record.user_id == $auth.id && $input.record.role == "admin_master" && $input.record.active == true) {
                  error_type = "accessdenied"
                  error = "Novos membros devem aceitar um convite."
                }
                db.add "workspace_members" {
                  data = {id: $input.entity_id, created_at: now, updated_at: now, workspace_id: $input.workspace_id, user_id: $auth.id, role: "admin_master", permissions: $next_permissions, active: true, joined_at: now, invited_by: null}
                } as $saved_member
              }
              else {
                precondition ($existing.workspace_id == $input.workspace_id && $existing.user_id == $input.record.user_id && $same_user.id == $existing.id) {
                  error_type = "accessdenied"
                  error = "Não é permitido alterar a identidade do vínculo."
                }
                conditional {
                  if ($existing.role == "admin_master" || $existing.user_id == $workspace.created_by) {
                    precondition ($existing.user_id == $auth.id && $existing.role == "admin_master" && $input.record.role == "admin_master" && $input.record.active == true) {
                      error_type = "accessdenied"
                      error = "O Administrador Master não pode ser alterado ou removido."
                    }
                    // Reenvio de bootstrap preserva integralmente o registro Master existente.
                    var $saved_member {
                      value = $existing
                    }
                  }
                  else {
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
                    precondition ($input.record.role == "member" || $input.record.role == "admin") {
                      error_type = "inputerror"
                      error = "Papel inválido."
                    }
                    var $invalid_permissions {
                      value = $next_permissions|diff:["shared.read", "shared.create", "transactions.editOwn", "transactions.editOthers", "transactions.delete", "attachments.read", "catalog.manage", "budgets.manage", "reports.read", "members.manage"]
                    }
                    precondition (($invalid_permissions|count) == 0) {
                      error_type = "inputerror"
                      error = "Permissão inválida."
                    }
                    var $excess_permissions {
                      value = $next_permissions|diff:$permissions
                    }
                    precondition ($membership.role == "admin_master" || ($input.record.role == "member" && ($excess_permissions|count) == 0)) {
                      error_type = "accessdenied"
                      error = "Somente o Master pode conceder administração ou permissões superiores."
                    }
                    precondition ($membership.role == "admin_master" || ($existing.role != "admin" && $existing.user_id != $auth.id)) {
                      error_type = "accessdenied"
                      error = "Somente o Master pode alterar administradores ou o próprio vínculo."
                    }
                    db.edit "workspace_members" {
                      field_name = "id"
                      field_value = $existing.id
                      data = {updated_at: now, role: $input.record.role, permissions: $next_permissions, active: $input.record.active}
                    } as $saved_member
                  }
                }
              }
            }
            var $member_payload {
              value = {id: $saved_member.id, userId: $saved_member.user_id, name: $target_user.name, email: $target_user.email, role: $saved_member.role, permissions: $saved_member.permissions, status: "active"}
            }
            var $member_action {
              value = "member_permissions_update"
            }
            conditional {
              if ($saved_member.active == false) {
                var.update $member_action {
                  value = "member_disable"
                }
                var.update $member_payload {
                  value = $member_payload|set:"status":"disabled"
                }
              }
            }
            db.add "audit_logs" {
              data = {id: $input.operation_id, workspace_id: $input.workspace_id, entity_type: "members", entity_id: $input.entity_id, action: $member_action, actor_user_id: $auth.id, actor_name: $actor.name, timestamp: now, scope: "shared", owner_user_id: $saved_member.user_id, before_data: $existing, after_data: $member_payload}
            }
          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync people
query "sync/people" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "people" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "people" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "people" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "people" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "people" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        linked_user_id: $input.record.linked_user_id
                        monthly_spending_limit_enabled: $input.record.monthly_spending_limit_enabled
                        monthly_spending_limit: $input.record.monthly_spending_limit
                        allowed_category_ids: $input.record.allowed_category_ids
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "people" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        linked_user_id: $input.record.linked_user_id
                        monthly_spending_limit_enabled: $input.record.monthly_spending_limit_enabled
                        monthly_spending_limit: $input.record.monthly_spending_limit
                        allowed_category_ids: $input.record.allowed_category_ids
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync categories
query "sync/categories" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "categories" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "categories" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "categories" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "categories" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "categories" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        icon: $input.record.icon
                        type: $input.record.type
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "categories" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        icon: $input.record.icon
                        type: $input.record.type
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync accounts
query "sync/accounts" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "accounts" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "accounts" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "accounts" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "accounts" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "accounts" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        institution: $input.record.institution
                        type: $input.record.type
                        owner_person_id: $input.record.owner_person_id
                        active: $input.record.active
                        notes: $input.record.notes
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "accounts" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        institution: $input.record.institution
                        type: $input.record.type
                        owner_person_id: $input.record.owner_person_id
                        active: $input.record.active
                        notes: $input.record.notes
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync cards
query "sync/cards" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "cards" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "cards" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "cards" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "cards" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "cards" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        bank: $input.record.bank
                        brand: $input.record.brand
                        last4_digits: $input.record.last4_digits
                        total_limit: $input.record.total_limit
                        closing_day: $input.record.closing_day
                        due_day: $input.record.due_day
                        owner_person_id: $input.record.owner_person_id
                        account_id: $input.record.account_id
                        active: $input.record.active
                        notes: $input.record.notes
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "cards" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        bank: $input.record.bank
                        brand: $input.record.brand
                        last4_digits: $input.record.last4_digits
                        total_limit: $input.record.total_limit
                        closing_day: $input.record.closing_day
                        due_day: $input.record.due_day
                        owner_person_id: $input.record.owner_person_id
                        account_id: $input.record.account_id
                        active: $input.record.active
                        notes: $input.record.notes
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync recurrences
query "sync/recurrences" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "recurrences" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "recurrences" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "recurrences" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "recurrences" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "recurrences" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        amount: $input.record.amount
                        type: $input.record.type
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        notes: $input.record.notes
                        frequency: $input.record.frequency
                        custom_interval_value: $input.record.custom_interval_value
                        custom_interval_unit: $input.record.custom_interval_unit
                        start_date: $input.record.start_date
                        next_occurrence_date: $input.record.next_occurrence_date
                        auto_confirm: $input.record.auto_confirm
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "recurrences" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        amount: $input.record.amount
                        type: $input.record.type
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        notes: $input.record.notes
                        frequency: $input.record.frequency
                        custom_interval_value: $input.record.custom_interval_value
                        custom_interval_unit: $input.record.custom_interval_unit
                        start_date: $input.record.start_date
                        next_occurrence_date: $input.record.next_occurrence_date
                        auto_confirm: $input.record.auto_confirm
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync invoices
query "sync/invoices" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "invoices" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "invoices" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "invoices" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "invoices" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "invoices" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        card_id: $input.record.card_id
                        cycle_month: $input.record.cycle_month
                        closing_date: $input.record.closing_date
                        due_date: $input.record.due_date
                        status: $input.record.status
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "invoices" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        card_id: $input.record.card_id
                        cycle_month: $input.record.cycle_month
                        closing_date: $input.record.closing_date
                        due_date: $input.record.due_date
                        status: $input.record.status
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync transactions
query "sync/transactions" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "transactions" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "transactions" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        conditional {
          if ($current_record != null && $current_record.scope != $input.record.scope) {
            precondition ($current_record.installment_group_id == null && $current_record.recurrence_id == null) {
              error_type = "inputerror"
              error = "O escopo de ocorrências e parcelas é definido pela série."
            }
          }
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "transactions.editOwn"`) as $can_edit_own
        array.has ($permissions) if (`$this == "transactions.editOthers"`) as $can_edit_others
        conditional {
          if ($input.record.scope == "shared" || ($current_record != null && $current_record.scope == "shared")) {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || (($input.record.owner_user_id == $auth.id && $can_edit_own) || ($input.record.owner_user_id != $auth.id && $can_edit_others))) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "transactions" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "transactions" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "transactions" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        amount: $input.record.amount
                        type: $input.record.type
                        status: $input.record.status
                        transaction_date: $input.record.transaction_date
                        competence_date: $input.record.competence_date
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        invoice_id: $input.record.invoice_id
                        recurrence_id: $input.record.recurrence_id
                        installment_group_id: $input.record.installment_group_id
                        notes: $input.record.notes
                        payment_mode: $input.record.payment_mode
                        occurrence_key: $input.record.occurrence_key
                        installment_number: $input.record.installment_number
                        installment_total: $input.record.installment_total
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "transactions" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        amount: $input.record.amount
                        type: $input.record.type
                        status: $input.record.status
                        transaction_date: $input.record.transaction_date
                        competence_date: $input.record.competence_date
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        invoice_id: $input.record.invoice_id
                        recurrence_id: $input.record.recurrence_id
                        installment_group_id: $input.record.installment_group_id
                        notes: $input.record.notes
                        payment_mode: $input.record.payment_mode
                        occurrence_key: $input.record.occurrence_key
                        installment_number: $input.record.installment_number
                        installment_total: $input.record.installment_total
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync budgets
query "sync/budgets" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "budgets" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "budgets" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "budgets.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "budgets" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "budgets" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "budgets" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        amount: $input.record.amount
                        reference_month: $input.record.reference_month
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "budgets" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        amount: $input.record.amount
                        reference_month: $input.record.reference_month
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync transfers
query "sync/transfers" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "transfers" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "transfers" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "transactions.editOwn"`) as $can_edit_own
        array.has ($permissions) if (`$this == "transactions.editOthers"`) as $can_edit_others
        conditional {
          if ($input.record.scope == "shared" || ($current_record != null && $current_record.scope == "shared")) {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || (($input.record.owner_user_id == $auth.id && $can_edit_own) || ($input.record.owner_user_id != $auth.id && $can_edit_others))) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "transfers" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "transfers" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "transfers" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        from_account_id: $input.record.from_account_id
                        to_account_id: $input.record.to_account_id
                        amount: $input.record.amount
                        transfer_date: $input.record.transfer_date
                        notes: $input.record.notes
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "transfers" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        from_account_id: $input.record.from_account_id
                        to_account_id: $input.record.to_account_id
                        amount: $input.record.amount
                        transfer_date: $input.record.transfer_date
                        notes: $input.record.notes
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync installment_groups
query "sync/installment_groups" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.record.scope == "shared" || $input.record.owner_user_id == $auth.id) {
          error_type = "accessdenied"
          error = "Item privado pertence a outro usuário."
        }

        precondition ($input.entity_type == "installmentGroups" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "installment_groups" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.scope == $input.record.scope && ($current_record.scope == "shared" || $current_record.owner_user_id == $auth.id)) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.scope == "shared" || $input.record.scope == "private") {
          error_type = "inputerror"
          error = "Escopo inválido."
        }
        precondition ($input.payload.ownerUserId == $input.record.owner_user_id && (($input.payload.scope == "shared" && $input.record.scope == "shared") || ($input.payload.scope == "personal" && $input.record.scope == "private"))) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "shared.create"`) as $can_create
        array.has ($permissions) if (`$this == "transactions.delete"`) as $can_delete
        array.has ($permissions) if (`$this == "catalog.manage"`) as $can_write
        conditional {
          if ($input.record.scope == "shared") {
            precondition ($membership.role == "admin_master" || $can_read) {
              error_type = "accessdenied"
              error = "Sem permissão para dados compartilhados."
            }
            precondition ($membership.role == "admin_master" || $current_record != null || $can_create) {
              error_type = "accessdenied"
              error = "Sem permissão para criar dados compartilhados."
            }
            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                precondition ($membership.role == "admin_master" || $can_delete) {
                  error_type = "accessdenied"
                  error = "Sem permissão para excluir."
                }
              }
              else {
                precondition ($membership.role == "admin_master" || $can_write) {
                  error_type = "accessdenied"
                  error = "Sem permissão para alterar."
                }
              }
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "installment_groups" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "installment_groups" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "installment_groups" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        total_amount: $input.record.total_amount
                        installment_count: $input.record.installment_count
                        start_date: $input.record.start_date
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        notes: $input.record.notes
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    precondition ($existing.version < $input.version) {
                      error_type = "inputerror"
                      error = "SYNC_CONFLICT"
                    }

                    db.edit "installment_groups" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        scope: $input.record.scope
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        updated_at: $input.record.updated_at
                        updated_by: $input.record.updated_by
                        version: $input.record.version
                        sync_status: $input.record.sync_status
                        name: $input.record.name
                        total_amount: $input.record.total_amount
                        installment_count: $input.record.installment_count
                        start_date: $input.record.start_date
                        category_id: $input.record.category_id
                        person_id: $input.record.person_id
                        account_id: $input.record.account_id
                        card_id: $input.record.card_id
                        notes: $input.record.notes
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync preferences
query "sync/preferences" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($membership.role == "admin_master" || $membership.role == "admin") {
          error_type = "accessdenied"
          error = "Seu perfil não permite alterar esta configuração."
        }

        precondition ($input.entity_type == "preferences" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "preferences" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "preferences" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "preferences" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "preferences" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        user_id: $input.record.user_id
                        notifications_enabled: $input.record.notifications_enabled
                        notice_types: $input.record.notice_types
                        invoice_days: $input.record.invoice_days
                        recurrence_days: $input.record.recurrence_days
                        installment_days: $input.record.installment_days
                        income_days: $input.record.income_days
                        attachment_max_mb: $input.record.attachment_max_mb
                      }
                    }
                  }
                  else {
                    db.edit "preferences" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        user_id: $input.record.user_id
                        notifications_enabled: $input.record.notifications_enabled
                        notice_types: $input.record.notice_types
                        invoice_days: $input.record.invoice_days
                        recurrence_days: $input.record.recurrence_days
                        installment_days: $input.record.installment_days
                        income_days: $input.record.income_days
                        attachment_max_mb: $input.record.attachment_max_mb
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}

---
// Sync attachments
query "sync/attachments" verb=POST {
  api_group = "BS Wallet"
  auth = "user"

  input {
    uuid operation_id
    text entity_type
    text action
    uuid workspace_id
    uuid entity_id
    int version?=1
    text actor_name?
    json record
    json payload
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
    } as $preflight
    precondition ($preflight != null) {
      error_type = "accessdenied"
      error = "Você não pertence a este workspace."
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

        precondition ($input.entity_type == "attachments" && $input.record.id == $input.entity_id && $input.record.workspace_id == $input.workspace_id) {
          error_type = "inputerror"
          error = "Identidade do registro inválida."
        }
        precondition ($input.payload.id == $input.entity_id && $input.payload.workspaceId == $input.workspace_id) {
          error_type = "inputerror"
          error = "Payload canônico inválido."
        }
        precondition ($input.action == "create" || $input.action == "import" || $input.action == "update" || $input.action == "status_change" || $input.action == "delete" || $input.action == "purge" || $input.action == "restore") {
          error_type = "inputerror"
          error = "Operação inválida."
        }
        db.get "attachments" {
          field_name = "id"
          field_value = $input.entity_id
        } as $current_record
        conditional {
          if ($current_record != null) {
            precondition ($current_record.workspace_id == $input.workspace_id && $current_record.owner_user_id == $input.record.owner_user_id && $current_record.created_by == $input.record.created_by && $current_record.entity_id == $input.record.entity_id && $current_record.entity_type == $input.record.entity_type) {
              error_type = "accessdenied"
              error = "Registro pertence a outro usuário ou workspace."
            }
          }
        }
        precondition ($input.record.entity_type == "transactions") {
          error_type = "inputerror"
          error = "Anexo deve pertencer a um lançamento."
        }
        db.get "transactions" {
          field_name = "id"
          field_value = $input.record.entity_id
        } as $parent_transaction
        precondition ($parent_transaction != null && $parent_transaction.workspace_id == $input.workspace_id && ($parent_transaction.scope == "shared" || $parent_transaction.owner_user_id == $auth.id)) {
          error_type = "accessdenied"
          error = "Lançamento do anexo indisponível."
        }
        precondition ($input.record.owner_user_id == $auth.id && $input.record.created_by == $auth.id) {
          error_type = "accessdenied"
          error = "Anexo pertence a outro usuário."
        }
        precondition ($input.record.scope == $parent_transaction.scope) {
          error_type = "accessdenied"
          error = "Escopo do anexo inválido."
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
        array.has ($permissions) if (`$this == "shared.read"`) as $can_read
        array.has ($permissions) if (`$this == "attachments.read"`) as $can_attach
        array.has ($permissions) if (`$this == "transactions.editOwn"`) as $can_edit_own
        array.has ($permissions) if (`$this == "transactions.editOthers"`) as $can_edit_others
        conditional {
          if ($parent_transaction.scope == "shared") {
            precondition ($membership.role == "admin_master" || ($can_read && $can_attach && (($parent_transaction.owner_user_id == $auth.id && $can_edit_own) || ($parent_transaction.owner_user_id != $auth.id && $can_edit_others)))) {
              error_type = "accessdenied"
              error = "Sem permissão para alterar anexos."
            }
          }
        }
        db.get "audit_logs" {
          field_name = "id"
          field_value = $input.operation_id
        } as $processed
        precondition ($processed == null || ($processed.workspace_id == $input.workspace_id && $processed.actor_user_id == $auth.id && $processed.entity_id == $input.entity_id && $processed.entity_type == $input.entity_type)) {
          error_type = "accessdenied"
          error = "Identificador de operação inválido."
        }
        var $already_processed {
          value = $processed != null
        }

        conditional {
          if ($already_processed == false) {
            db.get "attachments" {
              field_name = "id"
              field_value = $input.entity_id
            } as $existing

            conditional {
              if ($input.action == "delete" || $input.action == "purge") {
                conditional {
                  if ($existing != null) {
                    db.has trash {
                      field_name = "id"
                      field_value = $input.operation_id
                    } as $trash_exists

                    conditional {
                      if ($trash_exists == false && $input.action == "delete") {
                        db.add "trash" {
                          data = {
                            id            : $input.operation_id
                            workspace_id  : $input.workspace_id
                            owner_user_id : $input.record.owner_user_id
                            created_at    : now
                            entity_type   : $input.entity_type
                            entity_id     : $input.entity_id
                            data          : $input.payload
                            deleted_at    : now
                            deleted_by    : $auth.id
                          }
                        }
                      }
                    }

                    db.del "attachments" {
                      field_name = "id"
                      field_value = $input.entity_id
                    }
                  }
                }
              }
              else {
                conditional {
                  if ($existing == null) {
                    db.add "attachments" {
                      data = {
                        id: $input.record.id
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        entity_type: $input.record.entity_type
                        entity_id: $input.record.entity_id
                        filename: $input.record.filename
                        mime_type: $input.record.mime_type
                        size_bytes: $input.record.size_bytes
                        active: $input.record.active
                      }
                    }
                  }
                  else {
                    db.edit "attachments" {
                      field_name = "id"
                      field_value = $input.entity_id
                      data = {
                        workspace_id: $input.record.workspace_id
                        owner_user_id: $input.record.owner_user_id
                        created_at: $input.record.created_at
                        created_by: $input.record.created_by
                        entity_type: $input.record.entity_type
                        entity_id: $input.record.entity_id
                        filename: $input.record.filename
                        mime_type: $input.record.mime_type
                        size_bytes: $input.record.size_bytes
                        active: $input.record.active
                      }
                    }
                  }
                }
              }
            }

            db.add "audit_logs" {
              data = {
                id            : $input.operation_id
                workspace_id  : $input.workspace_id
                entity_type   : $input.entity_type
                entity_id     : $input.entity_id
                action        : $input.action
                actor_user_id : $auth.id
                actor_name    : $input.actor_name
                timestamp     : now
                scope         : $input.record.scope
                owner_user_id : $input.record.owner_user_id
                before_data   : $existing
                after_data    : $input.payload
              }
            }

          }
        }
      }
    }
  }

  response = {ok: true, operation_id: $input.operation_id, entity_id: $input.entity_id, version: $input.version}
}
