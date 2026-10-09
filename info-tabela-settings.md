# Script/formato da tabela settings:

## tabela deve permanecer inalterada se possível, caso veja necessidade de altera-la pra otimizar/melhorar me pergunte antes 

table settings {
  auth = false

  schema {
    uuid id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    text version? filters=trim
    timestamp? published_at?
    bool published?
    bool active?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]
}

---

# Schema da tabela setting:

## schema da tabela deve permanecer inalterado se possível, caso veja necessidade de alterar pra otimizar/melhorar me pergunte antes

{
  "id":"uuid",
  "created_at":"timestamp",
  "version":"text",
  "published_at":"timestamp",
  "published":"bool",
  "active":"bool"
}

---

# Records existentes na tabela:

## records pra referencia de preenchimento, não alterar os existentes

633f7103-3f0a-4859-992e-6d90928d5ef3	1791557661243	0.0.1	1790866516000	true	false
1e90d2c5-a3ed-444a-8f9d-50c0b40f614f	1791557748849	0.1.0	1791384958000	true	true

---

# Endpoints da tabela settings:

## Endpoints podem ser alterados como bem entender

// Query all settings records
query settings verb=GET {
  api_group = "BS Wallet"

  input {
  }

  stack {
    db.query settings {
      return = {type: "list"}
    } as $settings
  }

  response = $settings
}
---
// Add settings record
query settings verb=POST {
  api_group = "BS Wallet"

  input {
    dblink {
      table = "settings"
    }
  }

  stack {
    db.add settings {
      enforce_hidden_fields = false
      data = {created_at: "now"}
    } as $settings
  }

  response = $settings
}
---
// Delete settings record.
query "settings/{settings_id}" verb=DELETE {
  api_group = "BS Wallet"

  input {
    uuid settings_id?
  }

  stack {
    db.del settings {
      field_name = "id"
      field_value = $input.settings_id
    }
  }

  response = null
}
---
// Get settings record
query "settings/{settings_id}" verb=GET {
  api_group = "BS Wallet"

  input {
    uuid settings_id?
  }

  stack {
    db.get settings {
      field_name = "id"
      field_value = $input.settings_id
    } as $settings
  
    precondition ($settings != null) {
      error_type = "notfound"
      error = "Not Found."
    }
  }

  response = $settings
}
---
// Edit settings record
query "settings/{settings_id}" verb=PATCH {
  api_group = "BS Wallet"

  input {
    uuid settings_id?
    dblink {
      table = "settings"
    }
  }

  stack {
    util.get_raw_input {
      encoding = "json"
      exclude_middleware = false
    } as $raw_input
  
    db.patch settings {
      field_name = "id"
      field_value = $input.settings_id
      data = `$input|pick:($raw_input|keys)`|filter_null|filter_empty_text
    } as $settings
  }

  response = $settings
}