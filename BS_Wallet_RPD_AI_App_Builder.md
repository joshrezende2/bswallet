# RPD — BS Wallet
## Especificação completa para AI App Builder

**Versão:** 1.1  
**Idioma da aplicação:** Português do Brasil (pt-BR)  
**Moeda do MVP:** Real brasileiro (BRL / R$)  
**Plataformas-alvo:** Android, iPhone e Web/PWA  
**Modelo:** Offline-first, com persistência local e arquitetura preparada para sincronização em nuvem  
**Status do backend:** Não definido; a V1 deve funcionar localmente e não pode depender de um backend específico  
**Cor primária da identidade visual:** `#008847`  

---

# 1. Instrução principal para o App Builder

Crie uma aplicação chamada **BS Wallet**, destinada ao **controle financeiro pessoal e familiar**, tomando este documento como fonte de verdade funcional e técnica.

O aplicativo deve preservar os conceitos centrais do protótipo anterior — Resumo mensal, Recorrências, Cartões, Histórico, Ajustes, Categorias, Pessoas, despesas, recebimentos e parcelamentos — porém deve modernizar a arquitetura, o modelo de dados, a interface e as regras financeiras.

Não invente regras de negócio que contradigam este documento. Quando existir uma decisão não especificada, adote a solução mais conservadora, reversível e compatível com um aplicativo financeiro offline-first. Evite acoplamento desnecessário a um fornecedor específico.

A aplicação deve ser utilizável na V1 mesmo sem internet. Operações feitas offline devem ser persistidas imediatamente no dispositivo. A arquitetura deve permitir adicionar posteriormente sincronização com um banco de dados remoto sem reescrever as regras de negócio ou as telas principais.

Não utilize `localStorage` como banco principal em produção. Utilize uma camada de persistência local apropriada à plataforma, como SQLite em aplicativos móveis/desktop ou IndexedDB no navegador/PWA, ou a alternativa equivalente oferecida pelo App Builder. `localStorage` só pode ser utilizado para preferências não críticas se necessário.

Não armazene senhas em texto puro, não hardcode usuário/senha e não armazene número completo de cartão de crédito. Para cartões, guardar apenas dados de identificação necessários ao controle financeiro, como nome, banco, bandeira e últimos quatro dígitos.

---

# 2. Visão do produto

O BS Wallet é um aplicativo pessoal/familiar para registrar, organizar e acompanhar despesas, receitas, compras parceladas, recorrências, cartões, contas, pessoas e orçamentos mensais.

O foco da primeira versão não é conciliação bancária nem Open Finance. O aplicativo deve funcionar principalmente como um **registrador financeiro estruturado**, permitindo que um casal ou família entenda onde, quando, com quem e em qual cartão/conta o dinheiro foi gasto ou recebido.

O aplicativo deve atender inicialmente um grupo familiar pequeno, mas o modelo de dados não deve assumir exatamente duas pessoas.

Deve existir uma **conta familiar/workspace** com um **Administrador Master**, que poderá convidar ou cadastrar outros usuários e conceder direitos administrativos. Outros administradores nunca poderão remover, substituir ou rebaixar o Administrador Master.

O sistema deve suportar simultaneamente:

- dados pessoais/privados de um usuário;
- dados compartilhados com a família;
- configuração do Administrador Master determinando quais áreas e dados serão compartilhados;
- pessoas cadastradas que podem ou não possuir uma conta de usuário própria.

---

# 3. Objetivos da V1

A V1 deve permitir que o usuário:

1. cadastre e autentique sua conta;
2. crie uma estrutura familiar com Administrador Master;
3. registre despesas e receitas;
4. classifique os lançamentos por categoria, pessoa, cartão e/ou conta;
5. registre compras parceladas respeitando o fechamento da fatura do cartão;
6. controle despesas e receitas recorrentes;
7. acompanhe faturas atuais e futuras dos cartões;
8. visualize resumo mensal com receitas, despesas e saldo do período;
9. pesquise e filtre o histórico;
10. mantenha múltiplos cartões, contas e pessoas;
11. defina orçamentos mensais e receba alertas por percentual consumido;
12. anexe comprovantes, imagens e PDFs a lançamentos;
13. transfira valores entre contas sem classificar a transferência como receita ou despesa;
14. mantenha histórico de alterações;
15. recupere itens excluídos por até 30 dias;
16. exporte dados e relatórios;
17. funcione offline;
18. esteja preparada para sincronização futura em nuvem.

---

# 4. Escopo por versão

## 4.1 V1 obrigatória — MVP utilizável

Implementar:

- login com e-mail ou username + senha;
- cadastro com e-mail + senha e definição de username;
- sessão persistente;
- fluxo de recuperação de senha;
- Administrador Master, administradores e membros;
- carteira pessoal e carteira compartilhada/familiar;
- múltiplas contas;
- múltiplos cartões;
- categorias;
- pessoas;
- despesas;
- receitas;
- despesas únicas;
- receitas únicas;
- compras parceladas;
- recorrências com múltiplas frequências;
- faturas de cartão;
- dashboard básico;
- histórico com filtros;
- orçamentos mensais;
- anexos;
- transferências entre contas;
- histórico/auditoria de alterações;
- lixeira com recuperação por 30 dias;
- notificações definidas neste documento;
- tema claro/escuro;
- backup JSON;
- exportações CSV/Excel/PDF;
- modo offline;
- arquitetura preparada para sincronização remota.

## 4.2 V1 desejável / V1.x

Priorizar após a V1 estável:

- sincronização real em nuvem após definição do backend;
- backup automático em nuvem;
- resolução de conflitos de sincronização;
- notificações push remotas;
- telas de análise mais completas;
- importação estruturada de CSV/Excel;
- atalhos e ações rápidas em mobile.

## 4.3 V2 futura

Não bloquear a arquitetura para estas funções, mas não tratá-las como requisito obrigatório da V1:

- metas financeiras, por exemplo viagem, notebook e reserva de emergência;
- orçamento disponível avançado;
- previsão de saldo no fim do mês;
- evolução de 6 e 12 meses;
- despesas comparativas por pessoa;
- comparação com mês anterior;
- login Google;
- login Apple;
- PIN local;
- biometria;
- integração bancária/Open Finance;
- múltiplas moedas;
- conciliação bancária automática.

---

# 5. Conceitos principais

## 5.1 Workspace familiar

O agrupador principal dos dados compartilhados deve ser chamado internamente de `workspace` ou equivalente.

