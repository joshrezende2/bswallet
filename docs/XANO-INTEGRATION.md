# BS Wallet — integração Xano

## Estado desta revisão

A aplicação continua **local-first**. Toda gravação acontece primeiro no IndexedDB/Dexie e entra na `outbox`. Quando existe sessão Xano, internet e `VITE_XANO_SYNC_ENABLED=true`, a fila é enviada ao backend e só então marcada como sincronizada.

Arquivos principais:

- `src/data/auth.ts`: autenticação híbrida local + Xano;
- `src/data/sync.ts`: bootstrap, envio da outbox, pull do snapshot e hidratação de outro dispositivo;
- `src/data/xano/client.ts`: cliente HTTP/token;
- `src/data/xano/mapper.ts`: conversão entre o domínio TypeScript e as tabelas Xano;
- `xano/bs_wallet_endpoints.xs`: endpoints que devem ser aplicados no Xano.

## Ordem para ativar

1. Aplicar/atualizar os endpoints do arquivo `xano/bs_wallet_endpoints.xs` nos grupos `Authentication` e `BS Wallet`.
2. Manter as bases atuais:
   - Authentication: `https://xano.ab1midia.com.br/api:iJuDN1w_`
   - BS Wallet: `https://xano.ab1midia.com.br/api:A-AE1sTc`
3. Criar `.env` a partir de `.env.example`.
4. Alterar `VITE_XANO_SYNC_ENABLED=true` somente depois que os endpoints estiverem publicados e testados.
5. Executar `npm run typecheck`, `npm test` e `npm run build`.

## Compatibilidade com o schema atual

O domínio local e as tabelas atuais não são 1:1. A camada `mapper.ts` faz conversões para as colunas atuais, enquanto o payload canônico completo é gravado em `audit_logs.after_data`. Isso evita perda permanente de campos durante round-trip entre dispositivos.

Exemplos de tradução:

- `personal` ↔ `private`;
- `master_admin` ↔ `admin_master`;
- conta `digital` ↔ `wallet`;
- status local `pending` é representado como `forecast` na coluna atual, mas permanece `pending` no payload canônico;
- frequências `biweekly`, `bimonthly`, `quarterly` e `semiannual` são representadas por `custom` + intervalo na tabela Xano;
- `annual` ↔ `yearly`.

Campos que ainda não têm coluna equivalente (por exemplo `endDate` de recorrência, `thresholds` de orçamento, `additionalOfCardId`, parte dos dados de `InstallmentGroup`) continuam preservados no payload de auditoria e são restaurados pelo bootstrap.

## Limitações desta etapa

- A tabela `user` atual não possui `username`. No mesmo dispositivo o login por username continua funcionando pelo cache local. No primeiro login em outro dispositivo, use o **e-mail**. Para login remoto por username, adicione `username` único à tabela `user` e depois amplie os endpoints de autenticação.
- O OpenAPI consultado em 05/10/2026 já expõe `workspace_members.permissions`, `joined_at` e `invited_by` anuláveis. O endpoint e o mapper atuais ainda não utilizam esses campos: o backend restringe administração por papel, e a paridade completa de capabilities permanece pendente da Fase 2. A especificação não comprova a existência do índice único `(workspace_id, user_id)`.
- `attachments` sincroniza os metadados nesta etapa; o upload/download do Blob para `file` deve ser implementado em um endpoint multipart separado antes de considerar anexos disponíveis entre dispositivos.

## Regra de segurança

Nenhuma chave administrativa Xano deve ser colocada em `VITE_*`. O navegador usa somente token de usuário emitido pelo grupo `Authentication`. Endpoints de sync validam associação ao workspace e propriedade para dados privados.

## Fase 1 — contrato de serialização (05/10/2026)

