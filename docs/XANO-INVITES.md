# Convites multiusuário — contrato e implantação Xano

## Estado da implantação — concluída em 05/10/2026

**Backend publicado e validado na instância real**: os oito endpoints de convites (IDs Xano 1815–1822) e os 15 endpoints de sincronização revisados foram compilados e publicados pelo editor. Request History está desabilitado nos oito endpoints de convites. Nenhuma tabela, coluna, índice ou ID precisou ser recriado; o schema exigido já existia.

Validação real com contas normais e authTokens independentes: **19 verificações passaram, nenhuma falhou e uma foi pulada**. Foram confirmados criação/listagem/resolução, cadastro do destinatário após o convite, TTL de sete dias, regeneração invalidando o token anterior, revogação, recusa, replay rejeitado, permissões concedidas e isolamento shared/private inclusive na auditoria. Tentativas de manipular UUID de outro workspace e dados privados foram rejeitadas. Listagens e auditoria não expõem token nem hash.

Os testes concorrentes reais confirmaram create/create com somente um convite válido, accept/accept com somente uma membership e accept/revoke com somente uma transição vencedora. O índice unique e a trava transacional foram exercitados na instância, além da cobertura mock.

A passagem real dos sete dias até a expiração **não foi aguardada**: esse único cenário foi pulado no teste remoto. A duração de sete dias foi verificada no expires_at real e a rejeição de convite expirado tem cobertura mock. As comparações temporais dos endpoints foram exercitadas com convites válidos, sem erro de tipo.

As duas incompatibilidades descobertas durante a execução real foram corrigidas e retestadas: converter now antes de somar a duração e usar SHA-256 com raw=false para gravar hexadecimal na coluna text. Os arquivos versionados refletem as correções publicadas.

**Não há passo manual pendente no painel Xano desta instância.** As instruções operacionais abaixo são referência para futuras instalações ou atualizações; não indicam trabalho pendente desta entrega. A publicação e validação do frontend são registradas no relatório da tarefa.

## Schema real reconciliado em 05/10/2026

As duas tabelas já existem na branch v1/live e **não devem ser recriadas**. Nenhum ID ou registro precisa ser apagado ou substituído.

`workspace_members` possui `permissions: text[]?`, `joined_at: timestamp?`, `invited_by: uuid?` e índice **unique composto `(workspace_id, user_id)`**. O papel remoto Master chama-se `admin_master`; no domínio do frontend é `master_admin`.