Cada workspace possui:

- `id`;
- nome;
- Administrador Master;
- membros;
- configurações de compartilhamento;
- data de criação;
- preferências gerais.

## 5.2 Carteira/escopo dos dados

Cada lançamento e entidade financeira relevante deve possuir um escopo:

- `personal`: visível apenas para o proprietário, salvo permissão explícita;
- `shared`: visível aos membros autorizados do workspace.

O Administrador Master deve poder definir o padrão do workspace e as permissões de compartilhamento.

## 5.3 Pessoa x usuário

**Usuário** é alguém que pode efetuar login.

**Pessoa** é alguém usado para atribuir gastos, receitas, cartões, contas e limites.

Uma Pessoa pode:

- estar vinculada a um usuário;
- existir sem usuário próprio;
- possuir cartões;
- possuir contas;
- possuir limite mensal;
- participar da carteira compartilhada;
- ter categorias permitidas, caso a família utilize essa restrição.

Não obrigar toda Pessoa a possuir login.

---

# 6. Papéis e permissões

## 6.1 Administrador Master

O primeiro proprietário do workspace é o Administrador Master.

Pode:

- gerenciar membros;
- conceder/remover papel de Administrador;
- configurar compartilhamento;
- visualizar e administrar dados compartilhados;
- administrar categorias compartilhadas;
- administrar pessoas, cartões e contas compartilhadas;
- configurar orçamentos compartilhados;
- restaurar itens da lixeira quando possuir acesso ao item;
- alterar configurações gerais.

Não pode ser removido ou rebaixado por outro Administrador.

Uma futura transferência de propriedade deverá exigir ação explícita do próprio Master e não faz parte do MVP se não for necessária.

## 6.2 Administrador

Pode receber permissões administrativas do Master, mas não pode:

- remover o Master;
- rebaixar o Master;
- transferir a propriedade principal;
- acessar dados pessoais privados de outro usuário sem permissão.

## 6.3 Membro

Pode usar o aplicativo e atuar conforme as permissões definidas pelo Master/Admin.

No mínimo deve ser possível controlar se o membro pode:

- visualizar carteira compartilhada;
- criar lançamentos compartilhados;
- editar lançamentos próprios;
- editar lançamentos de outros membros;
- excluir lançamentos;
- visualizar anexos;
- administrar cartões/contas/categorias;
- visualizar relatórios compartilhados.

---

# 7. Navegação principal

Preservar a estrutura geral do protótipo, modernizando a experiência.

A navegação principal mobile deve possuir barra inferior com cinco destinos:

1. **Resumo**
2. **Recorrências**
3. **Cartões**
4. **Histórico**
5. **Ajustes**

Orçamentos, Contas, Pessoas, Categorias, Lixeira, Exportações e demais configurações podem ficar dentro de Ajustes ou ser acessados contextualmente.

Em telas maiores, a mesma arquitetura pode ser apresentada em sidebar, mantendo os mesmos destinos e nomes.

Deve existir um botão de ação principal de fácil acesso para **Adicionar lançamento**.

---

# 8. Autenticação

## 8.1 Cadastro

Campos mínimos:

- nome;
- e-mail;
- username;
- senha;
- confirmação de senha.

Regras:

- e-mail deve ser válido;
- username deve ser único dentro do sistema de autenticação;
- username não diferencia maiúsculas/minúsculas para login;
- normalizar espaços;
- senha deve respeitar política mínima segura definida pelo provedor;
- não persistir senha em texto puro.

## 8.2 Login

Um único campo deve aceitar:

- e-mail; ou
- username.

Segundo campo:

- senha.

Deve existir opção de manter sessão persistente.

## 8.3 Recuperação de senha

Implementar tela e fluxo por e-mail.

Como o backend ainda não foi escolhido, utilizar uma camada abstrata `AuthProvider`.

Se o App Builder possuir serviço seguro de autenticação/e-mail, utilizá-lo.

Se estiver executando somente em modo local/protótipo e não houver serviço capaz de enviar e-mail, não simular envio como se fosse real. Manter a interface pronta e indicar no ambiente de desenvolvimento que a recuperação real depende do provedor de autenticação.

---

# 9. Modelo offline-first e sincronização futura

## 9.1 Regra principal

Toda ação do usuário deve funcionar primeiro contra a base local.

Fluxo:

`UI -> Service/Use Case -> Repository -> Local Database`

Quando existir backend:

`Local Database -> Sync Queue/Outbox -> Sync Adapter -> Remote API`

A UI não deve chamar diretamente APIs externas.

## 9.2 IDs

Gerar IDs no cliente usando UUID ou identificador global equivalente. Não depender de ID incremental de servidor.

Isso permitirá criar dados offline e sincronizá-los posteriormente sem recriar registros.

## 9.3 Metadados recomendados

Entidades sincronizáveis devem possuir, quando aplicável:

- `id`;
- `workspaceId`;
- `ownerUserId`;
- `scope`;
- `createdAt`;
- `createdBy`;
- `updatedAt`;
- `updatedBy`;
- `version`;
- `syncStatus` (`local`, `pending`, `synced`, `conflict`);
- `lastSyncedAt`.

## 9.4 Conflitos futuros

Para dados financeiros críticos, não sobrescrever silenciosamente duas alterações concorrentes quando houver dúvida.

Guardar versão e data de alteração. Quando não for possível resolver automaticamente com segurança, exibir conflito para o usuário escolher a versão correta.

---

# 10. Modelo de dados

O App Builder pode adaptar nomes ao banco escolhido, mas deve preservar os relacionamentos e significados.

## 10.1 User

Campos principais:

- `id`
- `name`
- `email`
- `username`
- `avatarUrl?`
- `status`: active/inactive
- `createdAt`
- `updatedAt`

Credenciais não devem fazer parte do modelo comum se o provedor de autenticação já as gerenciar.

## 10.2 Workspace

- `id`
- `name`
- `masterAdminUserId`
- `defaultScope`: personal/shared
- `createdAt`
- `updatedAt`

## 10.3 WorkspaceMember

- `id`
- `workspaceId`
- `userId`
- `role`: master_admin/admin/member
- `permissions`
- `status`: invited/active/disabled
- `joinedAt?`
- `createdAt`
- `updatedAt`

## 10.4 Person

- `id`
- `workspaceId`
- `linkedUserId?`
- `name`
- `scope`
- `monthlySpendingLimitEnabled`
- `monthlySpendingLimit?`
- `allowedCategoryIds?`
- `active`
- `createdAt`
- `updatedAt`

