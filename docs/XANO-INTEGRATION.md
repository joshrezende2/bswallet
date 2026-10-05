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
- `workspace_members` ainda não possui a lista de `permissions` do domínio. O backend aplica isolamento por workspace/escopo e restringe administração de workspace/membros por papel, mas a paridade completa de capabilities exige acrescentar esse campo ao schema remoto.
- `attachments` sincroniza os metadados nesta etapa; o upload/download do Blob para `file` deve ser implementado em um endpoint multipart separado antes de considerar anexos disponíveis entre dispositivos.

## Regra de segurança

Nenhuma chave administrativa Xano deve ser colocada em `VITE_*`. O navegador usa somente token de usuário emitido pelo grupo `Authentication`. Endpoints de sync validam associação ao workspace e propriedade para dados privados.
