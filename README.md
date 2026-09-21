# BS Wallet

## Abrir o app no seu computador

No Explorador de Arquivos, abra [Iniciar host.cmd](C:/Users/joseph/Documents/__BS%20Wallet/Iniciar%20host.cmd) com dois cliques. Ele inicia o host local e abre o BS Wallet em `http://127.0.0.1:5173/`.

Na primeira execução, o atalho instala as dependências necessárias. A janela **BS Wallet - host local** permanece aberta enquanto o app estiver disponível; feche-a para parar o host.

## Acessar por outro dispositivo da rede

Com o host aberto neste computador, conecte o outro dispositivo à mesma rede Wi-Fi ou cabeada e abra `http://10.10.10.192:5173/`. Se o Windows perguntar sobre acesso de rede para o Node.js, permita somente em **redes privadas**. Caso a página não abra, libere a porta TCP 5173 no Firewall do Windows para redes privadas.

O endereço libera apenas a interface do app. Como esta versão guarda os dados em IndexedDB no próprio navegador, cada dispositivo terá seus próprios usuários e registros. Para compartilhar os mesmos dados com segurança entre dispositivos, é necessário publicar o backend Xano planejado em [docs/XANO.md](docs/XANO.md).

Aplicativo financeiro pessoal e familiar, em português do Brasil, que funciona antes de tudo no dispositivo. A primeira versão registra dados em IndexedDB e deixa a sincronização remota isolada em um adapter para uma futura conexão com Xano.

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
                         SyncAdapter futuro → Xano
```

As regras de centavos, fatura, parcelamento, orçamento e recorrência estão em `src/domain`; elas não ficam nos componentes visuais. A documentação de integração planejada está em [docs/XANO.md](docs/XANO.md).

## Segurança e limites da versão local

As senhas são derivadas com PBKDF2 e não são guardadas em texto puro. Esta versão não envia dados a servidor nem inclui recuperação real de senha por e-mail. O armazenamento do navegador não substitui criptografia de ponta a ponta: proteja o perfil do navegador e mantenha backups privados atualizados.

## GitHub e Lovable

O fluxo de publicação privada e a migração para Lovable estão em [docs/GITHUB-LOVABLE.md](docs/GITHUB-LOVABLE.md). O Lovable cria e conecta seu próprio repositório; ele não importa um repositório GitHub existente diretamente.