## 10.5 Account

Representa conta bancária, conta digital, dinheiro/carteira ou outro local lógico de movimentação.

Campos:

- `id`
- `workspaceId`
- `ownerPersonId?`
- `name`
- `institution?`
- `type`: checking/savings/digital/cash/other
- `scope`
- `active`
- `notes?`
- `createdAt`
- `updatedAt`

**Importante:** na V1, o saldo desta conta não precisa representar saldo bancário real. O BS Wallet é um registrador financeiro. Caso exista um valor calculado, deve ser apresentado como valor registrado no app, não como saldo confirmado pelo banco.

## 10.6 Card

- `id`
- `workspaceId`
- `accountId?`
- `ownerPersonId`
- `additionalOfCardId?`
- `name`
- `bank`
- `brand`
- `last4Digits`
- `totalLimit`
- `closingDay`
- `dueDay`
- `active`
- `scope`
- `notes?`
- `createdAt`
- `updatedAt`

Derivados/calculados:

- limite utilizado;
- limite disponível;
- fatura atual;
- próximas faturas.

Nunca armazenar número completo do cartão, CVV ou senha.

## 10.7 Category

- `id`
- `workspaceId`
- `name`
- `icon`
- `type`: expense/income/both
- `scope`
- `active`
- `createdAt`
- `updatedAt`

## 10.8 Transaction

Entidade central.

