# BS Wallet

## Abrir o app no seu computador

No Explorador de Arquivos, abra [Iniciar host.cmd](C:/Users/joseph/Documents/__BS%20Wallet/Iniciar%20host.cmd) com dois cliques. Ele inicia o host local e abre o BS Wallet em `http://127.0.0.1:5173/`.

Na primeira execução, o atalho instala as dependências necessárias. A janela **BS Wallet - host local** permanece aberta enquanto o app estiver disponível; feche-a para parar o host.

## Acessar por outro dispositivo da rede

Com o host aberto neste computador, conecte o outro dispositivo à mesma rede Wi-Fi ou cabeada e abra `http://10.10.10.192:5173/`. Se o Windows perguntar sobre acesso de rede para o Node.js, permita somente em **redes privadas**. Caso a página não abra, libere a porta TCP 5173 no Firewall do Windows para redes privadas.

O endereço libera apenas a interface do app. Como esta versão guarda os dados em IndexedDB no próprio navegador, cada dispositivo terá seus próprios usuários e registros. A versão de produção inclui as URLs públicas do Xano. Conecte a mesma conta em Ajustes → Sincronização para enviar e receber registros.

Aplicativo financeiro pessoal e familiar, em português do Brasil, que funciona antes de tudo no dispositivo. Os dados são salvos em IndexedDB e enviados ao Xano em segundo plano quando a conta está conectada.

## O que já funciona

- contas locais com cadastro, login e sessão persistente;
- carteira pessoal e compartilhada, Master Admin, membros e capabilities;
- contas, pessoas, categorias, cartões, faturas e limites;
- receitas, despesas, transferências, parcelas e recorrências;
- orçamento mensal, histórico pesquisável, auditoria, lixeira e anexos;
- backup JSON, importação validada e exportação CSV, Excel e PDF;
- tema claro/escuro e PWA com cache offline.

O valor exibido como saldo é sempre o valor registrado no BS Wallet. Ele não consulta nem representa saldo bancário confirmado.

## Rodar localmente

Requer Node.js 22.12 ou superior.

```powershell
npm install
npm run dev
```

Abra `http://127.0.0.1:5173`. Em desenvolvimento, o botão **Explorar demonstração local** cria dados fictícios que podem ser removidos em Ajustes.

## Verificações

```powershell
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

## Arquitetura

```text
UI React → serviços de domínio → repositório local Dexie/IndexedDB
                                      ↓
                             fila de alterações local
                                      ↓
                         Outbox → syncWallet → Xano
```

As regras de centavos, fatura, parcelamento, orçamento e recorrência estão em `src/domain`; elas não ficam nos componentes visuais. O contrato de endpoints está em `xano/bs_wallet_endpoints.xs`; o planejamento histórico está em [docs/XANO.md](docs/XANO.md).

## Segurança e limites da versão local

As senhas são derivadas com PBKDF2 e não são guardadas em texto puro. Quando habilitada, a sincronização envia dados ao Xano após autenticação. Recuperação por e-mail e upload/download dos arquivos anexados ainda não estão implementados pelos endpoints atuais; apenas metadados de anexos são sincronizados. O armazenamento do navegador não substitui criptografia de ponta a ponta: proteja o perfil do navegador e mantenha backups privados atualizados.

## GitHub e Lovable

O fluxo de publicação privada e a migração para Lovable estão em [docs/GITHUB-LOVABLE.md](docs/GITHUB-LOVABLE.md). O Lovable cria e conecta seu próprio repositório; ele não importa um repositório GitHub existente diretamente.

## Sincronização e publicação

O build de produção lê `.env.production`, que contém somente `VITE_XANO_SYNC_ENABLED=true` e as URLs públicas das APIs. Credenciais, tokens e chaves administrativas nunca entram nesse arquivo. Para desenvolvimento, copie-o para `.env.local` (ignorado pelo Git); os testes unitários forçam a integração real desligada.

Em **Ajustes → Sincronização**, conecte a conta com sua senha. O UUID remoto deve corresponder ao local: identidades divergentes são informadas, sem substituir IDs nem apagar pendências. Sessão expirada permite reconectar na mesma tela. Uma falha temporária mantém os dados e a outbox; o app tenta novamente ao recuperar a internet, a cada minuto e manualmente. Alterações durante um envio disparam outra rodada sem concorrência no mesmo workspace/aba.

Salvar alterações no Git local não atualiza `bswallet.lovable.app`. É preciso enviar a branch ao repositório conectado ao Lovable e publicar a versão atualizada lá. Uma versão já instalada como PWA oferece a ação de atualização quando o novo build estiver publicado. Não limpe o IndexedDB para atualizar o aplicativo.

Validação local: `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e`. Os testes de navegador usam Chrome e um Xano simulado, sem enviar dados de teste ao servidor real. A aceitação final no servidor requer uma sessão real e a confirmação do mesmo UUID em `transactions`.