Erro investigado: `Unable to locate input: record.person_id`. O serviço salva o objeto de domínio e a outbox no IndexedDB. O adaptador executa `toSyncEnvelope()` imediatamente antes do `JSON.stringify()` de cada envio. Antes da correção, os opcionais do `record` recebiam `undefined`, removido pela serialização; os endpoints acessavam `$input.record.*` sem verificar a presença das propriedades.

Havia também uma segunda causa: `sync/installment_groups` acessa `category_id`, `person_id`, `account_id` e `notes`, mas o mapper não criava essas quatro propriedades. Agora todos os campos anuláveis acessados pelos endpoints recebem `null` quando ausentes. Valores preenchidos, `0`, `false` e `""` são preservados. Não foram alteradas regras financeiras, persistência, exclusão da outbox nem tabelas/endpoints Xano.

O schema publicado foi consultado sem credenciais em [OpenAPI BS Wallet](https://xano.ab1midia.com.br/apispec:A-AE1sTc?type=json). A cópia pública em `tests/fixtures/xano-openapi.json` registra origem e data; os testes usam as definições de resposta de `/sync/bootstrap` para conferir colunas e `nullable`. O corpo `record` dos requests é JSON genérico: a especificação sozinha não descreve as chaves acessadas pelo XanoScript. Por isso `tests/helpers/xano-contract.ts` também extrai os acessos reais de cada query no arquivo de endpoints. Não se presume que ausência de `nullable` ou `required` confirme presença obrigatória no schema de resposta.

### Campos anuláveis auditados

| Entidade | Campos remotos normalizados quando ausentes |
| --- | --- |
| people | linked_user_id, allowed_category_ids |
| categories | icon |
| accounts | institution, owner_person_id, notes |
| cards | bank, brand, last4_digits, owner_person_id, account_id, notes |
| recurrences | category_id, person_id, account_id, card_id, notes |
| transactions | category_id, person_id, account_id, card_id, invoice_id, recurrence_id, installment_group_id, notes, occurrence_key, installment_number, installment_total |
| budgets | category_id, person_id |
| transfers | notes |
| installment_groups | category_id, person_id, account_id, card_id, notes |
| preferences | notice_types |
| attachments | mime_type, size_bytes |

Alguns desses campos são obrigatórios no domínio atual, mas opcionais na tabela; a normalização também suporta sua ausência em payloads antigos. `created_by` e `updated_by` já têm fallback para o ator autenticado. Os campos obrigatórios de negócio permanecem sob as validações de domínio existentes.

`additionalOfCardId`, `endDate`, `paidAt`, `firstInvoiceId`, `Transfer.personId` e `Budget.thresholds` continuam no payload canônico e em `audit_logs.after_data`; testes de round-trip verificam sua preservação. Não foram criadas colunas para eles. O estado pago da fatura continua refletido em `record.status`.

### Contratos auditados

Os 14 endpoints de escrita são cobertos. A lista a seguir contém todos os acessos diretos do arquivo versionado, incluindo auditoria e exclusões.

Campos comuns para people, categories, accounts, cards, recurrences, invoices, transactions, budgets, transfers e installment_groups:

`id, workspace_id, owner_user_id, scope, created_at, created_by, updated_at, updated_by, version, sync_status`.

| Endpoint sync | Campos adicionais aos comuns |
| --- | --- |
| people | name, linked_user_id, monthly_spending_limit_enabled, monthly_spending_limit, allowed_category_ids, active |
| categories | name, icon, type, active |
| accounts | name, institution, type, owner_person_id, active, notes |
| cards | name, bank, brand, last4_digits, total_limit, closing_day, due_day, owner_person_id, account_id, active, notes |
| recurrences | name, amount, type, category_id, person_id, account_id, card_id, notes, frequency, custom_interval_value, custom_interval_unit, start_date, next_occurrence_date, auto_confirm, active |
| invoices | card_id, cycle_month, closing_date, due_date, status |
| transactions | name, amount, type, status, transaction_date, competence_date, category_id, person_id, account_id, card_id, invoice_id, recurrence_id, installment_group_id, notes, payment_mode, occurrence_key, installment_number, installment_total |
| budgets | name, category_id, person_id, amount, reference_month, active |
| transfers | from_account_id, to_account_id, amount, transfer_date, notes |
| installment_groups | name, total_amount, installment_count, start_date, category_id, person_id, account_id, card_id, notes, active |

Contratos completos das demais entidades:

| Endpoint sync | Todos os campos acessados |
| --- | --- |
| workspace | id, name, created_by |
| workspace_members | id, workspace_id, user_id, role, active |
| preferences | id, workspace_id, user_id, notifications_enabled, notice_types, invoice_days, recurrence_days, installment_days, income_days, attachment_max_mb, scope, owner_user_id |
| attachments | id, workspace_id, owner_user_id, created_at, created_by, entity_type, entity_id, filename, mime_type, size_bytes, active, scope |

### Outbox, exclusões e testes

A correção acontece no envio, incluindo operações já persistidas: não é necessário limpar IndexedDB ou recriar dados. `delete`, `purge` e `restore` preservam `scope` e `owner_user_id`. A recuperação existente de snapshots de exclusão antigos permanece intacta. Falhas mantêm o lançamento, a operação malsucedida e as operações posteriores; apenas IDs explicitamente confirmados são removidos. O bootstrap não substitui alterações pendentes.

Os testes de contrato exercitam os envelopes das cinco ações para todas as entidades. Isso não adiciona ações novas ao backend: workspace/membership continuam sem um ramo de exclusão por `action`.

Validação local desta revisão:

- `npm run typecheck`: passou.
- `npm test`: 151 testes passaram, incluindo 99 de mapper/contrato.
- `npm run build`: passou; avisos existentes de tamanho de bundle/importação dinâmica.
- `npm run test:e2e`: 2 testes Chrome passaram, no build em `http://127.0.0.1:4173`, desktop 1280×720 e verificação de largura em 390×844.
- O servidor simulado do E2E agora rejeita JSON sem qualquer chave acessada pelo XanoScript, reproduzindo o erro original em vez de aceitar qualquer payload.
- Cobertura: transação mínima `Teste Sync`/100 centavos, relações preenchidas, parcelas, recorrências, orçamentos, transferências, metadados, serialização, defaults, campos exclusivos do payload, falha/reenvio de outbox antiga, offline, sessão expirada e tentativa manual. O teste de navegador também verifica ausência de erros de runtime.

**Limite da evidência:** esses testes de gravação usam Xano simulado. A consulta ao OpenAPI real confirma nomes e nulabilidade, mas não executa XanoScript, não prova conversão de timestamps ISO pelo runtime e não prova que o script publicado seja idêntico ao versionado. A aba de produção inspecionada ainda exibia o erro original e 50 pendências; ela não havia recebido este build. Nenhum dado ou token dessa sessão foi extraído ou alterado.

### Aplicação e condição para a Fase 2

Esta correção não exige mudança manual de schema ou importação de XanoScript. É necessário disponibilizar o frontend corrigido, atualizar o app preservando IndexedDB e executar a sincronização com a sessão normal do BS Wallet. Confirmar o mesmo UUID da transação no Xano/bootstrap e a confirmação das pendências, além das entidades relacionadas, antes de iniciar convites.

A Fase 2 não foi implementada nesta revisão, pois a validação de gravação no backend real ainda está pendente. Nenhum schema, endpoint, serviço ou UI de convite foi alterado; testes de aceite e isolamento entre dois navegadores ainda não foram executados.

Na retomada, reconciliar o schema existente antes de migrar. Além das regras de membership solicitadas, a revisão identificou que os endpoints financeiros consultam registro existente por ID sem comparar explicitamente seu workspace/proprietário com o ator e o workspace autorizado antes de editar/excluir. Corrigir essa autorização no backend antes de habilitar o fluxo multiusuário; validar apenas o `scope`/proprietário enviado pelo cliente não é suficiente.