- `id`
- `workspaceId`
- `ownerUserId`
- `scope`
- `type`: expense/income
- `status`: forecast/pending/confirmed/cancelled
- `name`
- `description?`
- `amount`
- `transactionDate`
- `competenceDate?`
- `categoryId`
- `personId?`
- `accountId?`
- `cardId?`
- `paymentMode`: single/installment/recurring
- `notes?`
- `installmentGroupId?`
- `installmentNumber?`
- `installmentTotal?`
- `recurrenceId?`
- `invoiceId?`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`

`amount` deve ser armazenado em formato monetário seguro, preferencialmente inteiro em centavos ou Decimal, evitando erros de ponto flutuante.

## 10.9 InstallmentGroup

- `id`
- `workspaceId`
- `originalAmount`
- `numberOfInstallments`
- `cardId`
- `purchaseDate`
- `firstInvoiceId`
- `createdAt`
- `updatedAt`

Serve para relacionar todas as parcelas de uma mesma compra.

## 10.10 CardInvoice

- `id`
- `workspaceId`
- `cardId`
- `cycleYear`
- `cycleMonth`
- `closingDate`
- `dueDate`
- `status`: open/closed/paid/overdue
- `paidAt?`
- `createdAt`
- `updatedAt`

O total da fatura deve ser calculado a partir dos lançamentos associados, não duplicado sem necessidade.

## 10.11 Recurrence

- `id`
- `workspaceId`
- `type`: expense/income
- `name`
- `amount`
- `categoryId`
- `personId?`
- `accountId?`
- `cardId?`
- `frequency`: weekly/biweekly/monthly/bimonthly/quarterly/semiannual/annual/custom
- `customIntervalValue?`
- `customIntervalUnit?`: day/week/month/year
- `startDate`
- `endDate?`
- `nextOccurrenceDate`
- `autoConfirm`: boolean
- `active`
- `scope`
- `createdAt`
- `updatedAt`

## 10.12 Budget

- `id`
- `workspaceId`
- `month`
- `year`
- `categoryId`
- `personId?`
- `limitAmount`
- `thresholds`: padrão 80, 90, 100
- `scope`
- `active`
- `createdAt`
- `updatedAt`

## 10.13 Transfer

- `id`
- `workspaceId`
- `fromAccountId`
- `toAccountId`
- `amount`
- `date`
- `personId?`
- `notes?`
- `scope`
- `createdAt`
- `updatedAt`

Transferências **não entram como receita nem despesa** nos indicadores financeiros.

## 10.14 Attachment

- `id`
- `workspaceId`
- `transactionId`
- `fileName`
- `mimeType`
- `size`
- `localUri`
- `remoteUri?`
- `checksum?`
- `createdAt`
- `createdBy`

Permitir inicialmente:

- JPEG/PNG/WebP;
- PDF;
- formatos de imagem equivalentes suportados pelo dispositivo.

## 10.15 AuditLog

- `id`
- `workspaceId`
- `entityType`
- `entityId`
- `action`: create/update/delete/restore/status_change
- `actorUserId`
- `timestamp`
- `beforeData?`
- `afterData?`

O log deve permitir exibir, por exemplo, que um lançamento foi alterado de R$ 79,90 para R$ 69,90, com usuário, data e hora.

## 10.16 TrashItem

Quando o usuário excluir um item recuperável:

1. copiar um snapshot do item para a lixeira;
2. remover o item da coleção/base ativa;
3. registrar `deletedAt`, `deletedBy` e `purgeAt`;
4. permitir restauração até `purgeAt`;
5. excluir definitivamente após 30 dias.

Campos:

- `id`
- `workspaceId`
- `entityType`
- `originalEntityId`
- `snapshot`
- `deletedAt`
- `deletedBy`
- `purgeAt`

Para sincronização futura, é aceitável manter tombstones técnicos mínimos necessários ao sync, sem reapresentar o item como ativo.

---

# 11. Regras de lançamentos

## 11.1 Tipos

Todo lançamento deve ser `expense` ou `income`.

## 11.2 Formas

Suportar:

- único;
- parcelado;
- recorrente.

## 11.3 Campos mínimos de lançamento

Tela de criação/edição deve conter:

- nome;
- valor;
- despesa ou recebimento;
- forma;
- data;
- categoria;
- pessoa opcional;
- conta opcional;
- cartão opcional;
- observações;
- anexos;
- escopo pessoal/compartilhado, quando aplicável.

## 11.4 Validações

- nome obrigatório;
- valor maior que zero;
- data obrigatória;
- categoria obrigatória;
- não permitir cartão inativo para novas compras;
- número de parcelas mínimo 2 quando parcelado;
- se a forma for cartão parcelado, cartão é obrigatório;
- anexos devem respeitar tamanho máximo configurável;
- valores devem ser exibidos em `R$ 1.234,56`.

---

# 12. Compras parceladas e faturas

Esta regra é crítica.

Ao registrar uma compra de **R$ 1.200 em 12x**, criar 12 parcelas relacionadas por `installmentGroupId`.

Dividir o valor com precisão em centavos. Se a divisão não for exata, distribuir os centavos restantes entre as primeiras parcelas para que a soma seja exatamente igual ao total original.

Exemplo:

- compra: R$ 1.200,00;
- parcelas: 12;
- cada parcela: R$ 100,00;
- parcelas numeradas 1/12 até 12/12.

## 12.1 Determinação da primeira fatura

A primeira parcela deve entrar na fatura determinada pelo fechamento do cartão.

Regra padrão:

- localizar a próxima data de fechamento aplicável à compra;
- se a compra ocorrer antes ou no dia de fechamento, por padrão ela pertence ao ciclo que fecha naquele mês;
- se ocorrer após o fechamento, pertence ao ciclo seguinte;
- permitir ajuste manual da fatura em casos excepcionais.

Quando o mês não possuir o dia configurado, utilizar o último dia válido daquele mês.

A data de vencimento da fatura deve ser a primeira ocorrência válida do `dueDay` posterior à data de fechamento do ciclo.

As parcelas seguintes devem ser colocadas nas faturas mensais subsequentes do mesmo cartão, e não simplesmente em `purchaseDate + N meses` sem considerar o ciclo de fatura.

## 12.2 Edição de parcelas

Permitir:

- editar uma parcela individual;
- editar propriedades comuns da série;
- deixar claro antes de salvar se a alteração afeta somente a parcela ou a série;
- excluir somente uma parcela;
- excluir a série completa.

Alterações devem gerar AuditLog.

## 12.3 Limite do cartão

`usedLimit` deve considerar compras/parcelas que ainda comprometem o limite segundo a regra definida no app.

No MVP, usar uma regra simples e consistente: o limite utilizado é a soma das parcelas futuras e não quitadas vinculadas ao cartão, mais valores de fatura em aberto, evitando dupla contagem.

Exibir:

- limite total;
- utilizado;
- disponível;
- percentual utilizado.

---

# 13. Recorrências

Suportar frequências:

- semanal;
- quinzenal;
- mensal;
- bimestral;
- trimestral;
- semestral;
- anual;
- intervalo personalizado.

## 13.1 Modelo de previsão + efetivação

O sistema deve criar/representar automaticamente a próxima ocorrência com status de **previsão**.

A ocorrência pode evoluir:

`forecast -> pending -> confirmed`

ou ser cancelada.

Configuração por recorrência:

- `autoConfirm = false` por padrão: o sistema gera previsão e o usuário confirma quando a despesa/receita realmente ocorrer;
- `autoConfirm = true`: a ocorrência pode ser efetivada automaticamente na data prevista, se essa opção estiver habilitada explicitamente.

Não duplicar ocorrências ao abrir o app múltiplas vezes.

Uma recorrência deve possuir identificador próprio e cada ocorrência deve apontar para esse identificador.

Permitir pausar e reativar recorrências.

---

# 14. Receitas

Receitas devem ter o mesmo nível de estrutura das despesas.

Permitir exemplos como:

- salário;
- salário de outro membro;
- freelance;
- reembolso;
- venda;
- rendimento;
- outros.

Permitir receita única ou recorrente.

O antigo conceito de “recebimento fixo mensal” deve ser migrado conceitualmente para uma receita recorrente, evitando uma regra paralela separada. Se desejar manter um atalho visual de “salário mensal”, ele deve gerar/editar uma recorrência de receita.

---

# 15. Contas

Permitir múltiplas contas.

Exemplos:

- Itaú Conta Corrente;
- Nubank;
- Mercado Pago;
- Dinheiro;
- Conta conjunta.

Na V1, a conta funciona principalmente para classificação e rastreio de origem/destino dos movimentos.

O app não deve apresentar o valor da conta como se tivesse sido consultado no banco.

Caso calcule saldo registrado, rotular claramente como **Saldo registrado no BS Wallet**.

---

# 16. Transferências

Criar fluxo específico para transferências.

Campos:

- conta de origem;
- conta de destino;
- valor;
- data;
- pessoa opcional;
- observação;
- escopo.

Regras:

- origem e destino não podem ser iguais;
- valor deve ser maior que zero;
- não somar em receitas;
- não somar em despesas;
- aparecer no histórico com tipo visual “Transferência”.

---

# 17. Orçamentos mensais

Permitir definir orçamento por categoria e, opcionalmente, por pessoa.

Exemplo:

- Mercado: R$ 1.500;
- Restaurante: R$ 500;
- Transporte: R$ 600.

Exibir barra de progresso e valores:

`R$ 1.130 / R$ 1.500 — 75%`

Alertas padrão:

- 80%;
- 90%;
- 100%.

Evitar repetir a mesma notificação continuamente. Registrar que o threshold daquele orçamento/mês já foi notificado.

Despesas canceladas, excluídas ou em previsão não confirmada não devem consumir orçamento, a menos que o usuário ative uma visualização separada de “previsto”.

---

# 18. Dashboard / Resumo mensal

A tela **Resumo** é a principal.

Deve conter seleção de mês/ano e, no mínimo:

- saldo do mês;
- total de receitas;
- total de despesas;
- despesas por categoria;
- despesas por cartão;
- maiores gastos;
- próximas contas/recorrências;
- próximas faturas;
- lista de lançamentos do mês em ordem decrescente de data/hora;
- busca;
- acesso rápido para adicionar lançamento.

## 18.1 Definição de saldo

Na V1:

`saldo do mês = receitas confirmadas do período - despesas confirmadas do período`

Isso não representa necessariamente o saldo bancário real.

Previsões devem ser apresentadas separadamente, sem alterar silenciosamente o saldo confirmado.

## 18.2 Dashboard avançado futuro

Preparar arquitetura para:

- orçamento disponível;
- previsão de saldo no fim do mês;
- evolução 6/12 meses;
- despesas por pessoa;
- comparação com mês anterior.

Não tornar essas análises avançadas bloqueadoras da V1.

---

# 19. Tela Recorrências

Exibir recorrências ativas e pausadas.

Cada item deve mostrar:

- nome;
- valor;
- despesa/receita;
- frequência;
- próxima ocorrência;
- categoria;
- pessoa, se existir;
- cartão/conta, se existir;
- status ativo/pausado.

Ordenação padrão:

- próxima ocorrência mais próxima primeiro.

Permitir:

- criar;
- editar;
- pausar;
- reativar;
- excluir;
- abrir ocorrências geradas.

---

# 20. Tela Cartões

Permitir seleção de cartão e mês/fatura.

Exibir:

- nome do cartão;
- banco;
- bandeira;
- final;
- titular;
- limite total;
- limite utilizado;
- limite disponível;
- fechamento;
- vencimento;
- total da fatura atual;
- status da fatura;
- lista de compras;
- parcelas;
- próximas faturas.

Permitir filtro por pessoa quando houver cartão adicional ou gastos atribuídos a diferentes pessoas.

Cartões inativos continuam visíveis no histórico, mas não aparecem como opção padrão em novos lançamentos.

---

# 21. Histórico

A tela Histórico deve ter busca e filtros combináveis.

Pesquisar por:

- nome/descrição;
- valor;
- categoria;
- pessoa;
- cartão;
- conta.

Filtros:

- intervalo de datas;
- mês/ano;
- categoria;
- despesa/receita/transferência;
- cartão;
- conta;
- pessoa;
- status;
- pessoal/compartilhado.

Permitir ordenar por:

- data mais recente;
- data mais antiga;
- maior valor;
- menor valor.

Ao abrir um lançamento, permitir visualizar seu AuditLog.

---

# 22. Pessoas

Tela/lista de pessoas deve permitir:

- cadastrar;
- editar;
- desativar;
- associar a usuário, quando aplicável;
- vincular cartões;
- vincular contas;
- definir limite mensal;
- definir categorias permitidas, opcionalmente;
- definir participação no ambiente compartilhado.

Exibir, quando útil:

- gasto do mês;
- limite mensal;
- percentual utilizado.

---

# 23. Categorias

Permitir CRUD de categorias.

Cada categoria deve possuir:

- nome;
- ícone;
- tipo: despesa, receita ou ambos;
- escopo pessoal/compartilhado;
- status ativa/inativa.

Ao desativar uma categoria, preservar lançamentos históricos.

Evitar exclusão definitiva imediata de categoria que ainda esteja referenciada por lançamentos. Preferir desativação ou exigir reassociação antes de excluir.

---

# 24. Anexos

Anexos fazem parte do MVP.

Permitir adicionar a um lançamento:

- foto de comprovante;
- nota fiscal;
- PDF;
- boleto;
- comprovante PIX.

Funcionalidades:

- câmera, quando disponível;
- galeria/arquivos;
- pré-visualização;
- download/abertura;
- remoção;
- múltiplos anexos por lançamento.

Offline:

- salvar arquivo localmente;
- manter referência consistente;
- quando a nuvem existir, colocar anexos na fila de upload;
- não bloquear a criação do lançamento pela ausência de internet.

---

# 25. Exclusão e Lixeira

Para o usuário, excluir significa remover o item da interface e da base ativa.

Antes de remover:

- solicitar confirmação;
- em séries parceladas/recorrentes, perguntar se deseja excluir somente o item ou a série, quando aplicável.

Após exclusão:

- copiar snapshot para Lixeira;
- permitir restaurar por 30 dias;
- mostrar dias restantes;
- permitir exclusão definitiva manual;
- após 30 dias, purgar automaticamente.

A restauração deve tentar preservar relacionamentos. Se uma dependência já tiver sido excluída, pedir ao usuário para selecionar uma alternativa ou restaurar a dependência quando possível.

---

# 26. Auditoria

Registrar alterações relevantes, principalmente em:

- lançamentos;
- parcelas;
- recorrências;
- cartões;
- orçamentos;
- permissões;
- exclusões/restaurações.

Exemplo de apresentação:

“Valor alterado de R$ 79,90 para R$ 69,90 por Joseph em 17/09/2026 às 14:35.”

O log deve ser somente leitura para usuários comuns.

---

# 27. Notificações

Implementar notificações para:

- fatura vencendo;
- fatura vencida;
- conta/recorrência próxima;
- orçamento chegando ao limite;
- parcela chegando;
- recebimento esperado.

Configurações:

- ativar/desativar globalmente;
- ativar/desativar por tipo;
- antecedência configurável quando fizer sentido.

Defaults sugeridos:

- fatura vencendo: 3 dias antes;
- recorrência: 1 dia antes;
- parcela: 3 dias antes;
- recebimento esperado: no dia e, opcionalmente, 1 dia antes;
- orçamento: thresholds 80/90/100%;
- fatura vencida: uma notificação no primeiro dia após o vencimento e lembrete configurável, evitando spam.

Em modo local, utilizar notificações locais quando a plataforma permitir. Sincronização/push remoto pode ser adicionada quando existir backend.

---

# 28. Backup, importação e exportação

## 28.1 Backup JSON

Manter exportação completa em JSON versionado.

Estrutura mínima:

- `schemaVersion`;
- `appVersion`;
- `exportedAt`;
- dados do workspace autorizado;
- entidades relacionadas;
- preferências exportáveis.

Importação deve validar versão e estrutura antes de substituir/mesclar dados.

Nunca sobrescrever silenciosamente a base sem confirmação e sem criar backup de segurança pré-importação.

## 28.2 CSV/Excel

Permitir exportar lançamentos com filtros.

Colunas úteis:

- data;
- nome;
- tipo;
- status;
- valor;
- categoria;
- pessoa;
- conta;
- cartão;
- parcela;
- fatura;
- observações.

## 28.3 PDF

Gerar:

- relatório mensal;
- relatório anual;
- relatório por cartão;
- relatório por pessoa;
- relatório por categoria.

Relatórios devem indicar período, filtros e totais.

## 28.4 Backup em nuvem

É requisito futuro após definição do backend. Preparar interface/camada de serviço, mas não acoplar a V1 a Google Drive, iCloud ou fornecedor específico sem decisão posterior.

---

# 29. Ajustes

A tela Ajustes deve organizar, no mínimo:

**Conta e família**
- perfil;
- membros;
- permissões;
- workspace;

**Financeiro**
- contas;
- cartões;
- pessoas;
- categorias;
- orçamentos;

**Preferências**
- tema claro/escuro;
- idioma pt-BR;
- notificações;

**Dados**
- backup;
- importação;
- exportação;
- lixeira;
- sincronização futura;

**Segurança**
- sessão;
- troca de senha, quando suportada;
- logout.

---

# 30. UX/UI

O design deve manter a estrutura simples do protótipo anterior, mas modernizada significativamente.

Diretrizes:

- mobile-first;
- visual limpo;
- boa hierarquia de informação;
- cantos moderadamente arredondados;
- ícones simples e consistentes;
- suporte completo a tema claro/escuro;
- barra inferior no mobile;
- sidebar opcional em desktop;
- alto contraste;
- áreas clicáveis confortáveis;
- formulários rápidos;
- feedback visual imediato ao salvar;
- evitar telas excessivamente densas.

Não copiar literalmente o wireframe antigo. Preservar a arquitetura mental, não a aparência desatualizada.

## 30.1 Identidade visual e paleta de cores

A cor primária oficial do **BS Wallet** é **`#008847`**. Ela deve ser o principal elemento cromático da identidade do aplicativo e deve orientar a geração das demais cores da interface.

