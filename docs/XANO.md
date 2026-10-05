> Documento histórico de planejamento. O frontend já possui integração com os endpoints de `xano/bs_wallet_endpoints.xs`; consulte o README para configuração, publicação e limitações atuais. As afirmações abaixo sobre integração ainda não implementada descrevem o estado de 17/09/2026.

# BS Wallet — plano de integração com Xano

Verificação da documentação: 17/09/2026. Este documento define trabalho planejado. **Nenhuma instância, tabela, API, autenticação remota ou sincronização Xano foi provisionada ou validada.** Nenhum workspace Xano foi selecionado e não havia ferramenta Xano de leitura de especificações disponível nesta execução.

O pedido atual escolhe Xano como destino da engenharia. O RPD preserva a V1 local e independente de backend. A combinação adotada é manter o domínio e a persistência local independentes e integrar Xano por adaptadores após existir um contrato real. A presença deste plano não significa que o backend já existe.

## Fronteiras e sequência

```text
Telas / componentes
        ↓
Casos de uso + regras financeiras + política de acesso
        ↓
Repositórios → IndexedDB → fila persistente de operações
                                   ↓
                              SyncAdapter
                                   ↓
                         API autenticada Xano
                                   ↓
                     Banco + arquivos privados
```

As telas não devem chamar Xano diretamente. A operação financeira grava os dados e a fila na mesma transação local; a confirmação visual acontece após essa gravação. Uma falha de rede não desfaz o lançamento. Recuperação de senha por e-mail e convites enviados dependem do serviço remoto e devem informar indisponibilidade enquanto ele não estiver configurado.

O `workspace` familiar é uma entidade do BS Wallet. Ele não corresponde a criar uma instância ou um workspace de desenvolvimento Xano por família.

## Antes de implementar a integração