`workspace_invites` (#209, inicialmente vazia) possui: `id: uuid`, `created_at`, `updated_at`, `workspace_id: uuid`, `email: email` (trim/lower), `invited_by: uuid`, `role: admin|member`, `permissions: text[]?`, `status: pending|accepted|declined|revoked|expired`, `token_hash: text`, `expires_at`, `accepted_at?`, `accepted_user_id?`, `declined_at?`, `revoked_at?`, `revoked_by?`, `last_sent_at?`, `send_count: int=1`. Há índice unique em `token_hash` e índices de consulta, inclusive `(workspace_id,email)` não único.

Em instalações antigas, adicionar somente as três colunas ausentes de membros, criar o índice composto após auditar duplicatas e adicionar a tabela de convites com esses campos. Não corrigir duplicatas apagando registros automaticamente. Na instalação atual, a migração é apenas publicar os endpoints; o schema já está completo.

## Endpoints

Base: BS Wallet (`api:A-AE1sTc`). Fonte: `xano/bs_wallet_invites.xs`; cada bloco `query` entre separadores é um endpoint independente.

| Método e caminho | Entrada | Resposta |
| --- | --- | --- |
| POST workspace/invites/create | workspace_id, email, role, permissions | {invite: InviteSafe, token} |
| GET workspace/invites/pending | nenhuma | InviteSafe[] com workspace_name |
| POST workspace/invites/resolve | token | {valid:false} ou {valid:true,workspace_name,role,masked_email,expires_at} |
| POST workspace/invites/accept | token **ou** invite_id | {ok:true,workspace_id,membership_id} |
| POST workspace/invites/decline | token **ou** invite_id | {ok:true} |
| GET workspace/invites/list | workspace_id na query string | InviteSafe[] |
| POST workspace/invites/revoke | invite_id | {ok:true} |
| POST workspace/invites/regenerate | invite_id | {invite:InviteSafe,token} |

Todos exigem `Authorization: Bearer <authToken>` normal do usuário, exceto `resolve`. Nenhum endpoint aceita identidade do autor ou e-mail de consulta arbitrário. `InviteSafe` contém somente `id, workspace_id, email, role, permissions, status, created_at, updated_at, expires_at, accepted_at, send_count`. Timestamps são milissegundos Unix do Xano; o frontend normaliza para ISO. Nenhuma resposta de listagem ou auditoria contém hash ou token.

O pendente sem link usa `invite_id` e a conta autenticada: o servidor carrega `user.email` via `$auth.id`, normaliza e exige correspondência exata com o convite. O UUID não concede acesso sozinho. Enviar token e invite_id juntos é inválido. Token nunca é recuperado do banco; somente create/regenerate o retornam uma vez.

Convite expirado é inválido independentemente de a coluna status ainda conter pending. A listagem projeta status expired. Regenerar ou revogar requer pending ainda válido; um expirado exige novo convite. Conta com vínculo existente, inclusive desativado, não recebe membership nova; a administração deve tratar o vínculo original, preservando seu ID.

## Autorização e concorrência

O Master concede admin/member. Outros usuários precisam de `members.manage`, só concedem member e apenas capabilities que possuem. `[]` é restrição explícita; somente null usa defaults legados: Master recebe todas as capabilities existentes, admin/member recebem shared.read, shared.create, transactions.editOwn, attachments.read, reports.read. O aceite revalida autorização e delegação do convidador para impedir aceitar um privilégio que ele já perdeu.

Criação, aceite, recusa, revogação, regeneração e sync de membros usam `db.transaction`. Antes de consultar o estado definitivo, um `db.edit workspace` de updated_at adquire a trava da linha do workspace; todas as mutações seguem a mesma ordem. Após obter essa trava, os endpoints relêem convite/membership e validam pending, expiração, e-mail e hash corrente. Isso serializa a disputa por convite e impede create simultâneo equivalente, accept/decline/revoke concorrentes e aceite do token anterior após regeneração. O índice unique de membership é a garantia adicional contra duplicatas.

O comportamento da trava decorre das transações PostgreSQL do Xano e foi confirmado pelo teste concorrente desta instância; repetir a validação em futuras instalações. Não substituir por uma simples consulta prévia fora da transação. Como a documentação Xano diz que somente falhas de banco determinam rollback, todas as precondições ficam antes das alterações de negócio. Uma requisição rejeitada pode tocar somente updated_at do workspace usado como trava; membership, convite e audit são gravados juntos depois das validações.

`sync/workspace_members` aceita criação somente do Master inicial, pelo próprio criador de um workspace ainda sem membros. Outros membros precisam aceitar convite. Atualizações preservam id/user_id/workspace_id; Master e proprietário não podem ser alterados/desativados (reenvio de bootstrap pelo próprio Master é no-op que preserva o registro existente); não-Master não altera admin, o próprio vínculo nem delega capacidades superiores. Auditoria usa perfil consultado no servidor, não payload arbitrário de membro.

Os 12 endpoints financeiros consultam o registro existente e validam workspace/owner e acesso aos escopos atual e novo antes de qualquer update/delete/auditoria, além da identidade do envelope e do payload canônico. Escritas shared exigem capabilities existentes conforme operação. Mudanças de escopo continuam permitidas para transações simples e transferências próprias, com autorização nos dois escopos; séries, parcelas e cadastros preservam escopo. A ação import e status_change existentes permanecem aceitas. A trava de workspace permite reler membership após revogações. `sync/bootstrap` conserva `scope == shared OR owner_user_id == $auth.id`, acrescentando shared.read para itens shared; auditoria de convites só aparece para quem pode gerenciar membros.

## Tokens e logs

`security.random_bytes {length=32}` gera 256 bits aleatórios. `bin2hex` produz token de URL com 64 caracteres; `sha256:false` (raw=false) calcula o único valor persistido em token_hash. Expiração padrão: `now|to_timestamp|add_secs_to_timestamp:604800` (7 dias). O literal now precisa ser convertido antes de aritmética; a soma direta foi rejeitada pela instância com Not numeric e corrigida após teste real. Regenerar troca hash e incrementa send_count. Audit registra invite_create, invite_accept, invite_decline, invite_revoke, invite_regenerate, member_permissions_update e member_disable com projeções seguras.

**Request History desabilitado nos oito endpoints de convites por `history = false`**, sintaxe confirmada no editor da instância em 05/10/2026. Não executar debug.log, log de input/output ou captura completa de requisições nesses endpoints. A configuração está incluída no XanoScript e deve permanecer desabilitada ao publicar. Evitar logs do caminho /convite/TOKEN no hosting frontend. Não salvar token em outbox, IndexedDB, localStorage, audit ou analytics. Nenhum serviço de e-mail é usado.

## Ordem de publicação e validação para futuras instalações

1. Conferir schema/índices existentes sem recriação.
2. Desabilitar logs dos endpoints de convites; importar e compilar seus oito blocos query.
3. Publicar alterações de `sync/workspace_members`, `sync/workspace`, bootstrap e endpoints financeiros do arquivo principal.
4. Testar com authTokens comuns A/B/C: convite existente e cadastro posterior; aceitar em outra sessão; errado, expirado, revogado, regenerado e replay; permissões escolhidas e convite pending por ID; delegação e payloads manipulados contra sync/members.
5. Disparar simultaneamente dois accepts e accept/revoke, além de create/create e regenerate/accept: somente uma transição válida e uma membership; conferir audit sem segredo.
6. Conferir shared A→B e private A invisível para B tanto nas tabelas como em audit/trash; tentar update/delete de UUID existente de outro workspace e exigir rejeição sem alterações.
7. Publicar frontend e rodar typecheck, testes, build e fluxo em dois navegadores. Testes mock do frontend não substituem execução Xano real.

## Importação pelo painel para futuras atualizações

Os arquivos individuais para colar no editor foram preparados em `xano-import` nos artefatos locais da tarefa, com manifesto de endpoint, método, tamanho e SHA-256. O arquivo-fonte versionado continua sendo cada bundle em `xano/`.

O import multidoc documentado para workspace existente usa CLI/Metadata API e requer credencial administrativa do workspace; a identidade de atualização é o guid. O painel documenta Upload File multidoc para **criar outro workspace**, o que não serve para esta migração. Não aplicar nossos bundles sem guid como substituição integral nem recriar tabelas. A publicação pelo editor de cada endpoint preserva as identidades existentes e permite revisar os diagnósticos de compilação.

## Referências oficiais verificadas

- [Segurança: random_bytes e UUID](https://docs.xano.com/xanoscript/function-reference/security)
- [Filtros SHA-256](https://docs.xano.com/xanoscript/filter-reference/security)
- [bin2hex e conversões](https://docs.xano.com/xanoscript/filter-reference/transform)
- [db.get/query/add/edit e transações](https://docs.xano.com/xanoscript/function-reference/database-operations)
- [Limite de rollback em transações Xano](https://docs.xano.com/the-function-stack/functions/database-requests/database-transaction)
- [Schemas e índices únicos compostos](https://docs.xano.com/xanoscript/db)
- [Filtros de arrays e projeção pick](https://docs.xano.com/xanoscript/filter-reference/array)

- [Multidoc: importação, identidade guid e autenticação](https://docs.xano.com/xanoscript/multidoc)

- [Aritmética de timestamps documentada](https://docs.xano.com/xanoscript/filter-reference/timestamp)

### Parâmetro SHA-256 da instância

A página textual XanoScript descreve o argumento como hex_output, mas a [documentação visual oficial de filtros de segurança](https://docs.xano.com/the-function-stack/filters/security) mostra o campo **raw: boolean**, cujo valor false retorna texto hexadecimal. Usamos `sha256:false` em create, regenerate, resolve, accept e decline. A tentativa com true falhou no PostgreSQL com SQLSTATE 22021 (CHARACTER NOT IN REPERTOIRE), consistente com bytes binários em token_hash text. A versão com raw=false passou posteriormente no create/resolve/accept/regenerate real, confirmando a compatibilidade da instância. Não reintroduzir true com base no exemplo textual invertido; validar hashes por SHA-256 local do token durante o teste real, sem imprimir token/hash.