### Cor primária

- `primary-500`: **`#008847`** — cor principal oficial;
- `primary-600`: `#007A40` — hover/ênfase;
- `primary-700`: `#006B38` — estado pressionado/ativo;
- `primary-800`: `#005C30` — áreas de alto contraste no tema claro;
- `primary-900`: `#004D28` — tom profundo;
- `primary-400`: `#33A66C`;
- `primary-300`: `#66BC91`;
- `primary-200`: `#99D3B5`;
- `primary-100`: `#CCE9DA`;
- `primary-50`: `#E6F4ED` — fundos sutis, chips e seleções leves.

O botão primário, FAB, controles selecionados, links de destaque, indicadores ativos, progressos positivos de marca e elementos principais de navegação devem usar prioritariamente `#008847` ou suas variações.

Texto/ícone sobre `#008847` deve usar preferencialmente **branco (`#FFFFFF`)**, pois a combinação possui contraste adequado para texto normal. Em componentes pequenos ou casos de acessibilidade mais rigorosa, pode-se usar um tom mais escuro da família primária.

### Cores derivadas e complementares

As demais cores de identidade devem ser derivadas da primária ou escolhidas por harmonia com ela. Evitar adicionar cores saturadas sem função definida.

Paleta complementar recomendada:

- **Accent complementar:** `#880041` — complementar cromático da cor principal; usar com moderação em destaques não semânticos, gráficos ou detalhes especiais;
- **Teal auxiliar:** `#007A6C` — gráficos, filtros, informações secundárias e elementos analíticos;
- **Fundo claro levemente esverdeado:** `#F6FAF8`;
- **Superfície clara:** `#FFFFFF`;
- **Borda clara:** `#DDE7E1`;
- **Texto principal claro:** `#17201B`;
- **Texto secundário claro:** `#5C6861`;
- **Fundo escuro:** `#0E1511`;
- **Superfície escura:** `#17201B`;
- **Superfície elevada escura:** `#202A24`;
- **Borda escura:** `#344139`;
- **Texto principal escuro:** `#F4F7F5`;
- **Texto secundário escuro:** `#AEB9B2`.