1. Selecionar explicitamente instância, workspace de desenvolvimento e branch Xano, sem usar produção por conveniência.
2. Inspecionar tabelas e autenticação existentes para evitar duplicações. Identificar URL do grupo de APIs e convenção real de IDs, datas, erros e tokens.
3. Obter OpenAPI real pelo painel Xano: abrir o grupo, selecionar **Swagger Documentation** e baixar o JSON. O acesso à documentação pode ser protegido. Versionar uma cópia sanitizada e os exemplos usados nos testes. Xano documenta esse fluxo em [OpenAPI Documentation](https://docs.xano.com/the-function-stack/building-with-visual-development/swagger-openapi-documentation).
4. Caso se use a Metadata API, usar a leitura de OpenAPI com o escopo administrativo mínimo necessário. O endpoint de [OpenAPI de um grupo](https://docs.xano.com/api-reference/api-group/get-openapi-spec-for-an-api-group) exige `Workspace Api: Read`. Credenciais Metadata pertencem às ferramentas de desenvolvimento, jamais ao navegador.
5. Mapear o contrato local para o contrato real, implementar o adaptador e testar respostas reais em desenvolvimento. Não presumir caminhos de login, nomes como `authToken`, formato de paginação ou suporte a refresh token sem a especificação.
6. Habilitar sincronização somente após os testes de autorização, conflito, idempotência e isolamento de dados passarem.

## Esquema planejado

Os nomes abaixo são conceitos do domínio, não nomes de tabelas existentes. Campos monetários usam centavos inteiros. Datas de negócio usam `YYYY-MM-DD`; eventos usam UTC, com timezone explícito nas regras de calendário. UUIDs criados offline permanecem estáveis após a sincronização.

| Grupo | Entidades e restrições principais |
| --- | --- |
| Identidade | Usuário com e-mail e username normalizados e únicos; credenciais fora da representação comum/exportável; sessões revogáveis |
| Família | Workspace com exatamente um Master; membro único por workspace e usuário; papéis e capabilities concedidas |
| Cadastros | Pessoa com vínculo opcional a usuário; conta; cartão com somente quatro últimos dígitos; categoria; todos preservam histórico ao serem desativados |
| Financeiro | Lançamento; grupo de parcelas; fatura única por cartão/ano/mês; recorrência; orçamento por período/categoria/pessoa |
| Transferências | Entidade própria; contas distintas e acessíveis no mesmo workspace; não altera total de receitas/despesas |
| Arquivos | Anexo vinculado a lançamento; metadados locais/remotos separados; checksum, tamanho e MIME verificados |
| Rastreabilidade | Auditoria criada pelo servidor; lixeira recuperável por 30 dias; tombstones técnicos para sincronização |
| Sincronização | Registro de operações já aceitas; versão por entidade; cursor ordenado de alterações; conflitos pendentes |

Acrescentar `workspaceId`, `ownerUserId`, `scope`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `version` às entidades sincronizáveis quando aplicáveis. Índices devem apoiar consultas por workspace/escopo/proprietário/data e identificadores de relações. O servidor confirma que todas as relações pertencem ao workspace e são acessíveis ao autor; um ID existente por si só não concede acesso.

## Capabilities e scopes

Esta é uma proposta de contrato de autorização para o backend. Reconciliar a grafia com os tipos locais antes da integração. São permissões do **BS Wallet**, distintas dos escopos administrativos da API de desenvolvimento Xano.

| Capability proposta | Autoriza |
| --- | --- |
| `shared.read` | Consultar a carteira compartilhada nas áreas permitidas |
| `transaction.create` | Criar lançamentos no escopo autorizado |
| `transaction.edit_own` | Editar lançamento próprio |
| `transaction.edit_others` | Editar lançamento compartilhado de outro membro |
| `transaction.delete` | Enviar lançamento acessível para a lixeira |
| `attachment.read` / `attachment.write` | Ler ou anexar arquivo a um lançamento acessível |
| `catalog.manage` | Administrar pessoas, cartões, contas e categorias permitidos |
| `budget.manage` | Configurar orçamento no escopo permitido |
| `report.read` / `data.export` | Consultar relatório ou exportar apenas dados acessíveis |
| `trash.restore` | Restaurar item ainda recuperável e acessível |
| `members.manage` | Convidar, desativar e administrar membros dentro da delegação recebida |
| `workspace.configure` | Alterar preferências e compartilhamento dentro da delegação recebida |

Política planejada, aplicada em toda leitura e escrita:

1. Validar sessão, status do usuário e vínculo ativo no workspace.
2. Derivar o autor da sessão; não aceitar `actorUserId`, papel ou capabilities enviados pelo cliente como autoridade.
3. Para `personal`, exigir propriedade ou concessão explícita registrada. Ser Master/Admin não libera os dados pessoais de outro usuário.
4. Para `shared`, exigir área habilitada e capability correspondente à ação. `edit_own` não inclui `edit_others`.
5. Bloquear sempre a remoção, desativação, substituição ou redução de papel do Master por outro usuário, inclusive por atualização direta de membro/workspace, importação ou sync. Transferência de propriedade não faz parte do MVP.
6. Verificar relações e campos permitidos. Um membro não pode tornar-se Admin por mass assignment nem mudar o proprietário do item para contornar permissões.
7. Aplicar a mesma política em anexos, auditoria, lixeira, resultados agregados e exportações. Contagens também podem vazar dados.

Xano exige lógica de autorização nos endpoints; sua documentação mostra precondições baseadas no usuário autenticado em [Restricting Access](https://docs.xano.com/building-backend-features/user-authentication-and-user-data/restricting-access-rbac). Para BS Wallet, consultar permissões atuais no servidor evita manter direitos revogados em tokens antigos. A documentação de [Separating User Data](https://docs.xano.com/building-backend-features/user-authentication-and-user-data/separating-user-data) fundamenta o filtro por proprietário, mas o filtro por família e escopo precisa ser implementado para este produto.

## Autenticação e proteção de arquivos

O `AuthProvider` remoto deve cobrir cadastro, login por e-mail ou username, consulta/restauração de sessão, encerramento/revogação e recuperação de senha. A política de senha e o modo de sessão serão definidos com o provedor. Xano oferece [validação de senha e criação de tokens](https://docs.xano.com/the-function-stack/functions/security), mas essas funções não garantem que o fluxo completo já esteja instalado na instância.

Requisitos de engenharia propostos:

- Normalizar username e e-mail; aplicar unicidade no servidor. Nunca retornar senha, hash ou token de recuperação em dados do domínio.
- Usar resposta neutra no pedido de recuperação, token curto de uso único e envio real pelo provedor configurado. Revogar sessões conforme a política após alteração de senha.
- Limitar tentativas de login, recuperação e convite. Validar entradas, impedir log de credenciais e limitar payloads.
- Para sessão persistente na web, preferir uma camada de sessão no mesmo domínio com cookie `HttpOnly`, `Secure`, política `SameSite` e proteção CSRF apropriada. Essa camada adicional precisa ser implementada; não é presumida como recurso pronto de um frontend estático. Se o contrato exigir Bearer no navegador, definir e revisar explicitamente sua persistência e mitigação de XSS antes de produção.
- Configurar HTTPS e CORS para as origens utilizadas. CORS não substitui autorização.
- Não colocar chaves administrativas, segredos de e-mail ou tokens de serviço em variáveis `VITE_*`: elas entram no bundle público.
- Validar MIME real, extensão e tamanho dos anexos; aplicar política de conteúdo e limpeza de órfãos. O nome do arquivo não vira um caminho confiável.
- Usar armazenamento privado. Arquivos públicos Xano possuem URLs acessíveis sem autenticação, conforme [File Storage in Xano](https://docs.xano.com/file-storage/file-storage-in-xano). Após verificar acesso ao lançamento, emitir URL de curta duração via [Private File Storage](https://docs.xano.com/file-storage/private-file-storage). Um link assinado permanece compartilhável enquanto válido; não o gravar como URL permanente pública.

Um login local não comprova identidade remota nem protege contra alguém com controle do perfil do navegador. Regras locais ajudam a organizar o uso; a fronteira de segurança multiusuário precisa ser aplicada no backend. Uma alteração de permissão remota também não apaga automaticamente dados já exportados ou copiados de um dispositivo offline.

## Operações de API propostas — não são endpoints existentes

O contrato concreto será extraído do OpenAPI real. Esta tabela descreve intenções que o backend deverá atender, sem inventar URLs de implantação.

| Operação | Entrada essencial | Resultado esperado |
| --- | --- | --- |
| Cadastrar / entrar / restaurar sessão | Identificador normalizado e credenciais apenas no fluxo de autenticação | Sessão conforme o contrato, perfil e permissões atuais |
| Criar workspace / gerenciar membros | Nome ou membro alvo e alteração permitida | Workspace/membro e auditoria; Master preservado |
| Consultar dados | Escopo, filtros combinados e cursor | Página autorizada, cursor e versões |
| Criar/alterar entidade | UUID, campos permitidos, versão base, ID da operação | Versão aceita ou conflito explícito |
| Parcelar | Compra, cartão, total em centavos e número de parcelas | Grupo e parcelas atômicos, com soma exata |
| Materializar recorrência | Recorrência e intervalo de datas | Ocorrências sem duplicações, chave única por recorrência/data |
| Excluir/restaurar | Entidade, versão, ID da operação | Snapshot/lixeira ou restauração com política atual |
| Enviar/abrir anexo | Lançamento, metadados e arquivo ou ID do anexo | Referência privada ou URL temporária autorizada |
| Sincronizar envio/recebimento | Operações ou cursor de mudanças | Aceites por operação, conflitos, tombstones e próximo cursor |

Erros devem distinguir sessão inválida, falta de permissão, validação, conflito de versão, limite de uso e falha transitória. Mensagens ao cliente não devem revelar a existência de dados privados de terceiros.

## Consistência e sincronização

- Cada operação recebe ID estável. Reenvio após timeout retorna o mesmo aceite, sem duplicar lançamento, transferência ou parcela.
- A escrita usa versão base. Duas alterações concorrentes em valor, categoria, fatura ou propriedade geram conflito; não usar a data do dispositivo para sobrescrever silenciosamente.
- O servidor grava alteração e auditoria atomicamente. Grupo parcelado, alterações em série e exclusão de série têm unidade transacional definida.
- Mantém-se um cursor estável de alterações autorizadas. Revogações de compartilhamento precisam de um mecanismo para invalidar o cache local; o próximo pull não deve continuar expondo registros sem acesso.
- Recorrências usam uma chave única estável por regra e data da ocorrência. Execução local e remota da mesma regra não podem gerar duas cobranças.
- A lixeira preserva a janela de 30 dias. O tombstone impede que um dispositivo antigo recrie inadvertidamente um item excluído; definir retenção compatível com o período máximo offline.
- O primeiro envio de uma instalação local exige vinculação explícita de usuário/workspace. Não atribuir automaticamente todos os registros locais à primeira identidade autenticada.
- Backups financeiros não incluem credenciais. Importações validam versão de esquema, integridade de relações e permissões; importar backup não concede poderes administrativos remotos.

## Testes necessários antes de ativar nuvem

| Caso | Resultado obrigatório |
| --- | --- |
| Membro envia `role=master_admin` em payload | Campo rejeitado/ignorado sem elevar direitos |
| Admin tenta remover Master por API ou sync | Operação negada e estado preservado |
| Master consulta transação pessoal de outro usuário | Sem acesso sem concessão explícita |
| Usuário usa ID de anexo de outro workspace | Sem acesso, inclusive via URL de leitura |
| Permissão revogada com token ainda válido | Próxima operação negada pelo estado atual |
| Dois dispositivos alteram a mesma versão | Conflito exibido, sem perda silenciosa |
| Conexão cai após gravação remota | Reenvio não duplica a operação |
| Recorrência é processada duas vezes | Uma ocorrência por data |
| Parcelamento de valor indivisível em centavos | Soma exata; excedentes nas primeiras parcelas |
| Compra no fechamento e no dia seguinte | Ciclos distintos conforme o RPD |
| Transferência entre contas | Não integra receita/despesa; origem e destino distintos |
| Restauração dentro e fora dos 30 dias | Permite somente dentro da janela e com acesso |
| Dispositivo fica offline e reinicia | Dados e fila sobrevivem; operação básica funciona |

## GitHub e entrega do backend

O GitHub será a referência das alterações aprovadas, contratos e testes. Para Xano, implantação é uma etapa separada. O [Git Sync nativo](https://docs.xano.com/xano-features/workspace-settings/git-sync) exporta de Xano para GitHub; ele não implanta um commit do GitHub no Xano. A [CLI documenta pull/push do workspace local](https://docs.xano.com/xano-cli/guide-from-scratch), permitindo trabalhar com arquivos versionados e promover a versão aprovada pelo fluxo de engenharia.

Antes de cada mudança, trazer para o repositório as alterações feitas no painel, revisar diferenças, testar em desenvolvimento e só então implantar. Registrar commit e versão implantados. Não misturar exportação automática do backend com a branch de UI que Lovable está editando sem definir diretórios, destino e regras de merge.

Conforme `C:\Users\joseph\Documents\AGENTS.md`, a implementação XanoScript é delegada aos especialistas: Table Designer → Function Writer → API Query Writer → Task Writer → Unit Test Writer → Frontend Developer. Este documento é o planejamento para esses handoffs; não contém XanoScript.