A paleta acima é uma referência de design token. O App Builder pode ajustar pequenas variações para contraste/acessibilidade, mas **não pode substituir `#008847` como cor principal da marca**.

### Uso no tema claro

- fundo principal: `#F6FAF8`;
- cards/sheets: `#FFFFFF`;
- navegação/seleção ativa: `#008847`;
- botões primários: `#008847`;
- hover: `#007A40`;
- pressed: `#006B38`;
- campos selecionados/fundos leves: `#E6F4ED`;
- texto principal: `#17201B`;
- texto secundário: `#5C6861`.

### Uso no tema escuro

A identidade verde deve continuar perceptível sem tornar a tela excessivamente saturada.

- fundo principal: `#0E1511`;
- cards/sheets: `#17201B`;
- superfícies elevadas: `#202A24`;
- destaque primário: usar `#33A66C` ou `#66BC91` quando `#008847` não oferecer contraste suficiente contra fundos escuros;
- manter `#008847` como referência de marca para componentes onde o contraste seja adequado;
- texto principal: `#F4F7F5`;
- texto secundário: `#AEB9B2`.

### Regras para componentes

- CTA primário: fundo `#008847`, texto branco;
- CTA secundário: fundo transparente ou `primary-50`, borda/texto em `#008847`;
- item selecionado: ícone/texto em `#008847`, podendo ter fundo `primary-50`;
- foco de inputs: borda/ring derivado de `#008847`;
- switches/toggles ativos: `#008847`;
- barra de progresso de orçamento dentro do esperado: família primária;
- gráficos devem usar primeiro tons derivados da paleta primária e somente depois cores complementares;
- não usar o verde primário indiscriminadamente como significado de “receita” quando isso puder confundir identidade de marca com semântica financeira.

## 30.2 Cores semânticas e financeiras

Não depender somente de cor para significado. Identidade visual e significado financeiro são conceitos separados.

Pode diferenciar visualmente:

- receita;
- despesa;
- previsão;
- vencido;
- confirmado.

Referência recomendada:

- sucesso/confirmado: família da cor primária quando não houver ambiguidade;
- despesa/erro/vencido: vermelho semântico, por exemplo `#C53B3B`;
- alerta/orçamento próximo do limite: âmbar, por exemplo `#B7791F`;
- informação/previsão: azul ou teal auxiliar, por exemplo `#2563EB` ou `#007A6C`;
- neutro/pendente: cinzas derivados das superfícies.

Sempre combinar cor com texto, ícone, label ou status. Nunca comunicar situação financeira crítica exclusivamente por cor.

## 30.3 Estados obrigatórios

Toda tela que consulta dados deve possuir:

- loading/skeleton quando aplicável;
- estado vazio;
- estado de erro;
- estado offline;
- estado sem resultados de filtro.

Exemplos de estados vazios devem incluir CTA apropriado, como “Adicionar primeiro cartão”.

---

# 31. Responsividade e plataformas

## Mobile

Prioridade máxima para 360–430 px de largura.

Formulários em coluna única.

Barra de navegação inferior fixa ou respeitando safe area.

## Tablet/Desktop/Web

Usar espaço adicional sem simplesmente esticar a interface mobile.

Pode usar:

- sidebar;
- painéis lado a lado;
- cards de resumo em grade;
- tabelas responsivas no histórico.

## PWA

Deve:

- possuir manifest;
- ser instalável quando suportado;
- funcionar com assets principais offline;
- reabrir sem perder dados locais.

---

# 32. Segurança e privacidade

Requisitos:

- não guardar senha em texto puro;
- não hardcode credenciais;
- não guardar CVV;
- não guardar número completo de cartão;
- tokens de autenticação em armazenamento seguro apropriado;
- respeitar escopo pessoal x compartilhado;
- anexos privados não devem ficar publicamente acessíveis quando houver nuvem;
- validar permissões também na camada de dados/API quando o backend existir;
- operações administrativas devem gerar auditoria;
- sanitizar arquivos e entradas conforme capacidade da plataforma;
- não expor segredos/API keys no frontend.

---

# 33. Regras monetárias e de data

- moeda da V1: BRL;
- locale: pt-BR;
- armazenar dinheiro em centavos inteiros ou Decimal;
- nunca usar float simples como fonte de verdade monetária;
- exibir datas no formato brasileiro;
- armazenar timestamps em formato consistente, preferencialmente UTC, mantendo timezone do dispositivo para exibição;
- cálculos mensais devem respeitar a data local do usuário;
- ao calcular dias 29/30/31 em meses menores, utilizar o último dia válido do mês, sem mover silenciosamente para o mês seguinte.

---

# 34. Pesquisa e filtros

A busca deve ser tolerante a maiúsculas/minúsculas e, quando possível, a acentuação.

Permitir pesquisa por valor digitado no padrão brasileiro.

Filtros devem poder ser combinados.

Ao sair e retornar da tela, é desejável manter os filtros durante a sessão.

Adicionar ação “Limpar filtros”.

---

# 35. Critérios de aceite da V1

A V1 só deve ser considerada concluída quando:

1. é possível instalar/usar no mobile ou PWA e registrar dados sem internet;
2. fechar e reabrir o aplicativo não perde os dados;
3. existe cadastro/login sem credenciais hardcoded;
4. existe Administrador Master e regras de permissão;
5. é possível alternar entre dados pessoais e compartilhados conforme configuração;
6. é possível cadastrar múltiplas contas, cartões, pessoas e categorias;
7. é possível criar despesa e receita;
8. é possível criar compra parcelada e o total das parcelas coincide exatamente com o valor da compra;
9. a primeira parcela é atribuída à fatura conforme fechamento do cartão;
10. é possível criar recorrências em todas as frequências definidas;
11. recorrências geram previsão sem duplicar ocorrências;
12. é possível confirmar previsão;
13. dashboard mensal calcula corretamente receitas, despesas e saldo confirmado;
14. histórico permite busca e filtros combinados;
15. cartões exibem fatura atual e próximas faturas;
16. orçamentos calculam consumo e thresholds corretamente;
17. anexos funcionam offline;
18. transferências não alteram totais de receita/despesa;
19. edição gera histórico de alteração;
20. exclusão envia item para Lixeira;
21. item pode ser restaurado antes de 30 dias;
22. backup JSON pode ser exportado e validado;
23. exportação CSV/Excel funciona;
24. relatório PDF mensal funciona;
25. tema claro/escuro funciona;
26. não existe senha, CVV ou número completo de cartão exposto no armazenamento comum;
27. o código/modelo separa persistência local de sincronização remota;
28. nenhuma funcionalidade principal depende de internet na V1, exceto recursos naturalmente externos como recuperação real de senha por e-mail.

---

# 36. Dados de teste obrigatórios

Criar seed opcional de desenvolvimento que possa ser removido em produção.

Exemplo:

**Workspace:** Família Demo

**Usuários/Pessoas:**
- Usuário A — Master Admin
- Usuário B — Membro/Admin opcional

**Categorias:**
- Mercado
- Restaurante
- Transporte
- Moradia
- Saúde
- Lazer
- Salário
- Freelance

**Contas:**
- Conta Corrente
- Conta Digital
- Dinheiro

**Cartões:**
- Cartão Principal — fechamento dia 10 — vencimento dia 17 — limite R$ 5.000
- Cartão Secundário — fechamento dia 25 — vencimento dia 2 — limite R$ 3.000

**Cenários:**
- despesa única de mercado;
- salário recorrente mensal;
- conta de energia recorrente mensal;
- compra de R$ 1.200 em 12x;
- transferência entre contas;
- orçamento Mercado R$ 1.500;
- lançamento com anexo;
- lançamento em previsão;
- item na lixeira.

Testar especialmente compras próximas ao fechamento do cartão e vencimentos que cruzam o mês/ano.

---

# 37. Casos de borda obrigatórios

Tratar:

- compra no dia do fechamento;
- compra um dia após fechamento;
- fechamento dia 31 em fevereiro;
- vencimento dia 31 em mês de 30 dias;
- compra parcelada com centavos não divisíveis igualmente;
- edição de apenas uma parcela;
- exclusão da série inteira;
- recorrência no dia 31;
- recorrência quinzenal atravessando mudança de mês;
- recorrência anual em 29/02;
- cartão desativado com histórico existente;
- categoria desativada com lançamentos existentes;
- pessoa removida/desativada com histórico existente;
- restauração de item cuja categoria foi removida;
- criação de lançamento sem internet;
- reinício do app antes da sincronização;
- mesmo item alterado em dois dispositivos quando sync existir;
- usuário sem permissão tentando editar dado compartilhado;
- Admin tentando remover Master Admin;
- transferência para a mesma conta;
- arquivo de anexo indisponível localmente;
- importação de backup de versão incompatível.

---

# 38. Arquitetura recomendada, agnóstica de plataforma

Organizar o projeto em camadas equivalentes a:

**Presentation/UI**
- pages/screens;
- components;
- navigation;
- view models/state.

**Domain**
- entities;
- use cases;
- validation;
- financial rules;
- invoice calculator;
- recurrence engine;
- budget calculator.

**Data**
- repositories;
- local database;
- file storage;
- backup/export;
- auth adapter;
- sync adapter futuro.

Não colocar regras críticas de parcelamento, fatura ou orçamento diretamente dentro de componentes visuais.

Criar funções/serviços testáveis para:

- dividir parcelas;
- calcular ciclo de fatura;
- determinar vencimento;
- calcular totais do mês;
- calcular orçamento;
- gerar próxima recorrência;
- detectar vencimentos/notificações;
- exportar/importar backup.

---

# 39. Contratos de serviço sugeridos

A implementação pode adaptar a sintaxe, mas deve preservar interfaces equivalentes:

```ts
interface TransactionRepository {
  list(filters?: TransactionFilters): Promise<Transaction[]>;
  get(id: string): Promise<Transaction | null>;
  create(input: CreateTransactionInput): Promise<Transaction>;
  update(id: string, patch: UpdateTransactionInput): Promise<Transaction>;
  delete(id: string): Promise<void>;
}

interface AuthProvider {
  signUp(input: SignUpInput): Promise<AuthSession>;
  signIn(identifier: string, password: string): Promise<AuthSession>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  restoreSession(): Promise<AuthSession | null>;
}

interface SyncAdapter {
  push(changes: LocalChange[]): Promise<SyncResult>;
  pull(cursor?: string): Promise<RemoteChanges>;
}
```

`SyncAdapter` pode permanecer desativado na V1 local, mas o domínio não deve depender da ausência dele.

---

# 40. Rotas/telas sugeridas

A nomenclatura exata pode variar conforme o framework.

```text
/auth/login
/auth/cadastro
/auth/esqueci-senha

/app/resumo
/app/lancamento/novo
/app/lancamento/:id
/app/parcela/:id

/app/recorrencias
/app/recorrencias/nova
/app/recorrencias/:id

/app/cartoes
/app/cartoes/novo
/app/cartoes/:id
/app/cartoes/:id/faturas/:invoiceId

/app/historico

/app/ajustes
/app/ajustes/contas
/app/ajustes/contas/:id
/app/ajustes/pessoas
/app/ajustes/pessoas/:id
/app/ajustes/categorias
/app/ajustes/categorias/:id
/app/ajustes/orcamentos
/app/ajustes/orcamentos/:id
/app/ajustes/membros
/app/ajustes/notificacoes
/app/ajustes/exportacao
/app/ajustes/lixeira
```

---

# 41. Comportamento do botão “Adicionar”

Ao tocar no botão principal, apresentar opções rápidas:

- Despesa;
- Receita;
- Transferência.

Após escolher Despesa/Receita, permitir selecionar:

- única;
- parcelada;
- recorrente.

Pré-selecionar valores/contexto quando o usuário abrir o formulário a partir de uma tela específica, por exemplo cartão ou recorrências.

---

# 42. Migração conceitual do protótipo existente

O protótipo atual possui conceitos que devem ser preservados:

- Resumo mensal;
- Recorrências;
- Cartões;
- Histórico;
- Ajustes;
- Categorias com ícones;
- Pessoas;
- pesquisa;
- despesas e recebimentos;
- despesas únicas, parceladas e recorrentes;
- edição de parcela individual;
- edição de série;
- tema claro/escuro;
- backup JSON.

Porém, não copiar as limitações do protótipo:

- não usar login hardcoded;
- não usar apenas `localStorage` como banco principal;
- não limitar recorrência somente a mensal;
- não modelar cartão apenas com banco/final/vencimento;
- não gerar parcelas apenas adicionando meses à data sem considerar fatura;
- não tratar recebimento fixo como campo isolado se ele pode ser uma recorrência de receita;
- não excluir permanentemente sem janela de recuperação;
- não misturar lógica de negócio diretamente com UI.

---

# 43. Fora de escopo da V1

Não implementar agora, salvo se for necessário tecnicamente pelo App Builder:

- Open Finance;
- consulta automática de saldo bancário;
- investimentos;
- criptomoedas;
- pagamento de contas;
- PIX real;
- emissão de cartão;
- marketplace;
- metas financeiras avançadas;
- IA financeira;
- previsão avançada baseada em machine learning;
- múltiplas moedas;
- contabilidade fiscal.

---

# 44. Ordem recomendada de implementação

## Fase 1 — Fundação

- arquitetura;
- banco local;
- modelos;
- autenticação;
- workspace;
- permissões;
- navegação;
- tema.

## Fase 2 — Cadastros base

- categorias;
- pessoas;
- contas;
- cartões.

## Fase 3 — Lançamentos

- despesa;
- receita;
- histórico;
- anexos;
- auditoria.

## Fase 4 — Cartão e parcelamento

- cálculo de fatura;
- parcelas;
- edição individual/série;
- limites;
- faturas futuras.

## Fase 5 — Recorrências e orçamento

- motor de recorrência;
- previsão/efetivação;
- orçamentos;
- alertas.

## Fase 6 — Dashboard

- resumo mensal;
- categorias;
- cartões;
- maiores gastos;
- próximos vencimentos.

## Fase 7 — Dados e confiabilidade

- lixeira;
- backup;
- importação;
- CSV/Excel;
- PDF;
- testes de casos de borda.

## Fase 8 — Cloud-ready

- SyncAdapter;
- fila de operações;
- metadados de sync;
- deixar backend concreto desativado até ser escolhido.

---

# 45. Instruções finais obrigatórias para o agente de desenvolvimento

1. Não reduza o projeto a uma simples lista de despesas.
2. Não remova o conceito de família/workspace e permissões.
3. Não use credenciais hardcoded.
4. Não dependa de internet para operações financeiras básicas.
5. Não use `localStorage` como banco financeiro principal de produção.
6. Não trate saldo mensal como saldo bancário real.
7. Não conte transferências como receitas ou despesas.
8. Não calcule parcelamento de cartão ignorando fechamento/vencimento.
9. Não use ponto flutuante simples para dinheiro.
10. Não gere recorrências duplicadas.
11. Não permitir que Admin comum remova/rebaixe o Master Admin.
12. Não apagar definitivamente um item recuperável antes de 30 dias, exceto se o usuário confirmar exclusão definitiva.
13. Não armazenar número completo de cartão ou CVV.
14. Não acoplar o domínio a Xano, Supabase, Firebase ou outro backend específico neste momento.
15. Manter adapters/repositories para permitir integração futura.
16. Implementar estados de loading, vazio, erro e offline.
17. Manter UI em pt-BR e valores em BRL na V1.
18. Criar dados de demonstração somente em modo de desenvolvimento e permitir removê-los.
19. Criar testes para cálculos de fatura, parcelamento, recorrência e orçamento.
20. Antes de considerar a V1 finalizada, validar todos os critérios de aceite deste RPD.
21. Usar `#008847` como cor primária oficial do BS Wallet e derivar a identidade visual a partir dela; não substituir essa cor por outra identidade principal.

---

# 46. Resultado esperado

Entregar um BS Wallet moderno, rápido e simples de usar, mantendo a facilidade do protótipo original, mas com uma base arquitetural correta para evoluir de aplicativo local para uma solução familiar sincronizada em nuvem.

A primeira versão deve ser plenamente útil como aplicativo local/offline, com autenticação e organização multiusuário preparadas para ambiente real, sem impedir a futura adoção de backend remoto, sincronização, login social, biometria, metas financeiras e analytics avançados.

A prioridade é **confiabilidade dos dados financeiros, clareza das regras de negócio, operação offline, facilidade de evolução futura e consistência da identidade visual baseada em `#008847`**.
